import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS } from "../adapters"
import {
  BASELINE_FILE,
  baselineAge,
  baselineSize,
  type CommittedBaseline,
  readCommittedBaseline,
} from "../core/baseline/committed"
import { INSTALL_COMMAND, installDir, pinnedInstallCommand } from "../core/binary-home"
import type { CompiledProject } from "../core/compile/project"
import { compile, diagnosticText } from "../core/compile/project"
import { isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { type ActiveMode, ciVariable } from "../core/config/mode"
import { createReferenceResolver } from "../core/delivery/resolve"
import { memoryCache } from "../core/detection/cache"
import { checkDetectors } from "../core/detection/check"
import { type DetectionContext, detectionFor } from "../core/detection/context"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { errorMessage } from "../core/errors"
import { FINDING_ID_VERSION } from "../core/finding-id"
import { allFiles, isShallow, mergeBase } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { cachedRepos, fetchingRepos } from "../core/repos/provider"
import { isOlder, VERSION } from "../core/version"
import {
  configLabel,
  type HookRulecast,
  hookConfigs,
  hookRulecasts,
  hookState,
  reachableConfigs,
  settingsDir,
} from "./install"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** `info` is said and not counted: it changes no exit code. */
type Level = "ok" | "warning" | "error" | "skipped" | "info"

/** Which rulecast the hooks run, and its version when it printed one. */
function runsLabel(runs: HookRulecast): string {
  const label =
    runs.via === "project"
      ? "node_modules/.bin/rulecast"
      : runs.via === "path"
        ? `rulecast on the PATH (${runs.path})`
        : `install.sh's rulecast at ${runs.path}, ${runs.installedOnPath ? "on the PATH" : "which is not on the PATH"}`
  return runs.version === null ? label : `${label} ${runs.version}`
}

/**
 * How to update the rulecast the hooks run, by where it came from: the install command for
 * install.sh's, for the release minimum_rulecast_version names when that is newer than this
 * rulecast, else the latest. Another on the PATH is a global npm install as a rule. When install.sh's
 * directory is on the PATH after it, install.sh would put a newer one where the hooks never reach,
 * so only npm's update is offered. Printed, never run: installing is the developer's step.
 */
function updateRemedy(runs: HookRulecast, minimum: string, dir: string): string {
  if (runs.via === "project") return "update @syv-ai/rulecast in package.json"
  const pinned = isOlder(VERSION, minimum)
  const install = pinned ? pinnedInstallCommand(minimum) : INSTALL_COMMAND
  if (runs.via === "installed") return `install a newer one: ${install}`
  if (!runs.installedOnPath) return `install a newer one: ${install}, or update the global npm install`
  const npm = `npm install -g @syv-ai/rulecast${pinned ? `@${minimum}` : ""}`
  return `update the global npm install: ${npm}. It comes before ${dir} on the PATH, so install.sh's would not run`
}

/** Generous: a check may spawn a process or load a native module, and doctor waits for no hook. */
const CHECK_TIMEOUT_MS = 30_000

/** A status line: a padded level, then what was checked and why. */
function line(level: Level, what: string, detail: string): string {
  return `  ${level.padEnd(7)}  ${what}${detail === "" ? "" : ` — ${detail}`}\n`
}

/** The rules a result decides the fate of, short enough to read at the end of a line. */
function naming(rules: string[]): string {
  if (rules.length === 0) return ""
  if (rules.length <= 3) return ` (${rules.join(", ")})`
  return ` (${rules.slice(0, 3).join(", ")} and ${rules.length - 3} more)`
}

/** "PreToolUse (Bash)", "PostToolUse (Bash)" → "Bash": the tools a missing hook watches, else the group. */
function missingNames(groups: string[]): string {
  const names = groups.map((group) => (/ToolUse/.test(group) ? (/\((.*)\)$/.exec(group)?.[1] ?? group) : group))
  return [...new Set(names)].join(", ")
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** "unattended — from RULECAST_MODE=unattended; up to 10 blocked stops per prompt". */
function modeText(mode: ActiveMode, config: CompiledProject["config"]): string {
  const source =
    mode.source === "env"
      ? `from ${mode.detail}`
      : mode.source === "config"
        ? `from ${mode.detail} in ${CONFIG_FILE}`
        : mode.source === "ci"
          ? `detected from ${mode.detail}`
          : mode.ignored !== undefined
            ? "default (RULECAST_MODE ignored; no mode or CI)"
            : "default (no RULECAST_MODE, mode or CI)"
  const blocks = mode.mode === "unattended" ? config.unattended.maxBlocks : config.stopGate.maxBlocks
  return `${mode.mode} — ${source}; up to ${plural(blocks, "blocked stop")} per prompt`
}

function parseDoctorArgs(args: string[]): { ci: boolean; fromRef: string | null } {
  try {
    const { values } = parseArgs({
      args,
      options: { ci: { type: "boolean", default: false }, "from-ref": { type: "string" } },
      strict: true,
    })
    return { ci: values.ci, fromRef: values["from-ref"] ?? null }
  } catch (error) {
    throw new UsageError(`doctor: ${errorMessage(error)}`)
  }
}

/**
 * Compile, check the environment, report where things live, and dry-run every rule (spec §5).
 * Errors exit 2; warnings do not — an uninstalled adapter is worth saying and is not a broken
 * installation.
 *
 * `--ci`, and any run under CI (#29), checks what a fresh environment gets wrong, as the hooks and
 * `rulecast run` will meet it: rule repos missing from the cache, hooks that cannot run, a shallow
 * clone. Problems that are warnings at a desk are errors there, so the job fails before an agent
 * runs degraded and believes it was checked.
 */
export async function doctorCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const flags = parseDoctorArgs(args)
  const ci = flags.ci || flags.fromRef !== null || ciVariable(io.env) !== undefined
  const home = cacheHome(io.env)
  io.stdout("rulecast doctor\n\n")

  if (!hasProject(root)) {
    io.stdout(`home       ${home}\n`)
    io.stderr(`rulecast: no ${CONFIG_FILE} in ${io.cwd} or its parents (run rulecast init)\n`)
    return 2
  }

  let errors = 0
  let warnings = 0
  const count = (level: Level) => {
    if (level === "error") errors++
    if (level === "warning") warnings++
  }

  const stateDir = ensureProjectState(home, root)
  io.stdout(`project    ${root}\n`)

  // With doctor's own environment: the mode a hook would run in when started from this shell.
  // Under --ci with the cache only, as the hooks will find it: fetching here would make the next
  // run pass without `rulecast install` ever being run in the job.
  const project = await compile({ root, registry, repos: ci ? cachedRepos(home) : fetchingRepos(home), env: io.env })
  const uncached = ci ? uncachedRepos(project) : []
  const configErrors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error").length
  const configWarnings = project.diagnostics.length - configErrors
  io.stdout(
    `config     ${CONFIG_FILE} — ${plural(project.rules.length, "rule")}, ` +
      `${plural(configErrors, "error")}, ${plural(configWarnings, "warning")}\n`,
  )
  for (const diagnostic of project.diagnostics) {
    count(diagnostic.level)
    io.stdout(line(diagnostic.level, diagnosticText(diagnostic), ""))
  }
  io.stdout(`mode       ${modeText(project.mode, project.config)}\n`)
  if (project.mode.ignored !== undefined) {
    count("warning")
    io.stdout(
      line("warning", `RULECAST_MODE=${project.mode.ignored} is ignored`, "use attended, interactive or unattended"),
    )
  }

  const baseline = await baselineReport(root)
  if (baseline.level === "ok") io.stdout(`baseline   ${baseline.text}\n`)
  else {
    count(baseline.level)
    io.stdout(`baseline   ${BASELINE_FILE} — cannot be used\n`)
    io.stdout(line(baseline.level, baseline.text, ""))
  }

  // Listed once, for the checks (where each rule would run its tool from) and the dry run.
  const listed: { files: string[] } | { error: unknown } =
    project.rules.length === 0
      ? { files: [] }
      : await allFiles(project.root).then(
          (files) => ({ files }),
          (error: unknown) => ({ error }),
        )
  const results = await checkDetectors({
    project,
    ...("files" in listed && { files: listed.files }),
    registry,
    settings: { llm: project.config.llm },
    env: io.env,
    timeoutMs: CHECK_TIMEOUT_MS,
  })
  if (results.length > 0) {
    io.stdout("\nenvironment\n")
    for (const result of results) {
      count(result.level)
      const rules = result.level === "ok" ? "" : naming(result.rules)
      io.stdout(line(result.level, result.what, `${result.detail}${rules}`))
    }
  }

  // Every config is its own project: the others a session started here also runs.
  const dir = settingsDir(io.cwd)
  const others = (await reachableConfigs(dir)).filter((other) => other !== root)
  if (others.length > 0) {
    io.stdout("\nother configs\n")
    for (const other of others) io.stdout(`  ${path.join(configLabel(dir, other), CONFIG_FILE)}\n`)
  }

  // The settings in this directory: an agent reads them only where its session starts.
  io.stdout(dir === root ? "\nhooks\n" : `\nhooks in ${dir}\n`)
  // Asked once, not per adapter: every adapter's hook runs the same rulecast.
  const found = await hookRulecasts(dir, io.env)
  const runs = found[0] ?? null
  const minimum = project.config.minimumRulecastVersion
  const tooOld = runs?.version != null && minimum !== null && isOlder(runs.version, minimum)
  // The timeout the hooks here need, as install sizes it: the largest of every config they serve.
  // A config that does not load is reported where it is compiled, not here.
  const verifyMs =
    (await hookConfigs(dir, "doctor", undefined, () => {}).catch(() => null))?.verifyMs ??
    project.config.timeouts.verifyMs
  for (const adapter of ADAPTERS) {
    if (adapter.install === null) continue
    const state = await hookState(dir, adapter, verifyMs)
    const file = state?.file ?? null
    // Installed but unrunnable is the worst of the three: the settings say it is wired up and
    // nothing ever happens. Found by installing rulecast on rulecast, where `rulecast` is neither
    // on the PATH nor in node_modules/.bin, and doctor said ok.
    const stale = (state?.stale ?? []).length > 0 || (state?.others ?? []).length > 0
    // Which settings files are behind: the one named at the start of the line, others, or both.
    const otherFiles = (state?.others ?? []).map((each) => each.file).join(" and ")
    const staleWhere =
      otherFiles === "" ? "" : (state?.stale ?? []).length > 0 ? ` there and in ${otherFiles}` : ` in ${otherFiles}`
    const missing = state?.missing ?? []
    // A file the hooks run that is not there fails every hook (sh exits 127): settings committed
    // without the script. One that differs still runs, as an older rulecast's would.
    const gone = state?.files.find((each) => each.problem === "missing") ?? null
    const differs = state?.files.find((each) => each.problem === "differs") ?? null
    // Under --ci, installed but unrunnable is the fresh clone without node_modules: an agent there
    // runs unchecked. Not installed at all stays a warning: a CI job may only run `rulecast run`.
    const level: Level =
      gone !== null || (file !== null && !runs && ci)
        ? "error"
        : file === null || !runs || stale || missing.length > 0 || differs !== null || (file !== null && tooOld)
          ? "warning"
          : "ok"
    count(level)
    const outOfDate =
      missing.length > 0
        ? `hooks for ${missingNames(missing)} missing`
        : stale
          ? `the hooks${staleWhere} are out of date`
          : differs !== null
            ? `${differs.file} is out of date`
            : null
    const detail =
      file === null
        ? "not installed (run rulecast install)"
        : gone !== null
          ? `${file} — but ${gone.file} is missing, so every hook fails; run rulecast install`
          : !runs
            ? // The binary comes first: run rulecast install alone would leave a hook with nothing to run.
              `${file} — but rulecast is not in node_modules/.bin, on the PATH or in ${installDir(io.env)}, so no rules run. ` +
              `Install rulecast: ${INSTALL_COMMAND}, or add it to the project (pnpm add -D @syv-ai/rulecast).` +
              (outOfDate === null ? "" : ` Also: ${outOfDate}; run rulecast install.`)
            : outOfDate !== null
              ? `${file} — but ${outOfDate}; run rulecast install`
              : `${file} — runs ${runsLabel(runs)}${tooOld ? `, older than minimum_rulecast_version ${minimum}; ${updateRemedy(runs, minimum!, installDir(io.env))}` : ""}`
    io.stdout(line(level, adapter.label, detail))
  }
  io.stdout("\ncache\n")
  io.stdout(`  home       ${home}\n`)
  io.stdout(`  project    ${stateDir}\n`)
  for (const entry of project.config.repos) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    const label = repoLabel(entry.repo, entry.rev)
    const cached = cachedRepo(home, entry.repo, entry.rev) !== null
    // Not an error of its own: compile has already said so if it mattered.
    io.stdout(`  repos      ${label} — ${cached ? "cached" : "not fetched (run rulecast install)"}\n`)
  }
  if (ci) {
    io.stdout("\nci\n")
    for (const check of await ciChecks(project, uncached, flags.fromRef)) {
      count(check.level)
      io.stdout(line(check.level, check.what, check.detail))
    }
  }
  io.stdout("\ndry run\n")
  const dry = await dryRun(project, detectionFor(project, registry, stateDir, createReferenceResolver(root)), listed)
  if (dry.length === 0) io.stdout("  nothing to run\n")
  for (const result of dry) {
    count(result.level)
    io.stdout(line(result.level, result.rule, result.detail))
  }
  // A rule with violations in four files and none in the one tried reads "no match" above.
  if (dry.some((result) => result.tried)) io.stdout(`  ${DRY_RUN_FOOTER}\n`)

  io.stdout(
    `\n${errors + warnings === 0 ? "no problems found" : [plural(errors, "error"), plural(warnings, "warning")].join(", ")}\n`,
  )
  return errors > 0 ? 2 : 0
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "2026-03-02 (228 days ago)": a date says when, the count says whether to worry. */
function dated(date: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
  const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`
  return `${date.toISOString().slice(0, 10)} (${ago})`
}

/**
 * The committed baseline's size and age. Information, not a warning: a big old baseline is a
 * team's choice to see, and only a file that cannot be used is a problem.
 */
async function baselineReport(root: string, now = new Date()): Promise<{ level: "ok" | "warning"; text: string }> {
  let baseline: CommittedBaseline | null
  try {
    baseline = await readCommittedBaseline(root)
  } catch (error) {
    return { level: "warning", text: errorMessage(error) }
  }
  if (baseline === null) {
    return { level: "ok", text: "none (rulecast baseline writes one; --from-ref is preferred wherever a ref exists)" }
  }
  if (baseline.findingIdVersion !== FINDING_ID_VERSION) {
    return {
      level: "warning",
      text: `${BASELINE_FILE} holds ids of scheme v${baseline.findingIdVersion} and this rulecast computes v${FINDING_ID_VERSION}, so it matches nothing; run rulecast baseline --force`,
    }
  }
  const size = baselineSize(baseline)
  const age = await baselineAge(root)
  const when =
    age.added === null || age.changed === null
      ? "not committed yet"
      : `added ${dated(age.added, now)}, last changed ${dated(age.changed, now)}${age.dirty ? "; uncommitted changes" : ""}`
  return {
    level: "ok",
    text: `${BASELINE_FILE} — ${plural(size.entries, "finding")}, ${plural(size.rules, "rule")}, ${plural(size.files, "file")}; ${when}`,
  }
}

interface CheckLine {
  level: Level
  what: string
  detail: string
}

/** The pinned repos missing from the cache, with the rules each keeps from running. */
function uncachedRepos(project: CompiledProject): { source: string; rules: number }[] {
  return project.diagnostics
    .filter((diagnostic) => diagnostic.hint === "rulecast install")
    .map((diagnostic) => ({ source: diagnostic.source, rules: diagnostic.rules?.length ?? 0 }))
}

/**
 * What a fresh environment gets wrong (#29). Each is checked as the thing that will meet it: the
 * repos as the hooks see them — compiled from the cache only, since hooks never fetch — and the
 * history as `rulecast run --from-ref` will need it.
 */
async function ciChecks(
  project: CompiledProject,
  uncached: readonly { source: string; rules: number }[],
  fromRef: string | null,
): Promise<CheckLine[]> {
  const checks: CheckLine[] = []
  for (const { source, rules } of uncached) {
    checks.push({
      level: "error",
      what: `${source} not in the cache`,
      detail: `hooks never fetch, so ${plural(rules, "rule")} would not run; run rulecast install before the agent starts`,
    })
  }
  if (uncached.length === 0 && project.config.repos.some((entry) => entry.repo !== "local")) {
    checks.push({ level: "ok", what: "rule repos cached", detail: "" })
  }
  checks.push(
    project.mode.mode === "attended"
      ? {
          level: "warning",
          what: "mode",
          detail: `${modeText(project.mode, project.config)}. An agent run here is gated as if someone were watching`,
        }
      : { level: "ok", what: "mode", detail: modeText(project.mode, project.config) },
  )
  if (fromRef !== null) {
    try {
      await mergeBase(project.root, fromRef)
      checks.push({ level: "ok", what: `merge base with ${fromRef}`, detail: "rulecast run --from-ref can run" })
    } catch (error) {
      checks.push({ level: "error", what: `rulecast run --from-ref ${fromRef}`, detail: errorMessage(error) })
    }
  } else if (await isShallow(project.root)) {
    checks.push({
      level: "warning",
      what: "shallow clone",
      detail: "rulecast run --from-ref needs full history (actions/checkout: fetch-depth: 0)",
    })
  } else checks.push({ level: "ok", what: "full history", detail: "" })
  return checks
}

interface DryRunLine {
  rule: string
  level: Level
  detail: string
  /** true: the rule's detector ran over one of its matching files. */
  tried?: boolean
}

const DRY_RUN_FOOTER = "the dry run tries one file per rule; rulecast run --all-files checks them all"

/**
 * Every rule, alone, against one file it matches (spec §5).
 *
 * One detection per rule rather than one batched run: batching is the hot path's optimisation, and
 * doctor's job is attribution — a rule that throws has to be named, and a rule that matched nothing
 * has to be distinguishable from one that never ran. Nothing here is on a latency budget.
 *
 * A memory cache, not the project's: a dry run that quietly answered from a stale cache would be
 * the wrong answer to the question being asked.
 */
async function dryRun(
  project: CompiledProject,
  detection: DetectionContext,
  listed: { files: string[] } | { error: unknown },
): Promise<DryRunLine[]> {
  if (project.rules.length === 0) return []
  if ("error" in listed) return [{ rule: "not run", level: "warning", detail: errorMessage(listed.error) }]
  const { files } = listed

  const lines: DryRunLine[] = []
  for (const rule of project.rules) {
    if (!rule.enabled) {
      lines.push({ rule: rule.id, level: "skipped", detail: "disabled" })
      continue
    }
    // isDetectorRule, not `rule.detector === null`: narrowing the property does not narrow the
    // rule, and runDetection below takes a rule whose detector is known to be there.
    if (!isDetectorRule(rule)) {
      lines.push({ rule: rule.id, level: "ok", detail: "context only, nothing to run" })
      continue
    }
    // Spec §5: metered rules — llm — are not dry-run. Each run costs money, and doctor is a command
    // people type when something is already wrong; their check reports what can be known for free.
    if (detection.registry.get(rule.detector.kind)?.metered === true) {
      lines.push({
        rule: rule.id,
        level: "skipped",
        detail: `${rule.detector.kind} rules are not dry-run (each run costs money)`,
      })
      continue
    }
    const matching = files.filter((candidate) => rule.matches(candidate))
    const file = matching[0]
    if (file === undefined) {
      lines.push({ rule: rule.id, level: "warning", detail: "no file in the project matches this rule" })
      continue
    }

    const timeoutMs = project.config.timeouts.verifyMs
    const output = await runDetection({
      // Spread over the project's context, so the two deviations read as deviations. The memory
      // cache is the reason given in this function's own comment; context is unused because only
      // the llm detector reads it and llm rules never reach here.
      detection: { ...detection, cacheFor: () => memoryCache(), contextFor: async () => [] },
      event: "verify",
      selections: [{ rule, files: [file] }],
      changes: new Map(),
      read: (name) => readSourceFile(project.root, name),
      timeoutMs,
    })
    const failure = output.errors[0]
    if (failure) {
      lines.push({ rule: rule.id, level: "error", detail: failure.message })
      continue
    }
    if (output.timedOut.length > 0) {
      lines.push({ rule: rule.id, level: "error", detail: `timed out after ${timeoutMs} ms` })
      continue
    }
    const matches = output.findings.length
    lines.push({
      rule: rule.id,
      level: "ok",
      detail: `tried ${file} (1 of ${plural(matching.length, "matching file")}): ${matches === 0 ? "no match" : matches === 1 ? "1 match" : `${matches} matches`}`,
      tried: true,
    })
  }
  return lines
}
