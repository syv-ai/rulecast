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
  const changes: BaselineChanges = { sets: new Map(), maps: new Map() }
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
