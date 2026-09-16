import { describe, expect, test } from "vitest"

import { changedLines } from "../../../src/core/baseline/changes"
import { hashLines } from "../../../src/core/baseline/hash"

const changes = (before: string[], after: string[]) =>
  changedLines(hashLines(before.join("\n")), hashLines(after.join("\n")))

describe("changedLines", () => {
  test("identical content has no changes", () => {
    expect(changes(["a", "b"], ["a", "b"])).toEqual([])
  })

  test("insertion marks the inserted lines", () => {
    expect(changes(["a", "b", "c"], ["a", "x", "y", "b", "c"])).toEqual([[2, 3]])
  })

  test("replacement marks the replaced line", () => {
    expect(changes(["a", "b", "c"], ["a", "y", "c"])).toEqual([[2, 2]])
  })

  test("deletion marks the line after it", () => {
    expect(changes(["a", "b", "c"], ["a", "c"])).toEqual([[2, 2]])
  })

  test("deletion at the end marks the last line", () => {
    expect(changes(["a", "b", "c"], ["a", "b"])).toEqual([[2, 2]])
  })

  test("separate changes stay separate, adjacent ones merge", () => {
    expect(changes(["a", "b", "c", "d", "e"], ["x", "b", "c", "d", "y"])).toEqual([
      [1, 1],
      [5, 5],
    ])
    expect(changes(["a", "b", "c"], ["x", "y", "c"])).toEqual([[1, 2]])
  })

  test("reindentation is not a change", () => {
    expect(changes(["if x:", "run()"], ["if x:", "    run()"])).toEqual([])
  })
})
