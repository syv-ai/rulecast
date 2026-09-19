import { parseArgs } from "node:util"

import { CLI_FORMATS, type CliFormat, exitCodeFor, formatDelivery } from "../adapters/cli/format"
import { type CompiledProject, compile } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { allFiles, changedFilesBetween, changedFilesSince, mergeBase, stagedFiles } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"
import { UsageError } from "./usage"

export interface RunArgs {
  /** Positionals before --files: RULE_ID for run; the repository and RULE_ID for try-repo. */
  leading: string[]
  /** The paths after --files, as given; null without --files. */
  files: string[] | null
  allFiles: boolean
  fromRef: string | null
  toRef: string | null
  format: CliFormat
  session: string | null
  noLlm: boolean
  /** --ref: try-repo only. */
  ref: string | null
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
      "from-ref": { type: "string" },
      "to-ref": { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
      ref: { type: "string" },
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
  if (fromRef !== null && (values.files || values["all-files"])) {
    throw new UsageError("--from-ref cannot be combined with --all-files or --files")
  }
  return {
    leading,
    files: values.files ? files : null,
    allFiles: values["all-files"],
    fromRef,
    toRef,
    format,
    session: values.session ?? null,
    noLlm: values["no-llm"],
    ref: values.ref ?? null,
  }
}

interface SelectedFiles {
  files: string[]
  /** Where the baseline is read from; null: no baseline (or the session's). */
  baseCommit: string | null
}

/** Spec §12, `run` file selection. */
async function selectFiles(root: string, cwd: string, run: RunArgs): Promise<SelectedFiles> {
  if (run.files !== null) {
    const files = run.files
      .map((file) => toProjectPath(root, cwd, file))
      .filter((file): file is string => file !== null)
    return { files, baseCommit: null }
  }
  if (run.fromRef !== null) {
    const base = await mergeBase(root, run.fromRef, run.toRef ?? "HEAD")
    const files =
      run.toRef === null ? await changedFilesSince(root, base) : await changedFilesBetween(root, base, run.toRef)
    return { files, baseCommit: base }
  }
  if (run.allFiles) return { files: await allFiles(root), baseCommit: null }
  // With a session and no files, the pipeline verifies the session's edited files, as a Stop does.
  if (run.session !== null) return { files: [], baseCommit: null }
  return { files: await stagedFiles(root), baseCommit: null }
}

export interface RunInput {
  project: CompiledProject
  /** Run only this rule; null: every rule. */
  ruleId: string | null
  run: RunArgs
  registry: DetectorRegistry
  io: CliIo
}

/** A verify event over the selected files, printed in the chosen format. Shared by run and try-repo. */
export async function executeRun({ project, ruleId, run, registry, io }: RunInput): Promise<number> {
  const root = project.root
  if (ruleId !== null && !project.rules.some((rule) => rule.id === ruleId)) {
    throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
  }
  const selected = await selectFiles(root, io.cwd, run)
  const result = await runPipeline({
    project,
    stateDir: ensureProjectState(cacheHome(io.env), root),
    event: {
      kind: "verify",
      files: selected.files,
      baseCommit: selected.baseCommit ?? undefined,
      session: run.session === null ? undefined : { id: run.session },
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: run.noLlm ? new Set(["llm"]) : undefined,
    onlyRules: ruleId === null ? undefined : new Set([ruleId]),
  })
  const text = formatDelivery(result.delivery, run.format, { maxMatchesPerRule: project.config.maxMatchesPerRule })
  if (text) io.stdout(`${text}\n`)
  return exitCodeFor(result.delivery, result.failed)
}

export async function runCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const run = parseRunArgs(args)
  if (run.ref !== null) throw new UsageError("--ref only applies to try-repo")
  if (run.leading.length > 1) throw new UsageError(`unexpected arguments: ${run.leading.slice(1).join(" ")}`)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  return executeRun({ project, ruleId: run.leading[0] ?? null, run, registry, io })
}
