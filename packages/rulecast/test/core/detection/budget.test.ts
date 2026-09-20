import { describe, expect, test } from "vitest"

import { applyFileBudget } from "../../../src/core/detection/budget"
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
