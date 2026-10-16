import { parseArgs } from "node:util"

import { ADAPTERS } from "../adapters"
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
import { allFiles, isShallow, mergeBase } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { cachedRepos, fetchingRepos } from "../core/repos/provider"
import { hookCommandResolves, hookState } from "./install"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

type Level = "ok" | "warning" | "error" | "skipped"

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

  // Before the compile below, which fetches whatever is missing: what the hooks would find now.
  const uncached = ci ? await uncachedRepos(root, registry, home, io) : []
  // With doctor's own environment: the mode a hook would run in when started from this shell.
  const project = await compile({ root, registry, repos: fetchingRepos(home), env: io.env })
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

  const results = await checkDetectors({
    project,
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

  io.stdout("\nhooks\n")
  // Asked once, not per adapter: every adapter's hook runs the same rulecast.
  const resolves = await hookCommandResolves(root)
  for (const adapter of ADAPTERS) {
    if (adapter.install === null) continue
    const state = await hookState(root, adapter, project.config.timeouts.verifyMs)
    const file = state?.file ?? null
    // Installed but unrunnable is the worst of the three: the settings say it is wired up and
    // nothing ever happens. Found by installing rulecast on rulecast, where `rulecast` is neither
    // on the PATH nor in node_modules/.bin, and doctor said ok.
    const stale = (state?.stale ?? []).length > 0
    const missing = state?.missing ?? []
    // Under --ci, installed but unrunnable is the fresh clone without node_modules: an agent there
    // runs unchecked. Not installed at all stays a warning: a CI job may only run `rulecast run`.
    const level: Level =
      file !== null && !resolves && ci
        ? "error"
        : file === null || !resolves || stale || missing.length > 0
          ? "warning"
          : "ok"
    count(level)
    const detail =
      file === null
        ? "not installed (run rulecast install)"
        : missing.length > 0
          ? `${file} — but hooks for ${missingNames(missing)} missing; run rulecast install`
          : stale
            ? `${file} — but the hooks use an old command; run rulecast install`
            : resolves
              ? file
              : `${file} — but "rulecast" is on neither the PATH nor node_modules/.bin, so the hooks do nothing. Add it to the project (pnpm add -D @syv-ai/rulecast) and run rulecast install again.`
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
  const dry = await dryRun(project, detectionFor(project, registry, stateDir, createReferenceResolver(root)))
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

interface CheckLine {
  level: Level
  what: string
  detail: string
}

/** The pinned repos missing from the cache, compiled as a hook would, with the rules each keeps from running. */
async function uncachedRepos(
  root: string,
  registry: DetectorRegistry,
  home: string,
  io: CliIo,
): Promise<{ source: string; rules: number }[]> {
  const asHooks = await compile({ root, registry, repos: cachedRepos(home), env: io.env })
  return asHooks.diagnostics
    .filter((diagnostic) => diagnostic.hint === "rulecast install")
    .map((diagnostic) => ({ source: diagnostic.source, rules: diagnostic.rules?.length ?? 0 }))
}

/**
 * What a fresh environment gets wrong (#29). Each is checked as the thing that will meet it: the
 * repos as the hooks see them — doctor's own compile fetches any that are missing, so its passing
 * proves nothing about them — and the history as `rulecast run --from-ref` will need it.
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
async function dryRun(project: CompiledProject, detection: DetectionContext): Promise<DryRunLine[]> {
  if (project.rules.length === 0) return []
  let files: string[]
  try {
    files = await allFiles(project.root)
  } catch (error) {
    return [{ rule: "not run", level: "warning", detail: errorMessage(error) }]
  }

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
