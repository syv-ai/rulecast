import type { Selection } from "./select"

/**
 * Spec §6: at most `maxFiles` files per verify for one detector kind, most recently edited first.
 *
 * This lives in the core rather than in the `llm` detector for two reasons: only the pipeline knows
 * edit recency (the session's work record), and only the pipeline can warn — a DetectorResult has
 * findings and errors and nothing else (plan 6b, Decision 7).
 *
 * `recent` is most-recently-edited first. A file missing from it — `rulecast run --all-files` has
 * no session, so nothing was "edited" — sorts after every file that is in it, keeping the order the
 * selections gave, so the cut is deterministic either way.
 */
export function applyFileBudget(
  kind: string,
  selections: Selection[],
  maxFiles: number,
  recent: readonly string[],
): { selections: Selection[]; skipped: string[] } {
  const ofKind = selections.filter((selection) => selection.rule.detector?.kind === kind)
  const files = [...new Set(ofKind.flatMap((selection) => selection.files))]
  if (files.length <= maxFiles) return { selections, skipped: [] }

  const rank = new Map(recent.map((file, index) => [file, index]))
  const ordered = [...files].sort((a, b) => (rank.get(a) ?? recent.length) - (rank.get(b) ?? recent.length))
  const keep = new Set(ordered.slice(0, maxFiles))

  return {
    selections: selections
      .map((selection) =>
        selection.rule.detector?.kind === kind
          ? { ...selection, files: selection.files.filter((file) => keep.has(file)) }
          : selection,
      )
      // selectDetectorRules never yields a selection with no files; the budget must not either.
      .filter((selection) => selection.files.length > 0),
    skipped: ordered.slice(maxFiles),
  }
}

/**
 * Spec §13: files over `maxBytes` are not given to an in-process detector on edit or guard.
 *
 * The edit deadline bounds `regex` because it matches inside a `vm` timeout, and V8 interrupts a
 * running regex for it. `ast-grep` parses in native code, which `TerminateExecution` does not reach,
 * so nothing preempts it: a 2.6 MB TypeScript file measured 762 ms and the cost is linear, which
 * makes a 26 MB file 7.6 seconds of an agent waiting on its own write. A ceiling is the only
 * mechanism left short of hosting detectors in a worker, which costs ~40 ms on every hook.
 *
 * `bounded` is the registry's `guards` flag, which is the same set by contract: a detector that
 * guards reads only through `read`, and so does its work in this process rather than handing a path
 * to another program. Skipping is logged, not warned about — it is normal operation, like a missed
 * edit deadline, and must not mark the run failed.
 */
export async function applySizeCeiling(
  selections: Selection[],
  maxBytes: number,
  bounded: (kind: string) => boolean,
  /** Bytes on disk, or null for a file that is not there; one stat per file, never a read. */
  sizeOf: (file: string) => Promise<number | null>,
): Promise<{ selections: Selection[]; skipped: string[] }> {
  const files = [...new Set(selections.filter((one) => bounded(one.rule.detector.kind)).flatMap((one) => one.files))]
  if (files.length === 0) return { selections, skipped: [] }

  const sizes = await Promise.all(files.map(async (file) => [file, await sizeOf(file)] as const))
  const over = new Set(sizes.filter(([, size]) => size !== null && size > maxBytes).map(([file]) => file))
  if (over.size === 0) return { selections, skipped: [] }

  return {
    selections: selections
      .map((selection) =>
        bounded(selection.rule.detector.kind)
          ? { ...selection, files: selection.files.filter((file) => !over.has(file)) }
          : selection,
      )
      // selectDetectorRules never yields a selection with no files; the ceiling must not either.
      .filter((selection) => selection.files.length > 0),
    skipped: files.filter((file) => over.has(file)),
  }
}
