import { describe, expect, test } from "vitest"

import { applyFileBudget, applySizeCeiling } from "../../../src/core/detection/budget"
import type { Selection } from "../../../src/core/detection/select"
import { rule } from "../../helpers/rules"

const selection = (id: string, kind: string, files: string[]): Selection => ({
  rule: rule({ id, detector: { kind, config: {}, captures: [] } }),
  files,
})

const shape = (selections: Selection[]) => selections.map((s) => [s.rule.id, s.files] as const)

describe("applyFileBudget", () => {
  test("under the limit, nothing changes", () => {
    const selections = [selection("r1", "llm", ["a.ts", "b.ts"])]
    const result = applyFileBudget("llm", selections, 10, ["b.ts", "a.ts"])
    expect(shape(result.selections)).toEqual([["r1", ["a.ts", "b.ts"]]])
    expect(result.skipped).toEqual([])
  })

  test("over the limit, the most recently edited files survive", () => {
    const selections = [selection("r1", "llm", ["a.ts", "b.ts", "c.ts", "d.ts"])]
    // Most recently edited first.
    const result = applyFileBudget("llm", selections, 2, ["c.ts", "a.ts", "d.ts", "b.ts"])
    expect(shape(result.selections)).toEqual([["r1", ["a.ts", "c.ts"]]])
    expect(result.skipped).toEqual(["d.ts", "b.ts"])
  })

  test("the budget counts distinct files across the kind's rules, not rule-file pairs", () => {
    const selections = [selection("r1", "llm", ["a.ts", "b.ts"]), selection("r2", "llm", ["a.ts", "c.ts"])]
    const result = applyFileBudget("llm", selections, 2, ["a.ts", "b.ts", "c.ts"])
    expect(shape(result.selections)).toEqual([
      ["r1", ["a.ts", "b.ts"]],
      ["r2", ["a.ts"]],
    ])
    expect(result.skipped).toEqual(["c.ts"])
  })

  test("files nobody edited come last, keeping their own order", () => {
    // `rulecast run --all-files` has no session, so `recent` is empty and the cut must still be
    // deterministic rather than dependent on Set iteration order.
    const selections = [selection("r1", "llm", ["a.ts", "b.ts", "c.ts"])]
    const result = applyFileBudget("llm", selections, 2, ["c.ts"])
    expect(shape(result.selections)).toEqual([["r1", ["a.ts", "c.ts"]]])
    expect(result.skipped).toEqual(["b.ts"])
  })

  test("a selection left with no files is dropped", () => {
    const selections = [selection("r1", "llm", ["a.ts"]), selection("r2", "llm", ["b.ts"])]
    const result = applyFileBudget("llm", selections, 1, ["a.ts", "b.ts"])
    expect(shape(result.selections)).toEqual([["r1", ["a.ts"]]])
    expect(result.skipped).toEqual(["b.ts"])
  })

  test("other kinds are untouched however small the limit", () => {
    const selections = [selection("r1", "llm", ["a.ts", "b.ts"]), selection("r2", "regex", ["a.ts", "b.ts", "c.ts"])]
    const result = applyFileBudget("llm", selections, 1, ["b.ts", "a.ts"])
    expect(shape(result.selections)).toEqual([
      ["r1", ["b.ts"]],
      ["r2", ["a.ts", "b.ts", "c.ts"]],
    ])
    expect(result.skipped).toEqual(["a.ts"])
  })

  test("no selections of that kind is a no-op", () => {
    const selections = [selection("r2", "regex", ["a.ts"])]
    const result = applyFileBudget("llm", selections, 1, [])
    expect(shape(result.selections)).toEqual([["r2", ["a.ts"]]])
    expect(result.skipped).toEqual([])
  })
})

/**
 * An in-process detector holds up the event loop for as long as it runs, and `ast-grep` parses in
 * native code that no timeout interrupts: 2.6 MB measured 762 ms, linearly, so 26 MB is 7.6 s of an
 * agent waiting on its own write. On edit and guard the file is skipped instead.
 */
describe("applySizeCeiling", () => {
  const bounded = (kind: string) => kind === "regex" || kind === "ast-grep" || kind === "path"
  const sizes = (table: Record<string, number | null>) => async (file: string) => table[file] ?? null

  test("under the ceiling, nothing changes", async () => {
    const selections = [selection("r1", "regex", ["a.ts", "b.ts"])]
    const result = await applySizeCeiling(selections, 1000, bounded, sizes({ "a.ts": 10, "b.ts": 999 }))
    expect(shape(result.selections)).toEqual([["r1", ["a.ts", "b.ts"]]])
    expect(result.skipped).toEqual([])
  })

  test("a file over the ceiling is taken away from every rule that would have parsed it", async () => {
    const selections = [selection("r1", "regex", ["a.ts", "big.ts"]), selection("r2", "ast-grep", ["big.ts"])]
    const result = await applySizeCeiling(selections, 1000, bounded, sizes({ "a.ts": 10, "big.ts": 2_000_000 }))
    // r2 is left with no files at all, so it is dropped rather than run on nothing.
    expect(shape(result.selections)).toEqual([["r1", ["a.ts"]]])
    expect(result.skipped).toEqual(["big.ts"])
  })

  test("a detector that shells out is not bounded by this: its cost is not on our event loop", async () => {
    const selections = [selection("r1", "llm", ["big.ts"]), selection("r2", "regex", ["big.ts"])]
    const result = await applySizeCeiling(selections, 1000, bounded, sizes({ "big.ts": 2_000_000 }))
    expect(shape(result.selections)).toEqual([["r1", ["big.ts"]]])
    expect(result.skipped).toEqual(["big.ts"])
  })

  test("a file that cannot be sized is not skipped: a doubt here goes ahead", async () => {
    const selections = [selection("r1", "regex", ["gone.ts"])]
    const result = await applySizeCeiling(selections, 1000, bounded, sizes({}))
    expect(shape(result.selections)).toEqual([["r1", ["gone.ts"]]])
    expect(result.skipped).toEqual([])
  })

  test("nothing in process means nothing to stat", async () => {
    let stats = 0
    const selections = [selection("r1", "llm", ["a.ts"])]
    const result = await applySizeCeiling(selections, 1, bounded, async () => {
      stats++
      return 2_000_000
    })
    expect(stats).toBe(0)
    expect(shape(result.selections)).toEqual([["r1", ["a.ts"]]])
  })

  test("one stat per distinct file, however many rules select it", async () => {
    const statted: string[] = []
    const selections = [
      selection("r1", "regex", ["a.ts", "b.ts"]),
      selection("r2", "regex", ["a.ts"]),
      selection("r3", "ast-grep", ["a.ts"]),
    ]
    await applySizeCeiling(selections, 1000, bounded, async (file) => {
      statted.push(file)
      return 10
    })
    expect(statted.sort()).toEqual(["a.ts", "b.ts"])
  })
})
