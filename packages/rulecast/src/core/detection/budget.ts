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
