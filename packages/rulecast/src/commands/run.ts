import path from "node:path"
import { parseArgs } from "node:util"

import {
  type BaselineUse,
  CLI_FORMATS,
  type CliFormat,
  exitCodeFor,
  formatDelivery,
  quietly,
  type RuleMetadata,
} from "../adapters/cli/format"
import {
  BASELINE_FILE,
  baselineSize,
  type CommittedBaseline,
  entryVerdict,
  fileExists,
  pruneBaseline,
  readCommittedBaseline,
} from "../core/baseline/committed"
import { type CompiledProject, type CompileOptions, compile, diagnosticText } from "../core/compile/project"
import { allRuleContext } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { WORKTREE } from "../core/content"
import { combineDeliveries } from "../core/delivery/combine"
import { createReferenceResolver, resolveRuleContext } from "../core/delivery/resolve"
import type { DetectorRegistry } from "../core/detection/registry"
import { FINDING_ID_VERSION } from "../core/finding-id"
import {
  allFiles,
  changedFilesBetween,
  changedFilesSince,
  headCommit,
  insideWorkTree,
  mergeBase,
  stagedFiles,
} from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { type PipelineResult, runPipeline } from "../core/pipeline"
import {
  configRootsAbove,
  configRootsBelow,
  dedupe,
  displayPath,
  projectsForFiles,
  sessionRoots,
} from "../core/projects"
import { fetchingRepos } from "../core/repos/provider"
import { recordedMode, sessionDir } from "../core/session/session"
import type { ContentSource, Delivery } from "../core/types"
import { commitMsgRun } from "./commit-msg"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"
import { UsageError } from "./usage"

export interface RunArgs {
  /** Positionals before --files: RULE_ID for run; the repository and RULE_ID for try-repo. */
  leading: string[]
  /** The paths after --files, as given; null without --files. */
  files: string[] | null
  allFiles: boolean
  /** Print the backlog summary and nothing else. */
  summary: boolean
  fromRef: string | null
  toRef: string | null
  format: CliFormat
  session: string | null
  noLlm: boolean
  /** Include metered detectors in a staged run, which skips them by default. */
  llm: boolean
  /** --ref: try-repo only. */
  ref: string | null
  /** --commit-msg FILE: judge the commit message in FILE with the commit-msg rules, and nothing else. */
  commitMsg: string | null
  /** --quiet: print nothing for a clean run, as the git hooks run it (`quietly`). */
  quiet: boolean
}

/** Parses run's flags. Positionals after `--files` are files, like pre-commit's `--files F…`. */
export function parseRunArgs(args: string[]): RunArgs {
  const { values, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      files: { type: "boolean", default: false },
      "all-files": { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
      "from-ref": { type: "string" },
      "to-ref": { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
      llm: { type: "boolean", default: false },
      ref: { type: "string" },
      "commit-msg": { type: "string" },
      quiet: { type: "boolean", default: false },
    },
  })
  const format = values.format as CliFormat
  if (!CLI_FORMATS.includes(format)) {
    throw new UsageError(`unknown format "${values.format}" (use ${CLI_FORMATS.join(", ")})`)
  }

  let filesAt = Number.POSITIVE_INFINITY
  for (const token of tokens) {
    if (token.kind === "option" && token.name === "files") filesAt = Math.min(filesAt, token.index)
  }
  const leading: string[] = []
  const files: string[] = []
  for (const token of tokens) {
    if (token.kind !== "positional") continue
    if (token.index > filesAt) files.push(token.value)
    else leading.push(token.value)
  }

  const fromRef = values["from-ref"] ?? null
  const toRef = values["to-ref"] ?? null
  if (values.files && files.length === 0) throw new UsageError("--files needs at least one file")
  if (values.files && values["all-files"]) throw new UsageError("--all-files and --files cannot be combined")
  if (toRef !== null && fromRef === null) throw new UsageError("--to-ref needs --from-ref")
  // SARIF has nowhere to put a summary, and a flag that is silently ignored is how people stop
  // trusting a tool's output.
  if (values.summary && format === "sarif") throw new UsageError("--summary cannot be combined with --format sarif")
  if (values.llm && values["no-llm"]) throw new UsageError("--llm and --no-llm cannot be combined")
  // A machine format that is sometimes empty is one its reader cannot parse.
  if (values.quiet && format !== "terminal" && format !== "agent")
    throw new UsageError("--quiet is for the terminal and agent formats")
  if (fromRef !== null && (values.files || values["all-files"])) {
    throw new UsageError("--from-ref cannot be combined with --all-files or --files")
  }
  return {
    leading,
    files: values.files ? files : null,
    allFiles: values["all-files"],
    summary: values.summary,
    fromRef,
    toRef,
    format,
    session: values.session ?? null,
    noLlm: values["no-llm"],
    llm: values.llm,
    ref: values.ref ?? null,
    commitMsg: values["commit-msg"] ?? null,
    quiet: values.quiet,
  }
}

