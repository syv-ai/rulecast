import { parseArgs } from "node:util"

import { STATS_SCHEMA_VERSION } from "../adapters/cli/contract"
import { compile, diagnosticText } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome, projectStateDir } from "../core/home"
import { cachedRepos } from "../core/repos/provider"
import { derive, type RuleStats, ruleStats } from "../core/stats/derive"
import { readFindingsLog, readWeeklyRollup } from "../core/stats/log"
import { ruleRuns, type StopBlocks, stopBlocks } from "../core/stats/runs"
import {
  RECUR_MIN_SESSIONS,
  TREND_MIN_FIRED,
  TREND_MIN_RUNS,
  WEEKLY_KEEP_WEEKS,
  type WeeklyTrend,
  weeklyTrend,
  weekRows,
} from "../core/stats/weekly"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** What `rulecast stats --format json` prints (agents/reference/output.md). */
export interface StatsDocument {
  schemaVersion: typeof STATS_SCHEMA_VERSION
  window: {
    since: string | null
    firstRecord: string | null
    lastRecord: string | null
    /** The log was rotated and reaches back no further than `since`: older findings may be missing. */
    truncated: boolean
  }
  sessions: number
  rules: RuleStats[]
  /**
   * Enabled detector rules in the current config with no finding in the window. Left out, with
   * `unknownRules`, when part of the config did not compile: its rules would read as removed.
   */
  neverFired?: string[]
  /** Of `neverFired`, the rules no check ran at all: no file the agents changed matched them. */
  neverRan?: string[]
  /** Per enabled detector rule, the edit checks and stops in the window that ran it on a file. */
  runs?: Record<string, number>
  /** Per rule that blocked a stop in the window, its block rate by the number of files it judged there. */
  stopBlocks?: StopBlocks[]
  /** Rules in the window that are no longer in the config. */
  unknownRules?: string[]
  /** What did not compile (a rule repo not fetched, a bad rule); present only when anything did not. */
  notCompiled?: string[]
  /**
   * Per rule that fired, its findings per 100 checks by week (core/stats/weekly.ts), from the log and,
   * when this config keeps one, the weekly summary. `summary`: whether this config keeps one.
   */
  weekly: WeeklyTrend & { summary: "on" | "off" }
  /** Lines of the log or the weekly summary that could not be read; present only when there were any. */
  skippedLines?: number
}

const UNITS: Record<string, number> = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000 }

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/

/**
 * `30d`, `12h`, or an ISO date. A date alone is midnight UTC; a time must carry its offset (`Z` or
 * `+02:00`), since one without is the local time to `Date` and a date alone is not.
 */
