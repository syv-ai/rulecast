import { parseArgs } from "node:util"

import { STATS_SCHEMA_VERSION } from "../adapters/cli/contract"
import { compile } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome, projectStateDir } from "../core/home"
import { cachedRepos } from "../core/repos/provider"
import { derive, type RuleStats, ruleStats } from "../core/stats/derive"
import { readFindingsLog } from "../core/stats/log"
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
  /** Enabled detector rules in the current config with no finding in the window. */
  neverFired: string[]
  /** Rules in the window that are no longer in the config. */
  unknownRules: string[]
  /** Lines of the log that could not be read; present only when there were any. */
  skippedLines?: number
}

const UNITS: Record<string, number> = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000 }

/** `30d`, `12h`, or an ISO date. */
export function parseSince(value: string, now: Date): Date {
  const relative = /^(\d+)([dh])$/.exec(value)
  if (relative !== null) return new Date(now.getTime() - Number(relative[1]) * UNITS[relative[2]!]!)
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value) : null
  if (date === null || Number.isNaN(date.getTime())) {
    throw new UsageError(`--since "${value}" is not a duration or a date (use 30d, 12h or 2026-09-01)`)
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
  ["open", (rule) => String(rule.open)],
  ["repeated", (rule) => String(rule.repeated)],
  ["turns to fix", (rule) => (rule.medianTurnsToFix === null ? "-" : String(rule.medianTurnsToFix))],
]

const percent = (rate: number) => `${Math.round(rate * 100)}%`

function terminal(document: StatsDocument): string {
  const out: string[] = []
  const since = document.window.since ?? document.window.firstRecord
  out.push(`${document.sessions} ${document.sessions === 1 ? "session" : "sessions"} since ${since}`, "")
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
        reason === "repeats" ? `${percent(rule.repeatRate)} repeated` : `${percent(rule.suppressionRate)} suppressed`,
      )
      out.push(`  ${rule.rule}: ${reasons.join(", ")}`)
    }
    out.push("")
  }
  if (document.neverFired.length > 0) out.push(`never fired: ${document.neverFired.join(", ")}`, "")
  if (document.unknownRules.length > 0) out.push(`no longer configured: ${document.unknownRules.join(", ")}`, "")
  if (document.window.truncated) out.push("the log was rotated: findings older than its first record are gone", "")
  if (document.skippedLines !== undefined)
    out.push(`${document.skippedLines} unreadable lines in the log were skipped`, "")
  return `${out.join("\n").trimEnd()}\n`
}

/**
 * `rulecast stats [--since 30d] [--format terminal|json]`: per rule, what became of the findings
 * agent hooks reported — fixed, ignored at a stop, suppressed — read from the project's findings log
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
  const { records, skipped, rotated } = await readFindingsLog(projectStateDir(home, root))
  if (records.length === 0 && values.format === "terminal") {
    io.stdout("no findings recorded yet (the log fills as agent hooks run)\n")
    return 0
  }

  const project = await compile({ root, registry, repos: cachedRepos(home) })
  const lives = derive(records, since)
  const rules = ruleStats(lives)
  const fired = new Set(rules.map((rule) => rule.rule))
  const configured = new Set(project.rules.map((rule) => rule.id))
  const from = since?.toISOString()
  const windowed = records.filter((record) => from === undefined || record.at >= from)
  const firstRecord = records.reduce<string | null>(
    (first, { at }) => (first === null || at < first ? at : first),
    null,
  )
  const lastRecord = records.reduce<string | null>((last, { at }) => (last === null || at > last ? at : last), null)
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
    // Touch rules have no detector and never fire a finding.
    neverFired: project.rules
      .filter((rule) => rule.enabled && rule.detector !== null && !fired.has(rule.id))
      .map((rule) => rule.id)
      .sort(),
    unknownRules: [...fired].filter((rule) => !configured.has(rule)).sort(),
    ...(skipped > 0 ? { skippedLines: skipped } : {}),
  }
  io.stdout(values.format === "json" ? `${JSON.stringify(document, null, 2)}\n` : terminal(document))
  return 0
}