/** Which way the files were chosen: what the terminal output says it checked. */
export type Selection = "files" | "range" | "all" | "session" | "staged"

export interface SelectedFiles {
  selection: Selection
  files: string[]
  /** Where the baseline is read from; null: no baseline (or the session's). */
  baseCommit: string | null
  /** Where current content is read from (core/content.ts). */
  content: ContentSource
}

/** Spec §12, `run` file selection. */
export async function selectFiles(root: string, cwd: string, run: RunArgs): Promise<SelectedFiles> {
  if (run.files !== null) {
    const files = run.files
      .map((file) => toProjectPath(root, cwd, file))
      .filter((file): file is string => file !== null)
    return { selection: "files", files, baseCommit: null, content: WORKTREE }
  }
  if (run.fromRef !== null) {
    const base = await mergeBase(root, run.fromRef, run.toRef ?? "HEAD")
    // Without --to-ref, uncommitted work is included on purpose, so it is read from the working
    // tree. With it, a push is judged as it will be pushed: the content at the ref.
    if (run.toRef === null) {
      return { selection: "range", files: await changedFilesSince(root, base), baseCommit: base, content: WORKTREE }
    }
    return {
      selection: "range",
      files: await changedFilesBetween(root, base, run.toRef),
      baseCommit: base,
      content: { kind: "commit", ref: run.toRef },
    }
  }
  if (run.allFiles) return { selection: "all", files: await allFiles(root), baseCommit: null, content: WORKTREE }
  // With a session and no files, the pipeline verifies the session's edited files, as a Stop does.
  if (run.session !== null) return { selection: "session", files: [], baseCommit: null, content: WORKTREE }
  // Staged: a commit is judged as it will be committed — the index, against HEAD — so a line it
  // did not change is backlog here exactly as it is in an agent hook. Before the first commit there
  // is no HEAD and so no baseline: every finding is new.
  return {
    selection: "staged",
    files: await stagedFiles(root),
    baseCommit: await headCommit(root),
    content: { kind: "index" },
  }
}

/** One project a run checks, and the files it judges (root-relative). */
export interface ProjectSelection {
  root: string
  selected: SelectedFiles
}

/** The projects a run checks, nearest first; `displayFrom` is where their paths are shown from. */
export interface RoutedRun {
  projects: ProjectSelection[]
  /** Undefined: paths are shown root-relative, as before configs could sit anywhere. */
  displayFrom: string | undefined
}

const noProject = (cwd: string) => new Error(`no ${CONFIG_FILE} in ${cwd} or its parents`)

/**
 * Which projects a run checks, and each one's files. In a git work tree, the files are chosen as
 * `selectFiles` chooses them, from `cwd` and limited to its subtree (`--files`: as named), and every
 * config above a file judges it (core/projects.ts). The nearest config above `cwd` always runs, with
 * no files if none reached it, so "nothing staged" is said as before. A run over a session checks the
 * nearest project and every project the session's hooks ran (core/projects.ts `sessionRoots`), each
 * over the session's own work, as its Stop does. Any other run outside git is the nearest project's
 * alone. `root`: the nearest config's directory (`findRoot`); `cache`: the cache home.
 */
export async function routeRun(root: string, cwd: string, run: RunArgs, cache: string): Promise<RoutedRun> {
  const nearest = hasProject(root) ? path.resolve(root) : null
  if (run.session !== null) {
    const recorded = (await sessionRoots(cache, run.session)).filter(hasProject)
    const roots = dedupe([...(nearest === null ? [] : [nearest]), ...recorded])
    if (roots.length === 0) throw noProject(cwd)
    return {
      projects: await Promise.all(
        roots.map(async (dir) => ({ root: dir, selected: await selectFiles(dir, cwd, run) })),
      ),
      displayFrom: path.resolve(cwd),
    }
  }
  if (!(await insideWorkTree(cwd))) {
    if (nearest === null) throw noProject(cwd)
    return { projects: [{ root: nearest, selected: await selectFiles(nearest, cwd, run) }], displayFrom: undefined }
  }
  const gathered: SelectedFiles =
    run.files !== null
      ? { selection: "files", files: run.files, baseCommit: null, content: WORKTREE }
      : await selectFiles(cwd, cwd, run)
  const routed = projectsForFiles(cwd, gathered.files)
  const above = configRootsAbove(cwd)
  const roots = [
    ...above.filter((dir) => dir === nearest || routed.has(dir)),
    ...[...routed.keys()].filter((dir) => !above.includes(dir)).sort(),
  ]
  if (roots.length === 0) {
    // Configs only below cwd, and none of them reached: the first one says what was checked.
    const below = await configRootsBelow(cwd)
    if (below.length === 0) throw noProject(cwd)
    roots.push(below[0]!)
  }
  return {
    projects: roots.map((dir) => ({ root: dir, selected: { ...gathered, files: routed.get(dir) ?? [] } })),
    displayFrom: path.resolve(cwd),
  }
}

