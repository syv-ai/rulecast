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
  for (const selection of input.selections) {
    const detector = registry.get(selection.rule.detector.kind)
    const readsContent = detector?.guards === true || detector?.takesContent?.(selection.rule.detector.config) === true
    // An unregistered kind goes direct: runDetection reports it as an error, which a scratch copy
    // would only delay.
    if (readsContent || detector === undefined) direct.push(selection)
    else copied.push(selection)
  }
  const outputs = await Promise.all([
    direct.length === 0 ? null : runDetection({ ...input, selections: direct, fromDisk: false }),
    copied.length === 0 ? null : fromScratch(input, copied),
  ])
  return merge(outputs.filter((output): output is DetectionOutput => output !== null))
}

async function fromScratch(input: DetectionInput, selections: Selection[]): Promise<DetectionOutput> {
  const entries = new Map<string, string>()
  for (const file of new Set(selections.flatMap((selection) => selection.files))) {
    const text = await input.read(file)
    // Absent from the source (deleted in the index): not written, and so not checked.
    if (text !== null) entries.set(file, text)
  }
  if (entries.size === 0) return { findings: [], errors: [], timedOut: [] }
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
    }
  })
}

function merge(outputs: DetectionOutput[]): DetectionOutput {
  return {
    findings: outputs.flatMap((output) => output.findings),
    errors: outputs.flatMap((output) => output.errors),
    timedOut: outputs.flatMap((output) => output.timedOut),
  }
}
