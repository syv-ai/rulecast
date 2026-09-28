import { diffArrays } from "diff"

/**
 * Where the baseline's lines ended up in the current file.
 *
 * One entry per unchanged run: baseline line `beforeStart` is now line `afterStart`, for `count`
 * lines. Insertions and deletions are the gaps between runs. This is the second product of the
 * diff that produces the change set, and it is what lets a `container` rule's baseline match be
 * compared against a match in the file as it stands now (spec §8).
 */
export interface LineMap {
  runs: { beforeStart: number; afterStart: number; count: number }[]
  /** Lines in the current file, so a baseline line past every run maps past its end. */
  afterLines: number
}

export interface DiffResult {
  /** 1-based inclusive ranges of lines in `after` that differ from `before`. */
  changed: [number, number][]
  map: LineMap
}

/** Both products of one Myers diff: the changed ranges, and where the baseline's lines went. */
export function diffLines(before: Uint32Array, after: Uint32Array): DiffResult {
  const changed: [number, number][] = []
  const runs: LineMap["runs"] = []
  const mark = (start: number, end: number) => {
    const previous = changed.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else changed.push([start, end])
  }

  let line = 1
  let baselineLine = 1
  for (const part of diffArrays(Array.from(before), Array.from(after))) {
    const count = part.count ?? part.value.length
    if (part.added) {
      mark(line, line + count - 1)
      line += count
    } else if (part.removed) {
      // A deletion has no line of its own: mark the line that now sits where it was.
      if (after.length > 0) {
        const at = Math.min(line, after.length)
        mark(at, at)
      }
      baselineLine += count
    } else {
      runs.push({ beforeStart: baselineLine, afterStart: line, count })
      line += count
      baselineLine += count
    }
  }
  return { changed, map: { runs, afterLines: after.length } }
}

/** The map of a file that did not change at all. */
export function identityMap(lines: number): LineMap {
  return { runs: lines === 0 ? [] : [{ beforeStart: 1, afterStart: 1, count: lines }], afterLines: lines }
}

/**
 * Where a baseline line number sits in the current file.
 *
 * A line inside a deleted stretch has no line of its own, so it maps to the line that now sits
 * where it was — the same choice `diffLines` makes when it marks a deletion. Past every run it
 * maps past the end of the file, which is what stops a deleted container from swallowing a match
 * at the bottom of the file.
 */
export function mapLine(map: LineMap, line: number): number {
  for (const run of map.runs) {
    if (line < run.beforeStart) return run.afterStart
    if (line < run.beforeStart + run.count) return run.afterStart + (line - run.beforeStart)
  }
  return map.afterLines + 1
}
