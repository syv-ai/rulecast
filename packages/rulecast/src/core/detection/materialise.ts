import { git } from "../git"
import type { ContentSource } from "../types"
import { type DetectionInput, type DetectionOutput, runDetection } from "./run"
import { withScratchTree } from "./scratch"
import type { Selection } from "./select"

/** The scratch directory's prefix for staged and `--to-ref` runs, inside the project root. */
export const STAGED_DIR = ".rulecast-staged-"

/**
 * Detection over content that is not the working tree: the index for a staged run, a commit for
 * `--to-ref` (spec §12).
 *
 * Every rule must judge that content, not whatever happens to be on disk, and three kinds of
 * detector get it three ways:
 *
 * - **`guards`** (`regex`, `path`, `ast-grep`) already read only through `read`.
 * - **`takesContent`** (ruff, eslint, `llm`) are run with `fromDisk: false`: they read through
 *   `read` and hand the text to their tool under the file's real path, so configuration keyed on
 *   that path still applies.
 * - **`wholeProject`** (a `command` rule with `scope: project`, a `hook`) need the real tree — its
 *   imports, venv and node_modules — which a scratch copy does not have. They run on the working
 *   tree when their files there equal the content, and are skipped with a warning when not. Never
 *   by stashing: a stash under a running agent can lose its work.
 * - **The rest** (`command`, oxlint) are given a scratch copy inside the project root and their
 *   findings are mapped back. A `command` script sees a scratch path; that is the documented limit.
 *
 * With the working tree as the source this is `runDetection` unchanged.
 */
export async function runDetectionFrom(input: DetectionInput, source: ContentSource): Promise<DetectionOutput> {
  if (source.kind === "worktree") return runDetection(input)
  const registry = input.detection.registry
  const direct: Selection[] = []
  const copied: Selection[] = []
  const tree: Selection[] = []
  for (const selection of input.selections) {
    const detector = registry.get(selection.rule.detector.kind)
    const config = selection.rule.detector.config
    const readsContent = detector?.guards === true || detector?.takesContent?.(config) === true
    // An unregistered kind goes direct: runDetection reports it as an error, which a scratch copy
    // would only delay.
    if (readsContent || detector === undefined) direct.push(selection)
    else if (detector.wholeProject?.(config) === true) tree.push(selection)
    else copied.push(selection)
  }
  const outputs = await Promise.all([
    direct.length === 0 ? null : runDetection({ ...input, selections: direct, fromDisk: false }),
    copied.length === 0 ? null : fromScratch(input, copied),
    tree.length === 0 ? null : onWorkingTree(input, tree, source),
  ])
  return merge(outputs.filter((output): output is DetectionOutput => output !== null))
}

/**
 * The files among `files` whose working-tree content differs from `source`: unstaged changes for
 * the index, any change since the commit for `--to-ref`. The only place a staged run asks git.
 */
export async function unstagedChanges(files: string[], cwd: string, source: ContentSource): Promise<string[]> {
  if (source.kind === "worktree" || files.length === 0) return []
  const against = source.kind === "commit" ? [source.ref] : []
  const result = await git(cwd, ["diff", "--name-only", "--no-renames", ...against, "--", ...files])
  if (!result.ok) throw new Error(`git diff failed: ${result.stderr.trim()}`)
  return result.stdout.split("\n").filter((line) => line !== "")
}

async function onWorkingTree(
  input: DetectionInput,
  selections: Selection[],
  source: ContentSource,
): Promise<DetectionOutput> {
  const changed = new Set(
    await unstagedChanges(
      [...new Set(selections.flatMap((selection) => selection.files))].sort(),
      input.detection.root,
      source,
    ),
  )
  const runnable: Selection[] = []
  const warnings: string[] = []
  for (const selection of selections) {
    const differs = selection.files.filter((file) => changed.has(file))
    if (differs.length === 0) {
      runnable.push(selection)
      continue
    }
    const where =
      source.kind === "commit"
        ? `the working tree differs from ${source.ref} in ${differs.join(", ")}`
        : `unstaged changes in ${differs.join(", ")}`
    warnings.push(`${selection.rule.id} skipped: ${where}`)
  }
  const ran =
    runnable.length === 0
      ? { findings: [], errors: [], timedOut: [], ignored: [], warnings: [] }
      : await runDetection({ ...input, selections: runnable })
  return { ...ran, warnings: [...warnings, ...ran.warnings] }
}

async function fromScratch(input: DetectionInput, selections: Selection[]): Promise<DetectionOutput> {
  const entries = new Map<string, string>()
  for (const file of new Set(selections.flatMap((selection) => selection.files))) {
    const text = await input.read(file)
    // Absent from the source (deleted in the index): not written, and so not checked.
    if (text !== null) entries.set(file, text)
  }
  if (entries.size === 0) return { findings: [], errors: [], timedOut: [], ignored: [], warnings: [] }
  return withScratchTree(input.detection.root, STAGED_DIR, entries, async (dir) => {
    const prefix = `${dir}/`
    const strip = (file: string) => (file.startsWith(prefix) ? file.slice(prefix.length) : file)
    const output = await runDetection({
      ...input,
      selections: selections
        .map((selection) => ({
          ...selection,
          files: selection.files.filter((file) => entries.has(file)).map((file) => prefix + file),
        }))
        .filter((selection) => selection.files.length > 0),
      changes: new Map([...input.changes].map(([file, change]) => [prefix + file, change])),
      // Anything reading through `read` under a scratch path is asking about the real file.
      read: (file) => input.read(strip(file)),
    })
    return {
      findings: output.findings.map(({ rule, match }) => ({ rule, match: { ...match, file: strip(match.file) } })),
      errors: output.errors.map((error) => ({ ...error, message: error.message.replaceAll(prefix, "") })),
      timedOut: output.timedOut,
      ignored: output.ignored.map((ignored) => ({
        ...ignored,
        match: { ...ignored.match, file: strip(ignored.match.file) },
      })),
      warnings: output.warnings.map((warning) => warning.replaceAll(prefix, "")),
    }
  })
}

function merge(outputs: DetectionOutput[]): DetectionOutput {
  return {
    findings: outputs.flatMap((output) => output.findings),
    errors: outputs.flatMap((output) => output.errors),
    timedOut: outputs.flatMap((output) => output.timedOut),
    ignored: outputs.flatMap((output) => output.ignored),
    warnings: outputs.flatMap((output) => output.warnings),
  }
}
