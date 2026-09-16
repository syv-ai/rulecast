import { diffArrays } from "diff"

/** 1-based inclusive ranges of lines in `after` that differ from `before`. */
export function changedLines(before: Uint32Array, after: Uint32Array): [number, number][] {
  const ranges: [number, number][] = []
  const mark = (start: number, end: number) => {
    const previous = ranges.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
  }

  let line = 1
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
    } else {
      line += count
    }
  }
  return ranges
}