export interface RunInput {
  project: CompiledProject
  /** Run only this rule; null: every rule. */
  ruleId: string | null
  run: RunArgs
  registry: DetectorRegistry
  io: CliIo
  /** Read `.rulecast/baseline.json` when the run has no other baseline. False for try-repo: foreign rules, foreign ids. */
  committedBaseline: boolean
  /** Where paths are shown from (`RoutedRun`); undefined: root-relative. */
  displayFrom?: string
}

/** SARIF's rule metadata for the rules that have findings, with the text of the sections they cite. */
async function ruleMetadata(project: CompiledProject, ids: ReadonlySet<string>): Promise<RuleMetadata[]> {
  const resolver = createReferenceResolver(project.root)
  const rules = project.rules.filter((rule) => ids.has(rule.id))
  return Promise.all(
    rules.map(async (rule) => {
      const cited = allRuleContext(rule)
      const resolved = new Map((await resolveRuleContext(resolver, cited)).map((entry) => [entry.ref, entry]))
      return {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        severity: rule.severity,
        source: rule.source,
        context: cited.map((spec) => ({ ref: spec.ref, content: resolved.get(spec.ref)?.content ?? null })),
      }
    }),
  )
}

/**
 * The committed baseline, when this run has no other: no base commit (so not `--from-ref`, and not
 * a staged run once there is a HEAD) and no session. Null when there is none, or its ids are from
 * another scheme and so can match nothing, which is said in `warnings`.
 */
async function committedFor(root: string, selected: SelectedFiles, run: RunArgs, warnings: string[]) {
  if (selected.baseCommit !== null || run.session !== null) return null
  const baseline = await readCommittedBaseline(root)
  if (baseline === null || baseline.findingIdVersion === FINDING_ID_VERSION) return baseline
  warnings.push(
    `${BASELINE_FILE} holds ids of scheme v${baseline.findingIdVersion} and this rulecast computes v${FINDING_ID_VERSION}, so nothing was matched against it; run rulecast baseline --force`,
  )
  return null
}

/** The `baseline` key: how much of the file this run found again, and how much it showed is gone. */
function baselineUse(project: CompiledProject, baseline: CommittedBaseline, result: PipelineResult): BaselineUse {
  const findings = result.findings ?? []
  const found = new Set([...findings, ...(result.ignored ?? [])].flatMap(({ id }) => (id === undefined ? [] : [id])))
  const verdict = entryVerdict({
    rules: project.rules,
    compiledCleanly: !project.diagnostics.some((diagnostic) => diagnostic.level === "error"),
    ran: result.ran ?? new Map(),
    exists: fileExists(project.root),
  })
  return {
    file: BASELINE_FILE,
    entries: baselineSize(baseline).entries,
    matched: findings.filter((finding) => finding.status === "preexisting").length,
    stale: pruneBaseline(baseline, found, verdict).removed.length,
  }
}

/** What a verify over the selected files found, before it is printed. */
export interface RunCheck {
  result: PipelineResult
  selected: SelectedFiles
  /** Metered rules left out of this run (a staged run, --no-llm) that matched a checked file. */
  skipped: string[]
  complete: boolean
  /** The committed baseline the run classified against; null when it used none. */
  committed: CommittedBaseline | null
}

/**
 * The verify event `run` prints, without printing it: `fix` runs it after writing, for its exit
 * code. `selected`: files already chosen, so a check after a fix judges the files the fix looked at.
 */
