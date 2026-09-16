import { expect, test } from "vitest"

import { lineStarts, positionAt } from "../../../src/core/detection/positions"

test("positionAt maps offsets to 1-based line and column", () => {
  const text = "ab\ncd\r\nef"
  const starts = lineStarts(text)
  expect(starts).toEqual([0, 3, 7])
  expect(positionAt(starts, 0)).toEqual({ line: 1, column: 1 })
  expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 })
  expect(positionAt(starts, 8)).toEqual({ line: 3, column: 2 })
})
