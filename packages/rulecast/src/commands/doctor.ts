import { ADAPTERS } from "../adapters"
import type { CompiledProject } from "../core/compile/project"
import { compile, diagnosticText } from "../core/compile/project"
import { isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver } from "../core/delivery/resolve"
import { memoryCache } from "../core/detection/cache"
import { checkDetectors } from "../core/detection/check"
import { type DetectionContext, detectionFor } from "../core/detection/context"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { errorMessage } from "../core/errors"
import { allFiles } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fetchingRepos } from "../core/repos/provider"
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * Compile, check the environment, report where things live, and dry-run every rule (spec §5).
 * Errors exit 2; warnings do not — an uninstalled adapter is worth saying and is not a broken
 * installation.
 */
export async function doctorCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  if (args.length > 0) throw new UsageError(`doctor takes no arguments: ${args.join(" ")}`)
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

  const project = await compile({ root, registry, repos: fetchingRepos(home) })
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
    const level: Level = file === null || !resolves || stale ? "warning" : "ok"
    count(level)
    const detail =
      file === null
        ? "not installed (run rulecast install)"
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
  io.stdout("\ndry run\n")
  const dry = await dryRun(project, detectionFor(project, registry, stateDir, createReferenceResolver(root)))
  if (dry.length === 0) io.stdout("  nothing to run\n")
  for (const result of dry) {
    count(result.level)
    io.stdout(line(result.level, result.rule, result.detail))
  }

  io.stdout(
    `\n${errors + warnings === 0 ? "no problems found" : [plural(errors, "error"), plural(warnings, "warning")].join(", ")}\n`,
  )
  return errors > 0 ? 2 : 0
}

interface DryRunLine {
  rule: string
  level: Level
  detail: string
}

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
    const file = files.find((candidate) => rule.matches(candidate))
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
      detail: `${file}, ${matches === 0 ? "no match" : matches === 1 ? "1 match" : `${matches} matches`}`,
    })
  }
  return lines
}