export function parseSince(value: string, now: Date): Date {
  const relative = /^(\d+)([dh])$/.exec(value)
  if (relative !== null) return new Date(now.getTime() - Number(relative[1]) * UNITS[relative[2]!]!)
  const parts = DATE.exec(value)
  const date = parts === null ? null : new Date(value)
  // `Date` rolls 2026-02-30 over into March: the day must come back as written.
  const day = parts === null ? null : new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  if (
    date === null ||
    day === null ||
    Number.isNaN(date.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  ) {
    throw new UsageError(
      `--since "${value}" is not a duration or a date (use 30d, 12h, 2026-09-01 or 2026-09-01T10:00Z)`,
    )
  }
  return date
}

const COLUMNS: [header: string, value: (rule: RuleStats) => string][] = [
  ["fired", (rule) => String(rule.fired)],
  ["blocked", (rule) => String(rule.blocked)],
  ["refused", (rule) => String(rule.refused)],
  ["fixed", (rule) => String(rule.fixed)],
  ["ignored", (rule) => String(rule.ignored)],
  ["suppressed", (rule) => String(rule.suppressed)],
  ["prevented", (rule) => String(rule.prevented)],
  ["open", (rule) => String(rule.open)],
  ["repeated", (rule) => String(rule.repeated)],
  ["turns to fix", (rule) => (rule.medianTurnsToFix === null ? "-" : String(rule.medianTurnsToFix))],
]

const percent = (rate: number) => `${Math.round(rate * 100)}%`

/** Weeks shown in the text output; the JSON has them all. */
const SHOWN_WEEKS = 8
/** Recurring files shown per rule in the text output. */
const SHOWN_FILES = 3

/** The weekly section: only once the trend spans two weeks, since one week is no trend. */
function weeklyLines(weekly: StatsDocument["weekly"]): string[] {
  const spans = weekly.rules[0]?.weeks.length ?? 0
  if (spans < 2) return []
  const out: string[] = []
  const enough = weekly.rules.filter((rule) => rule.enoughFindings)
  if (enough.length > 0) {
    const weeks = enough[0]!.weeks.slice(-SHOWN_WEEKS)
    const labels = weeks.map((week) => `${week.week.slice(5)}${week.partial ? "*" : ""}`)
    const width = Math.max(4, ...enough.map((rule) => rule.rule.length))
    out.push(
      `findings per 100 checks that ran the rule, by week (from Monday, UTC; * partial; - fewer than ${TREND_MIN_RUNS} checks):`,
      `  ${["rule".padEnd(width), ...labels].join("  ")}`,
    )
    for (const rule of enough) {
      const rates = rule.weeks
        .slice(-SHOWN_WEEKS)
        .map((week, index) =>
          (week.firedPer100Runs === null ? "-" : String(week.firedPer100Runs)).padStart(labels[index]!.length),
        )
      out.push(`  ${[rule.rule.padEnd(width), ...rates].join("  ")}`)
    }
  }
  const few = weekly.rules.filter((rule) => !rule.enoughFindings)
  if (few.length > 0)
    out.push(`too few findings for a trend (under ${TREND_MIN_FIRED}): ${few.map((rule) => rule.rule).join(", ")}`)
  const recurring = weekly.rules.filter((rule) => rule.recurringFileCount > 0)
  if (recurring.length > 0) {
    out.push(`fired in the same file in ${RECUR_MIN_SESSIONS} or more sessions:`)
    for (const rule of recurring) {
      const files = rule.recurringFiles
        .slice(0, SHOWN_FILES)
        .map(({ file, sessions }) => `${file} (${sessions} sessions)`)
      const more = rule.recurringFileCount - files.length
      out.push(`  ${rule.rule}: ${files.join(", ")}${more > 0 ? `, and ${more} more` : ""}`)
    }
  }
  if (weekly.summary === "off" && weekly.from !== null) {
    out.push(
      `the weekly summary is off: the trend covers only the log, from ${weekly.from.slice(0, 10)}. stats.weekly_summary: true in ${CONFIG_FILE} keeps ${WEEKLY_KEEP_WEEKS} weeks`,
    )
  }
  out.push("")
  return out
}

function terminal(document: StatsDocument): string {
  const out: string[] = []
  const since = document.window.since ?? document.window.firstRecord
  const sessions = `${document.sessions} ${document.sessions === 1 ? "session" : "sessions"}`
  // Only a weekly summary: the log itself holds nothing yet.
  out.push(since === null ? `${sessions} in the log` : `${sessions} since ${since}`, "")
  if (document.rules.length > 0) {
    const width = Math.max(4, ...document.rules.map((rule) => rule.rule.length))
    out.push(["rule".padEnd(width), ...COLUMNS.map(([header]) => header)].join("  "))
    for (const rule of document.rules) {
      out.push(
        [rule.rule.padEnd(width), ...COLUMNS.map(([header, value]) => value(rule).padStart(header.length))].join("  "),
      )
    }
    out.push("")
  } else out.push("no findings in this window", "")
  const noisy = document.rules.filter((rule) => rule.noisy.length > 0)
  if (noisy.length > 0) {
    out.push("noisy:")
    for (const rule of noisy) {
      const reasons = rule.noisy.map((reason) =>
        reason === "repeats"
          ? `${percent(rule.repeatRate)} repeated`
          : `${percent(rule.suppressionRate)} ${rule.suppressAttempted > 0 ? "suppressed or ignores tried" : "suppressed"}`,
      )
      out.push(`  ${rule.rule}: ${reasons.join(", ")}`)
    }
    out.push("")
  }
  if (document.stopBlocks !== undefined && document.stopBlocks.length > 0) {
    out.push("blocks at stops, by the files a rule checked there:")
    const width = Math.max(...document.stopBlocks.map((entry) => entry.rule.length))
    for (const entry of document.stopBlocks) {
      const buckets = entry.byFiles.map(
        ({ files, stops, blocked }) =>
          `${files} ${files === "1" ? "file" : "files"}: ${stops === 0 ? "-" : `${blocked} of ${stops}`}`,
      )
      out.push(`  ${entry.rule.padEnd(width)}  ${buckets.join("  ·  ")}`)
    }
    out.push("")
  }
  out.push(...weeklyLines(document.weekly))
  if (document.neverFired !== undefined && document.runs !== undefined) {
    const runs = document.runs
    const ran = document.neverFired.filter((rule) => (runs[rule] ?? 0) > 0)
    if (ran.length > 0) {
      const counted = ran.map((rule) => `${rule} (${runs[rule]} ${runs[rule] === 1 ? "check" : "checks"})`)
      out.push(`ran but never fired: ${counted.join(", ")}`, "")
    }
  }
  if (document.neverRan !== undefined && document.neverRan.length > 0)
    out.push(`never ran (no file the agents changed matched): ${document.neverRan.join(", ")}`, "")
  if (document.unknownRules !== undefined && document.unknownRules.length > 0)
    out.push(`no longer configured: ${document.unknownRules.join(", ")}`, "")
  if (document.notCompiled !== undefined)
    out.push("some rules did not compile (see above), so unused and removed rules are not listed", "")
  if (document.window.truncated) out.push("the log was rotated: findings older than its first record are gone", "")
  if (document.skippedLines !== undefined)
    out.push(`${document.skippedLines} unreadable lines in the log were skipped`, "")
  return `${out.join("\n").trimEnd()}\n`
}

/**
 * `rulecast stats [--since 30d] [--format terminal|json]`: per rule, what became of the findings
 * agent hooks reported — fixed, ignored at a stop, suppressed, prevented — read from the project's findings log
 * (core/stats/log.ts). Read-only: it never fetches a rule repo and never exits 1.
 */
export async function statsCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { since: { type: "string" }, format: { type: "string", default: "terminal" } },
  })
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  const since = values.since === undefined ? null : parseSince(values.since, new Date())
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const home = cacheHome(io.env)
  const stateDir = projectStateDir(home, root)
  const { records, skipped, rotated } = await readFindingsLog(stateDir)
  const rollup = await readWeeklyRollup(stateDir)
  if (records.length === 0 && rollup.rows.length === 0 && values.format === "terminal") {
    io.stdout("no findings recorded yet (the log fills as agent hooks run)\n")
    return 0
  }

  const project = await compile({ root, registry, repos: cachedRepos(home) })
  const notCompiled = project.diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnosticText(diagnostic))
  for (const text of notCompiled) io.stderr(`rulecast stats: not compiled: ${text}\n`)
  const from = since?.toISOString()
  // Replayed once, from the start: the trend needs every life, the table those from `since` on.
  const lives = derive(records)
  const rules = ruleStats(lives.filter((life) => from === undefined || life.firstAt >= from))
  const fired = new Set(rules.map((rule) => rule.rule))
  const configured = new Set(project.rules.map((rule) => rule.id))
  const windowed = records.filter((record) => from === undefined || record.at >= from)
  const firstRecord = records.reduce<string | null>(
    (first, { at }) => (first === null || at < first ? at : first),
    null,
  )
  // Touch rules have no detector and never fire a finding.
  const detectorRules = project.rules.filter((rule) => rule.enabled && rule.detector !== null).map((rule) => rule.id)
  const neverFired = detectorRules.filter((rule) => !fired.has(rule)).sort()
  const runs = ruleRuns(windowed)
  const lastRecord = records.reduce<string | null>((last, { at }) => (last === null || at > last ? at : last), null)
  // What is at or before the summary's cutoff is counted from the summary only.
  const trend = weeklyTrend([...rollup.rows, ...weekRows(records, lives, rollup.rolledUpTo)], {
    since: from ?? null,
    last: lastRecord ?? rollup.rolledUpTo,
    rolledUpTo: rollup.rolledUpTo,
  })
  const skippedLines = skipped + rollup.skipped
  const document: StatsDocument = {
    schemaVersion: STATS_SCHEMA_VERSION,
    window: {
      since: from ?? null,
      firstRecord,
      lastRecord,
      truncated: rotated && (from === undefined || (firstRecord !== null && firstRecord > from)),
    },
    sessions: new Set(windowed.map((record) => record.s)).size,
    rules,
    ...(notCompiled.length > 0
      ? { notCompiled }
      : {
          neverFired,
          neverRan: neverFired.filter((rule) => (runs.get(rule) ?? 0) === 0),
          runs: Object.fromEntries(detectorRules.map((rule) => [rule, runs.get(rule) ?? 0])),
          stopBlocks: stopBlocks(windowed),
          unknownRules: [...fired].filter((rule) => !configured.has(rule)).sort(),
        }),
    weekly: { ...trend, summary: project.config.stats.weeklySummary ? "on" : "off" },
    ...(skippedLines > 0 ? { skippedLines } : {}),
  }
  io.stdout(values.format === "json" ? `${JSON.stringify(document, null, 2)}\n` : terminal(document))
  return 0
}
