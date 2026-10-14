export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

/** 1-based line and column of a string offset. */
export function positionAt(starts: number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return { line: low + 1, column: offset - starts[low]! + 1 }
}

/** String offset of a 1-based line and column, clamped to a file of `length` characters. */
export function offsetAt(starts: number[], line: number, column: number, length: number): number {
  const index = Math.min(Math.max(line, 1), starts.length) - 1
  const offset = starts[index]! + Math.max(column, 1) - 1
  return Math.min(Math.max(offset, 0), length)
}

/**
 * The source a tool's finding points at; "" when the file is gone or the range is empty. An end
 * column of null takes the rest of the line.
 */
export function excerpt(
  source: string | null,
  range: { line: number; column: number; endLine: number; endColumn: number | null },
): string {
  if (source === null) return ""
  const starts = lineStarts(source)
  const from = offsetAt(starts, range.line, range.column, source.length)
  let to: number
  if (range.endColumn === null) {
    // Not the start of the next line: a last line with no trailing newline has no next line to
    // start, and offsetAt would clamp back to this line's start, leaving the excerpt empty.
    const newline = source.indexOf("\n", from)
    to = newline === -1 ? source.length : newline
  } else {
    to = offsetAt(starts, range.endLine, range.endColumn, source.length)
  }
  return source.slice(from, Math.max(from, to)).replace(/\n$/, "")
}