export async function checkRun(
  { project, ruleId, run, registry, io, committedBaseline, displayFrom }: RunInput,
  selected?: SelectedFiles,
): Promise<RunCheck> {
  const root = project.root
  // A config file that does not load compiled no rule at all: a report would say "no findings" of
  // a run that checked nothing. Checked before the rule id, which no rule could match.
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  if (ruleId !== null && !project.rules.some((rule) => rule.id === ruleId)) {
    throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
  }
  selected ??= await selectFiles(root, io.cwd, run)
  const baselineWarnings: string[] = []
  const committed = committedBaseline ? await committedFor(root, selected, run, baselineWarnings) : null
  // Spec §6, Consent, applied to a commit: a staged run is a pre-commit hook, which fires on every
  // commit of every teammate, so a detector that costs money per file is left out unless asked for.
  // --no-llm leaves it out everywhere. The registry says which kinds are metered; the core names none.
  const skipMetered = run.noLlm || (selected.selection === "staged" && !run.llm)
  const meteredKinds = new Set(registry.kinds().filter((kind) => registry.get(kind)?.metered === true))
  const files = selected.files
  const skipped = skipMetered
    ? project.rules
        .filter((rule) => rule.enabled && rule.detector !== null && meteredKinds.has(rule.detector.kind))
        .filter((rule) => ruleId === null || rule.id === ruleId)
        .filter((rule) => rule.stages.includes("verify") && files.some((file) => rule.matches(file)))
        .map((rule) => rule.id)
    : []
  const result = await runPipeline({
    project,
    stateDir: ensureProjectState(cacheHome(io.env), root),
    event: {
      kind: "verify",
      files: selected.files,
      baseCommit: selected.baseCommit ?? undefined,
      content: selected.content,
      session: run.session === null ? undefined : { id: run.session },
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: skipMetered ? meteredKinds : undefined,
    onlyRules: ruleId === null ? undefined : new Set([ruleId]),
    ...(committed === null ? {} : { committedBaseline: committed }),
    // The machine formats report pre-existing findings by id; the others summarise them.
    listPreexisting: run.format === "json" || run.format === "sarif",
    reportDisabled: true,
    ...(displayFrom === undefined ? {} : { displayFrom }),
  })
  // A warning, not a failure: every rule ran, and the findings are right for a run with no baseline.
  result.delivery.warnings.push(...baselineWarnings)
  return { result, selected, skipped, complete: !result.failed, committed }
}

/** One project's check as `formatRun` takes it; `delivery` replaces the check's own (fix's dry run). */
export interface ProjectCheck {
  project: CompiledProject
  check: RunCheck
  delivery?: Delivery
}

/**
 * Checks, nearest project first, as `run` prints them: one answer from every project's delivery
 * (`combineDeliveries`), SARIF one run per project. `extra`: keys another command adds to the JSON
 * document. `maxMatchesPerRule` is the nearest project's.
 */
export async function formatRun(
  run: RunArgs,
  checks: readonly ProjectCheck[],
  displayFrom: string | undefined,
  extra?: Record<string, unknown>,
): Promise<string> {
  const parts = checks.map((part) => ({ ...part, delivery: part.delivery ?? part.check.result.delivery }))
  const nearest = parts[0]!
  const delivery =
    displayFrom === undefined
      ? nearest.delivery
      : combineDeliveries(
          parts.map(({ project, delivery }) => ({ root: project.root, delivery })),
          displayFrom,
        )
  const shown = (root: string) => displayPath(root, displayFrom)
  const checkedFiles = new Set(
    parts.flatMap(({ project, check }) => check.selected.files.map((file) => path.resolve(project.root, file))),
  )
  const baselines = parts.map(({ project, check }) => ({
    root: shown(project.root)("."),
    baseline:
      check.committed === null
        ? null
        : { ...baselineUse(project, check.committed, check.result), file: shown(project.root)(BASELINE_FILE) },
  }))
  const complete = parts.every(({ check }) => check.complete)
  const withFindings = (part: (typeof parts)[number]) =>
    new Set([...part.delivery.findings, ...(part.delivery.preexisting ?? [])].map((finding) => finding.rule))
  return formatDelivery(delivery, run.format, {
    maxMatchesPerRule: nearest.project.config.maxMatchesPerRule,
    findings: !run.summary,
    backlog: run.allFiles || run.summary,
    skipped: [...new Set(parts.flatMap(({ check }) => check.skipped))],
    checked: { files: checkedFiles.size, selection: nearest.check.selected.selection },
    ignored: parts.flatMap(({ project, check }) =>
      (check.result.ignored ?? []).map(({ id, rule, match, reason }) => ({
        ...(id === undefined ? {} : { id }),
        rule: rule.id,
        file: shown(project.root)(match.file),
        line: match.line,
        reason,
      })),
    ),
    complete,
    ...(parts.length === 1 ? { baseline: baselines[0]!.baseline } : { baselines }),
    ...(run.format !== "sarif"
      ? {}
      : parts.length === 1
        ? { rules: await ruleMetadata(nearest.project, withFindings(nearest)) }
        : {
            runs: await Promise.all(
              parts.map(async (part, index) => ({
                root: baselines[index]!.root,
                delivery: part.delivery,
                rules: await ruleMetadata(part.project, withFindings(part)),
                complete: part.check.complete,
              })),
            ),
          }),
    ...(extra === undefined ? {} : { extra }),
  })
}

/** The highest exit code across the projects' checks. */
export function exitCodeForChecks(checks: readonly ProjectCheck[]): number {
  return Math.max(
    ...checks.map(({ check, delivery }) => exitCodeFor(delivery ?? check.result.delivery, check.complete)),
  )
}

/** A verify event over the selected files, printed in the chosen format. Shared by run and try-repo. */
export async function executeRun(input: RunInput): Promise<number> {
  const check = await checkRun(input)
  const text = await formatRun(input.run, [{ project: input.project, check }], input.displayFrom)
  if (text) input.io.stdout(`${text}\n`)
  return exitCodeFor(check.result.delivery, check.complete)
}

/**
 * A run is attended: a commit or a CI job has no agent to answer. A run over a session is the
 * session's picture, so it takes the mode the session's hooks recorded, or, for a session recorded
 * before modes were, resolves it as they would have.
 */
async function modeFor(root: string, run: RunArgs, io: CliIo): Promise<Pick<CompileOptions, "mode" | "env">> {
  if (run.session === null) return {}
  const recorded = await recordedMode(sessionDir(ensureProjectState(cacheHome(io.env), root), run.session))
  return recorded === null ? { env: io.env } : { mode: recorded }
}

/** A routed run's projects, compiled, nearest first. */
export interface CompiledRun {
  projects: { project: CompiledProject; selected: SelectedFiles }[]
  displayFrom: string | undefined
}

/**
 * Compiles every project of a routed run, in parallel. A config that does not load fails the whole
 * run, nearest first. With `ruleId`, only the projects that define it are kept: an error when none
 * does.
 */
export async function compileRun(
  routed: RoutedRun,
  ruleId: string | null,
  run: RunArgs,
  registry: DetectorRegistry,
  io: CliIo,
): Promise<CompiledRun> {
  const compiled = await Promise.all(
    routed.projects.map(async ({ root, selected }) => ({
      project: await compile({
        root,
        registry,
        repos: fetchingRepos(cacheHome(io.env)),
        ...(await modeFor(root, run, io)),
      }),
      selected,
    })),
  )
  for (const { project } of compiled) {
    const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
    if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  }
  const projects =
    ruleId === null ? compiled : compiled.filter(({ project }) => project.rules.some((rule) => rule.id === ruleId))
  if (projects.length === 0) throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
  return { projects, displayFrom: routed.displayFrom }
}

/**
 * Every project above a selected file checks it, each with its own baseline, state and mode, in
 * parallel: each writes only its own state directory. One answer, and the highest exit code.
 */
export async function runCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const run = parseRunArgs(args)
  if (run.ref !== null) throw new UsageError("--ref only applies to try-repo")
  if (run.commitMsg !== null) {
    const other = run.leading.length > 0 || run.files !== null || run.allFiles || run.fromRef !== null || run.summary
    if (other)
      throw new UsageError("--commit-msg judges a commit message: it takes no files, refs, rule id or --summary")
    // A commit-msg rule never runs a metered detector (compileRule), and a message is no session's work.
    const flag = run.llm ? "--llm" : run.noLlm ? "--no-llm" : run.session !== null ? "--session" : null
    if (flag !== null) throw new UsageError(`${flag} does not apply to --commit-msg`)
    if (run.format === "sarif") throw new UsageError("--commit-msg has no SARIF output: use terminal, agent or json")
    return commitMsgRun(run.commitMsg, run.format, registry, io, run.quiet)
  }
  if (run.leading.length > 1) throw new UsageError(`unexpected arguments: ${run.leading.slice(1).join(" ")}`)
  const ruleId = run.leading[0] ?? null
  const { projects, displayFrom } = await compileRun(
    await routeRun(root, io.cwd, run, cacheHome(io.env)),
    ruleId,
    run,
    registry,
    io,
  )
  const checks = await Promise.all(
    projects.map(async ({ project, selected }) => ({
      project,
      check: await checkRun(
        {
          project,
          ruleId,
          run,
          registry,
          io,
          committedBaseline: true,
          ...(displayFrom === undefined ? {} : { displayFrom }),
        },
        selected,
      ),
    })),
  )
  const text = await formatRun(run, checks, displayFrom)
  const code = exitCodeForChecks(checks)
  const deliveries = checks.map(({ check }) => check.result.delivery)
  if (text && !quietly(run.quiet, code, deliveries)) io.stdout(`${text}\n`)
  return code
}
