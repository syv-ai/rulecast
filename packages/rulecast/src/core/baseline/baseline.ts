import { readSourceFile } from "../detection/per-rule"
import { fileAtCommit } from "../git"
import type { ChangeSet, Match } from "../types"
import { diffLines, identityMap, type LineMap } from "./changes"
import { type Snapshot, snapshotOf } from "./hash"

export interface BaselineSources {
  snapshots: ReadonlyMap<string, Snapshot>
  /** Session-start commit (hooks) or merge base (run --from-ref); null for none. */
  fallbackCommit: string | null
}

/**
 * What the baseline says about the files of one event.
 *
 * `sets` is the detector-facing half and the only half spec §6 promises: changed line ranges, per
 * file. `maps` is the core's own — where each file's baseline lines ended up — and it exists for
 * `container` classification (§8). It is deliberately not on `ChangeSet`: a detector that tried to
 * scope its own patterns by the baseline would reintroduce the error the baseline exists to avoid.
 */
export interface BaselineChanges {
  sets: Map<string, ChangeSet>
  maps: Map<string, LineMap>
  /**
   * Baseline content, for the files whose baseline was read from a commit rather than a snapshot.
   *
   * Kept because a verify can afford to measure a `container` rule's fingerprints on demand and
   * this is the content to measure them against — read once here rather than fetched from git
   * again. Files with a snapshot are absent: a snapshot is line hashes, and the content it was
   * taken from is gone.
   */
  fromCommit: Map<string, string>
}

/**
 * Change sets for files that exist now. A file is absent from the result when it was deleted
 * or has no baseline (no snapshot, and not present at the fallback commit).
 */
export async function computeChanges(
  root: string,
  files: readonly string[],
  sources: BaselineSources,
): Promise<BaselineChanges> {
  const changes: BaselineChanges = { sets: new Map(), maps: new Map(), fromCommit: new Map() }
  for (const file of files) {
    // Without any baseline source there is nothing to compare; don't read the file.
    if (!sources.snapshots.has(file) && !sources.fallbackCommit) continue
    let before = sources.snapshots.get(file) ?? null
    let commitText: string | null = null
    if (!before && sources.fallbackCommit) {
      commitText = await fileAtCommit(root, sources.fallbackCommit, file)
      before = commitText === null ? null : snapshotOf(commitText)
    }
    if (!before) continue
    const current = await readSourceFile(root, file)
    if (current === null) continue
    // Only for a file that ends up with a change set: a deleted one has nothing to classify.
    if (commitText !== null) changes.fromCommit.set(file, commitText)
    const after = snapshotOf(current)
    if (after.fileHash === before.fileHash) {
      changes.sets.set(file, { changedLines: [] })
      changes.maps.set(file, identityMap(after.lines.length))
      continue
    }
    const diff = diffLines(before.lines, after.lines)
    changes.sets.set(file, { changedLines: diff.changed })
    changes.maps.set(file, diff.map)
  }
  return changes
}

export function isNew(match: Match, changes: ReadonlyMap<string, ChangeSet>): boolean {
  const change = changes.get(match.file)
  if (!change) return true
  return change.changedLines.some(([start, end]) => match.line <= end && match.endLine >= start)
}
