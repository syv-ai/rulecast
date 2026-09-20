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
