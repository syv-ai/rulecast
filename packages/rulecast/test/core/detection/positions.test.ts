import { describe, expect, test } from "vitest"

import { lineStarts, offsetAt, positionAt } from "../../../src/core/detection/positions"

test("positionAt maps offsets to 1-based line and column", () => {
  const text = "ab\ncd\r\nef"
  const starts = lineStarts(text)
  expect(starts).toEqual([0, 3, 7])
  expect(positionAt(starts, 0)).toEqual({ line: 1, column: 1 })
  expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 })
  expect(positionAt(starts, 8)).toEqual({ line: 3, column: 2 })
})

describe("offsetAt", () => {
  const text = "ab\ncde\n"
  const starts = lineStarts(text)

  test("is the inverse of positionAt", () => {
    for (let offset = 0; offset < text.length; offset++) {
      const { line, column } = positionAt(starts, offset)
      expect(offsetAt(starts, line, column, text.length)).toBe(offset)
    }
  })

  test("clamps a line or column past the end of the file", () => {
    expect(offsetAt(starts, 99, 1, text.length)).toBe(text.length)
    expect(offsetAt(starts, 2, 99, text.length)).toBe(text.length)
    expect(offsetAt(starts, 0, 0, text.length)).toBe(0)
  })
})
