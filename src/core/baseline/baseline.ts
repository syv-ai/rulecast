import { readSourceFile } from "../detection/per-rule"
import type { ChangeSet, Match } from "../types"
import { changedLines } from "./changes"
import { fileAtCommit } from "./git"
import { type Snapshot, snapshotOf } from "./hash"

export interface BaselineSources {
  snapshots: ReadonlyMap<string, Snapshot>
  /** Session-start commit (hooks) or merge base (check --base); null for none. */
  fallbackCommit: string | null
}

/**
 * Change sets for files that exist now. A file is absent from the result when it was deleted
 * or has no baseline (no snapshot, and not present at the fallback commit).
 */
export async function computeChanges(
  root: string,
  files: readonly string[],
  sources: BaselineSources,
): Promise<Map<string, ChangeSet>> {
  const changes = new Map<string, ChangeSet>()
  for (const file of files) {
    // Without any baseline source there is nothing to compare; don't read the file.
    if (!sources.snapshots.has(file) && !sources.fallbackCommit) continue
    let before = sources.snapshots.get(file) ?? null
    if (!before && sources.fallbackCommit) {
      const text = await fileAtCommit(root, sources.fallbackCommit, file)
      before = text === null ? null : snapshotOf(text)
    }
    if (!before) continue
    const current = await readSourceFile(root, file)
    if (current === null) continue
    const after = snapshotOf(current)
    changes.set(file, {
      changedLines: after.fileHash === before.fileHash ? [] : changedLines(before.lines, after.lines),
    })
  }
  return changes
}

export function isNew(match: Match, changes: ReadonlyMap<string, ChangeSet>): boolean {
  const change = changes.get(match.file)
  if (!change) return true
  return change.changedLines.some(([start, end]) => match.line <= end && match.endLine >= start)
}
