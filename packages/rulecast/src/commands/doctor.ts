import { constants } from "node:os"
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
import { type DetectorRule, isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { type ActiveMode, ciVariable } from "../core/config/mode"
import { createReferenceResolver, type ReferenceResolver } from "../core/delivery/resolve"
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
import { runPipeline } from "../core/pipeline"
import { configRootsAbove } from "../core/projects"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { cachedRepos, fetchingRepos } from "../core/repos/provider"
import { decide } from "../core/session/decide"
import { emptyContext, emptyWork } from "../core/session/state"
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
 * directory comes after it on the PATH, install.sh would put a newer one where the hooks never reach,
 * so only npm's update is offered. Printed, never run: installing is the developer's step.
 */
function updateRemedy(runs: HookRulecast, minimum: string, dir: string): string {
  if (runs.via === "project") return "update @syv-ai/rulecast in package.json"
  const pinned = isOlder(VERSION, minimum)
  const install = pinned ? pinnedInstallCommand(minimum) : INSTALL_COMMAND
  if (runs.via === "installed") return `install a newer one: ${install}`
  if (!runs.installedBehind) return `install a newer one: ${install}, or update the global npm install`
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

function parseDoctorArgs(args: string[]): { ci: boolean; fromRef: string | null; time: boolean } {
  try {
    const { values } = parseArgs({
      args,
      options: {
        ci: { type: "boolean", default: false },
        "from-ref": { type: "string" },
        time: { type: "boolean", default: false },
      },
      strict: true,
    })
    return { ci: values.ci, fromRef: values["from-ref"] ?? null, time: values.time }
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
  // Rules that cannot run here: said once, above, and not timed again (--time).
  const broken = new Set(results.filter((result) => result.level === "error").flatMap((result) => result.rules))

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
    // Settings that cannot be read are a problem on this line, not the end of the report: the rest
    // of what doctor checks does not depend on them.
    let state: Awaited<ReturnType<typeof hookState>>
    try {
      state = await hookState(dir, adapter, verifyMs)
    } catch (error) {
      const level: Level = ci ? "error" : "warning"
      count(level)
      io.stdout(
        line(level, adapter.label, `cannot read the hooks: ${errorMessage(error)}; fix it, then run rulecast install`),
      )
      continue
    }
    const file = state?.file ?? null
    // Installed but unrunnable is the worst of the three: the settings say it is wired up and
    // nothing ever happens. Found by installing rulecast on rulecast, where `rulecast` is neither
    // on the PATH nor in node_modules/.bin, and doctor said ok.
    const stale = (state?.stale ?? []).length > 0 || (state?.others ?? []).length > 0
    // Which settings files are behind, each named: the one at the start of the line only when others are too.
    const otherFiles = (state?.others ?? []).map((each) => each.file)
    const staleFiles = [...((state?.stale ?? []).length > 0 && file !== null ? [file] : []), ...otherFiles]
    const staleWhere = otherFiles.length === 0 ? "" : ` in ${staleFiles.join(" and ")}`
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
    // Everything install would change besides a missing file, so no settings file it rewrites goes
    // unnamed: hooks missing in the file named first, stale ones there or elsewhere, a script that differs.
    const behind = [
      ...(missing.length > 0 ? [`hooks for ${missingNames(missing)} missing`] : []),
      ...(stale ? [`the hooks${staleWhere} are out of date`] : []),
      ...(differs !== null ? [`${differs.file} is out of date`] : []),
    ]
    const outOfDate = behind.length === 0 ? null : behind.join(", and ")
    const cannotRun =
      `rulecast is not in node_modules/.bin, on the PATH or in ${installDir(io.env)}, so no rules run. ` +
      `Install rulecast: ${INSTALL_COMMAND}, or add it to the project (pnpm add -D @syv-ai/rulecast).`
    // An old rulecast is said whatever else is wrong, after what install fixes.
    const oldVersion =
      runs !== null && tooOld
        ? `${runsLabel(runs)}, older than minimum_rulecast_version ${minimum}; ${updateRemedy(runs, minimum!, installDir(io.env))}`
        : null
    const detail =
      file === null
        ? "not installed (run rulecast install)"
        : gone !== null
          ? // Every hook that runs the file fails first; with no rulecast either, both need doing.
            `${file} — but ${gone.file} is missing, so every hook ${state?.allRun ? "" : "that runs it "}fails; run rulecast install` +
            (outOfDate === null ? "" : `. Also: ${outOfDate}`) +
            (runs ? (oldVersion === null ? "" : `. Also: it runs ${oldVersion}`) : `. And ${cannotRun}`)
          : !runs
            ? // The binary comes first: run rulecast install alone would leave a hook with nothing to run.
              `${file} — but ${cannotRun}${outOfDate === null ? "" : ` Also: ${outOfDate}; run rulecast install.`}`
            : outOfDate !== null
              ? `${file} — but ${outOfDate}; run rulecast install${oldVersion === null ? "" : `. Also: it runs ${oldVersion}`}`
              : `${file} — runs ${oldVersion ?? runsLabel(runs)}`
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
  // The dry run and --time run the project's tools, a formatter hook among them, which rewrites files
  // until it is put back. Ctrl-C there ends the tools (core/detection/tool.ts forwards it), lets the
  // rule being run put back what it changed, and stops before the next.
  const stop: { signal: NodeJS.Signals | null } = { signal: null }
  // Ends the detection running now, so a hook rule does not go on to its next hook's tool.
  const cancel = new AbortController()
  const interrupt = (signal: NodeJS.Signals) => {
    stop.signal ??= signal
    cancel.abort()
  }
  for (const signal of INTERRUPTS) process.on(signal, interrupt)
  try {
    io.stdout("\ndry run\n")
    const dry = await dryRun(
      project,
      detectionFor(project, registry, stateDir, createReferenceResolver(root)),
      listed,
      () => stop.signal !== null,
      cancel.signal,
    )
    if (dry.length === 0) io.stdout("  nothing to run\n")
    for (const result of dry) {
      count(result.level)
      io.stdout(line(result.level, result.rule, result.detail))
      if (result.failed === true) broken.add(result.rule)
    }
    // A rule with violations in four files and none in the one tried reads "no match" above.
    if (dry.some((result) => result.tried)) io.stdout(`  ${DRY_RUN_FOOTER}\n`)

    if (flags.time && stop.signal === null) {
      io.stdout("\ntiming\n")
      const timed = await timeRules({
        project,
        detection: detectionFor(project, registry, stateDir, createReferenceResolver(root)),
        registry,
        stateDir,
        listed,
        broken,
        stopped: () => stop.signal !== null,
        cancel: cancel.signal,
      })
      for (const result of timed) {
        count(result.level)
        io.stdout(line(result.level, result.rule, result.detail))
      }
    }
  } finally {
    for (const signal of INTERRUPTS) process.off(signal, interrupt)
  }
  if (stop.signal !== null) {
    io.stderr("rulecast: doctor interrupted; the tools it ran have stopped, and files they changed are put back\n")
    return 128 + constants.signals[stop.signal]
  }

  const neighbours = await neighbourProjects(project, listed, registry, home, io.env)
  const payloads = await touchPayloads(project, listed, createReferenceResolver(root), neighbours)
  if (payloads.length > 0) {
    io.stdout("\ntouch context\n")
    for (const payload of payloads) {
      count(payload.level)
      io.stdout(line(payload.level, payload.what, payload.detail))
    }
  }

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
  /** true: the rule's detector failed, so --time does not run it again. A timeout is not a failure. */
  failed?: boolean
}

/** What doctor stops on, once the rule being run has ended and put back what it changed. */
const INTERRUPTS = ["SIGINT", "SIGTERM"] as const

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
  stopped: () => boolean,
  cancel: AbortSignal,
): Promise<DryRunLine[]> {
  if (project.rules.length === 0) return []
  if ("error" in listed) return [{ rule: "not run", level: "warning", detail: errorMessage(listed.error) }]
  const { files } = listed

  const lines: DryRunLine[] = []
  for (const rule of project.rules) {
    if (stopped()) break
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
    // A commit-msg rule judges a message, not the project's files (#79).
    if (rule.stages.includes("commit-msg")) {
      lines.push({
        rule: rule.id,
        level: "ok",
        detail: "judges commit messages: rulecast run --commit-msg FILE runs it",
      })
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
      // A tool past its deadline is ended, and a formatter hook has put its files back, before the next rule runs.
      settle: true,
      signal: cancel,
    })
    if (stopped()) break
    const failure = output.errors[0]
    if (failure) {
      lines.push({ rule: rule.id, level: "error", detail: failure.message, failed: true })
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

/** The smallest message budget of the agents rulecast installs into; null when none has one. */
function agentBudget(): number | null {
  const budgets = ADAPTERS.filter((adapter) => adapter.install !== null && adapter.maxContextChars !== null).map(
    (adapter) => adapter.maxContextChars!,
  )
  return budgets.length === 0 ? null : Math.min(...budgets)
}

/** Another project whose config also applies to some of this project's files (core/projects.ts). */
interface Neighbour {
  project: CompiledProject
  /** How doctor names it: its config's path from this project's root. */
  label: string
}

/**
 * The other projects a hook runs for this project's files: the configs above each file's directory,
 * as `projectsForFiles` finds them, this one left out. Compiled from the cache only, as the hooks do.
 */
async function neighbourProjects(
  project: CompiledProject,
  listed: { files: string[] } | { error: unknown },
  registry: DetectorRegistry,
  home: string,
  env: CliIo["env"],
): Promise<Neighbour[]> {
  if (!("files" in listed)) return []
  if (!project.rules.some((rule) => rule.enabled && rule.stages.includes("touch"))) return []
  const roots = new Set<string>()
  const seen = new Set<string>()
  for (const file of listed.files) {
    const dir = path.dirname(path.join(project.root, file))
    if (seen.has(dir)) continue
    seen.add(dir)
    for (const root of configRootsAbove(dir)) if (path.resolve(root) !== path.resolve(project.root)) roots.add(root)
  }
  const neighbours: Neighbour[] = []
  for (const root of [...roots].sort()) {
    const other = await compile({ root, registry, repos: cachedRepos(home), env }).catch(() => null)
    if (other === null) continue
    neighbours.push({ project: other, label: path.join(path.relative(project.root, root), CONFIG_FILE) })
  }
  return neighbours
}

/** The neighbours whose touch rules send context on the first open of `file`, a path from `root`. */
function alsoSending(root: string, file: string, neighbours: readonly Neighbour[]): Neighbour[] {
  const absolute = path.join(root, file)
  return neighbours.filter(({ project }) => {
    const relative = path.relative(project.root, absolute)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false
    const own = relative.split(path.sep).join("/")
    return project.rules.some((rule) => rule.enabled && rule.stages.includes("touch") && rule.matches(own))
  })
}

/**
 * What the first open of a file sends from its touch rules, for every set of touch rules some file
 * matches: run through the hook's own assemble and budget (core/session/decide.ts), so a section
 * reported cut is one the hook would cut (#69). When other configs' touch rules send context for the
 * same file, the hook divides the message among them (commands/hook.ts `budgetSeats`), and so does
 * this. Empty when no touch rule matches a file.
 */
async function touchPayloads(
  project: CompiledProject,
  listed: { files: string[] } | { error: unknown },
  resolver: ReferenceResolver,
  neighbours: readonly Neighbour[],
): Promise<{ level: Level; what: string; detail: string }[]> {
  if (!("files" in listed)) return []
  const touchRules = project.rules.filter((rule) => rule.enabled && rule.stages.includes("touch"))
  if (touchRules.length === 0) return []
  const groups = new Map<string, { rules: typeof touchRules; sharing: Neighbour[]; files: string[] }>()
  for (const file of listed.files) {
    const rules = touchRules.filter((rule) => rule.matches(file))
    if (rules.length === 0) continue
    const sharing = alsoSending(project.root, file, neighbours)
    const key = [...rules.map((rule) => rule.id), "", ...sharing.map((one) => one.label)].join("\0")
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { rules, sharing, files: [file] })
    else group.files.push(file)
  }
  const budget = agentBudget()
  const cuts: { level: Level; what: string; detail: string; refs: number }[] = []
  for (const { rules, sharing, files } of groups.values()) {
    const decision = await decide({
      agent: "main",
      findings: [],
      touches: rules,
      agentRead: null,
      warnings: [],
      work: emptyWork(),
      context: emptyContext(),
      resolver,
      maxBytes: project.config.context.maxBytes,
      maxBlocks: 1,
      maxContextChars: budget === null ? null : Math.floor(budget / (1 + sharing.length)),
      maxMatchesPerRule: project.config.maxMatchesPerRule,
      stopGate: false,
    })
    const cut = decision.delivery.references.filter((one) => one.state === "read" && one.reason === "budget")
    if (cut.length === 0) continue
    const others = files.length - 1
    const share =
      sharing.length === 0
        ? "more than one message holds"
        : `more than its share of one message holds: ${sharing.map((one) => one.label).join(", ")} ${sharing.length === 1 ? "sends" : "send"} context for it too, and the message is divided among them`
    cuts.push({
      level: "warning",
      what: `${files[0]}${others === 0 ? "" : ` and ${plural(others, "other file")}`}`,
      detail:
        `the first open sends the context of ${plural(rules.length, "touch rule")}, ${share}: ` +
        `${cut.map((one) => one.ref).join(", ")} would be named, not sent. ` +
        `Narrow these rules to the one or two sections that area gets wrong${naming(rules.map((rule) => rule.id))}`,
      refs: cut.length,
    })
  }
  if (cuts.length === 0) return [{ level: "ok", what: "every file's touch context fits in one message", detail: "" }]
  return cuts.sort((a, b) => b.refs - a.refs).map(({ refs: _, ...rest }) => rest)
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * What to do about a rule that does not fit: `rulecast run` has the same verify_ms, so a git hook or
 * CI job running rulecast cuts it off too, and `stages: [edit]` has the 350 ms edit deadline and no
 * stop to run again at. The tool keeps running only on its own, outside rulecast.
 */
const OVER_ADVICE =
  "Raise timeouts.verify_ms (then run rulecast install), or switch the rule off (enabled: false) and run the tool from a git hook or CI job of its own"

interface TimeInput {
  project: CompiledProject
  detection: DetectionContext
  registry: DetectorRegistry
  stateDir: string
  listed: { files: string[] } | { error: unknown }
  /** Rules that cannot run here (a missing tool, a failed dry run): said already, not timed. */
  broken: ReadonlySet<string>
  stopped: () => boolean
  /** Aborted on Ctrl-C: ends the detection running then. */
  cancel: AbortSignal
}

/**
 * `--time` (#83): each rule that runs a tool at a stop (a hook, a command, a linter), once, over
 * every file it matches: the most a stop can hand it. Its wall time against `timeouts.verify_ms`,
 * the stop check's budget, says whether it fits before it is turned on. Metered rules (llm) are
 * not run: their time is a model's, and each run costs money.
 *
 * Alone, one rule's time is its own. A stop runs every rule in one budget, hooks after the others
 * and one at a time, after measuring the baseline, so rules that each fit can still be cut off
 * together: the last line runs them all as `rulecast run --all-files` does, which is that stop.
 */
async function timeRules(input: TimeInput): Promise<DryRunLine[]> {
  const { project, detection, listed, broken } = input
  if (!("files" in listed)) {
    return [
      { rule: "not timed", level: "skipped", detail: "the project's files could not be listed (see the dry run)" },
    ]
  }
  const budget = project.config.timeouts.verifyMs
  const atStop = project.rules.filter(
    (rule): rule is DetectorRule =>
      rule.enabled &&
      isDetectorRule(rule) &&
      rule.stages.includes("verify") &&
      listed.files.some((file) => rule.matches(file)),
  )
  const metered = (rule: DetectorRule) => detection.registry.get(rule.detector.kind)?.metered === true
  // In-process detectors (regex, ast-grep, path) take milliseconds; llm costs money per run.
  const tools = atStop.filter((rule) => detection.registry.get(rule.detector.kind)?.guards !== true && !metered(rule))
  if (tools.length === 0) return [{ rule: "no rule runs a tool when an agent stops", level: "ok", detail: "" }]
  const lines: DryRunLine[] = []
  for (const rule of tools) {
    if (input.stopped()) return lines
    if (broken.has(rule.id)) {
      lines.push({ rule: rule.id, level: "skipped", detail: "not timed: it cannot run here (see above)" })
      continue
    }
    const files = listed.files.filter((file) => rule.matches(file))
    const started = Date.now()
    const output = await runDetection({
      detection: { ...detection, cacheFor: () => memoryCache(), contextFor: async () => [] },
      event: "verify",
      selections: [{ rule, files }],
      changes: new Map(),
      read: (name) => readSourceFile(project.root, name),
      timeoutMs: budget,
      settle: true,
      signal: input.cancel,
    })
    // Ended by Ctrl-C, not by the tool: its result says nothing.
    if (input.stopped()) return lines
    const took = Date.now() - started
    const over = output.timedOut.length > 0
    const failure = output.errors[0]
    lines.push({
      rule: rule.id,
      level: over ? "warning" : failure ? "error" : "ok",
      detail: over
        ? `over timeouts.verify_ms (${seconds(budget)}) on ${plural(files.length, "file")}: a stop or rulecast run that hands it these files cuts it off. ${OVER_ADVICE}`
        : failure
          ? `${seconds(took)}, then failed: ${failure.message}`
          : `${seconds(took)} of ${seconds(budget)} on ${plural(files.length, "file")}`,
    })
  }
  const together = atStop.filter((rule) => !broken.has(rule.id) && !metered(rule))
  // One rule alone was timed above; in-process rules alone take milliseconds.
  if (together.length < 2 || !together.some((rule) => tools.includes(rule)) || input.stopped()) return lines
  const files = listed.files.filter((file) => together.some((rule) => rule.matches(file)))
  const started = Date.now()
  const result = await runPipeline({
    project,
    stateDir: input.stateDir,
    event: { kind: "verify", files, cwd: project.root },
    registry: input.registry,
    maxContextChars: null,
    skipDetectorKinds: new Set(input.registry.kinds().filter((kind) => input.registry.get(kind)?.metered === true)),
    onlyRules: new Set(together.map((rule) => rule.id)),
    signal: input.cancel,
  })
  if (input.stopped()) return lines
  const took = Date.now() - started
  const cut = together.filter((rule) => result.ran?.has(rule.id) !== true).map((rule) => rule.id)
  const what = `all ${together.length} rules together`
  const how = `as a stop that changed every file runs them, on ${plural(files.length, "file")}`
  lines.push(
    took >= budget
      ? {
          rule: what,
          level: "warning",
          detail: `over timeouts.verify_ms (${seconds(budget)}) ${how}: ${cut.length === 0 ? "the stop" : cut.join(", ")} would be cut off. ${OVER_ADVICE}, for the slowest`,
        }
      : { rule: what, level: "ok", detail: `${seconds(took)} of ${seconds(budget)} ${how}` },
  )
  return lines
}
