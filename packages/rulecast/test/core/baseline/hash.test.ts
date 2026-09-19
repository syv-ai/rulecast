import { describe, expect, test } from "vitest"

import { fnv1a, hashLines, snapshotOf } from "../../../src/core/baseline/hash"

describe("hashing", () => {
  test("fnv1a matches the reference 32-bit values", () => {
    expect(fnv1a("")).toBe(0x811c9dc5)
    expect(fnv1a("a")).toBe(0xe40c292c)
    expect(fnv1a("foobar")).toBe(0xbf9cf968)
  })

  test("lines are trimmed before hashing", () => {
    expect([...hashLines("  a\n\tb  \r\nc")]).toEqual([fnv1a("a"), fnv1a("b"), fnv1a("c")])
  })

  test("snapshots of reindented text are equal", () => {
    const flat = snapshotOf("if x:\nrun()\n")
    const indented = snapshotOf("if x:\n    run()\n")
    expect(indented.fileHash).toBe(flat.fileHash)
    expect([...indented.lines]).toEqual([...flat.lines])
  })

  test("different content gives a different file hash", () => {
    expect(snapshotOf("a\nb").fileHash).not.toBe(snapshotOf("a\nc").fileHash)
  })
})
