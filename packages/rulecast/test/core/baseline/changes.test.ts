import { describe, expect, test } from "vitest"

import { diffLines, identityMap, mapLine } from "../../../src/core/baseline/changes"
import { hashLines } from "../../../src/core/baseline/hash"

const diff = (before: string[], after: string[]) => diffLines(hashLines(before.join("\n")), hashLines(after.join("\n")))

const changes = (before: string[], after: string[]) => diff(before, after).changed

/** Where each baseline line sits in the current file, 1-based. */
const mapped = (before: string[], after: string[]) => {
  const { map } = diff(before, after)
  return before.map((_, index) => mapLine(map, index + 1))
}

describe("diffLines: changed ranges", () => {
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

describe("diffLines: the line map", () => {
  test("an unchanged file maps every line to itself", () => {
    expect(mapped(["a", "b", "c"], ["a", "b", "c"])).toEqual([1, 2, 3])
  })

  test("an insertion above shifts every later line down", () => {
    expect(mapped(["a", "b", "c"], ["x", "y", "a", "b", "c"])).toEqual([3, 4, 5])
  })

  test("a deletion pulls every later line up", () => {
    expect(mapped(["a", "b", "c", "d"], ["a", "d"])).toEqual([1, 2, 2, 2])
  })

  test("a replacement of equal length keeps the surrounding lines in place", () => {
    expect(mapped(["a", "b", "c"], ["a", "y", "c"])).toEqual([1, 3, 3])
  })

  test("a deleted line maps to the line that now sits where it was", () => {
    // "b" is gone; the line standing in its place is the one that was "c".
    expect(mapped(["a", "b", "c"], ["a", "c"])).toEqual([1, 2, 2])
  })

  test("a baseline line whose whole tail was deleted maps past the end of the file", () => {
    expect(mapped(["a", "b", "c"], ["a"])).toEqual([1, 2, 2])
    expect(mapLine(diff(["a", "b", "c"], ["a"]).map, 9)).toBe(2)
  })

  test("an emptied file maps every baseline line past the end", () => {
    const { map } = diff(["a", "b"], [])
    expect(map.runs).toEqual([])
    expect(mapLine(map, 1)).toBe(map.afterLines + 1)
  })

  test("identityMap is what an unchanged file produces", () => {
    expect(identityMap(3)).toEqual({ runs: [{ beforeStart: 1, afterStart: 1, count: 3 }], afterLines: 3 })
    expect(identityMap(0)).toEqual({ runs: [], afterLines: 0 })
  })
})
