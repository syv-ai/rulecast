import { describe, expect, test } from "vitest"

import { foldWork, referenceState, treeRecord, type WorkRecord } from "../../../src/core/session/state"
import type { TreeState } from "../../../src/core/session/tree"

/**
 * Plan 21, 6c: every shell call wrote two full tree states, so a session store grew by the size of
 * the dirty tree twice per call (a 2000-call session with 30 dirty files: 11 MB, 49 ms to fold on
 * every hook). A state is now written as a reference to one the store already holds, or as the
 * change from the agent's last one.
 */
const state = (entries: TreeState["entries"], at = 1): TreeState => ({ head: "abc", at, entries })
const many = (n: number, mtime = 1): TreeState["entries"] =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/file${i}.ts`, [mtime, 100 + i, `h${i}`]]))

/** Appends a tree state the way the pipeline does: encoded against what the store already folds to. */
function append(
  records: WorkRecord[],
  phase: "start" | "before" | "after" | "stop",
  now: TreeState,
  toolUseId?: string,
) {
  records.push(treeRecord(foldWork(records), { phase, agent: "main", ...(toolUseId ? { toolUseId } : {}) }, now))
}

describe("tree records", () => {
  test("encoded records fold to exactly the states that were recorded", () => {
    const records: WorkRecord[] = []
    const start = state(many(3))
    const before = state({ ...many(3), "src/new.ts": [5, 1, "n"] }, 2)
    const { "src/file0.ts": _gone, ...rest } = before.entries
    const after = state({ ...rest, "src/file1.ts": [9, 9, "changed"] }, 3)
    append(records, "start", start)
    append(records, "before", before, "t1")
    expect(referenceState(foldWork(records), "main", "t1")).toEqual(before)
    append(records, "after", after, "t1")
    append(records, "before", after, "t2")
    const folded = foldWork(records)
    expect(folded.startTree).toEqual(start)
    expect(folded.latestTree.get("main")).toEqual(after)
    expect(referenceState(folded, "main", "t2")).toEqual(after)
    expect(folded.sessionLatestTree).toEqual(after)
  })

  test("an unchanged tree costs a few bytes per record, however dirty it is", () => {
    const records: WorkRecord[] = []
    const dirty = many(500)
    append(records, "start", state(dirty))
    const first = JSON.stringify(records[0]).length
    for (let call = 0; call < 50; call++) {
      append(records, "before", state(dirty, call), `t${call}`)
      append(records, "after", state(dirty, call), `t${call}`)
    }
    const rest = records.slice(1).map((record) => JSON.stringify(record).length)
    expect(first).toBeGreaterThan(10_000)
    expect(Math.max(...rest)).toBeLessThan(200)
  })

  test("a record whose base is missing, as after a damaged line, is skipped rather than misread", () => {
    const records: WorkRecord[] = []
    append(records, "start", state(many(2)))
    append(records, "before", state(many(3)), "t1")
    const folded = foldWork(records.slice(1))
    expect(folded.latestTree.size).toBe(0)
    expect(folded.beforeTrees.size).toBe(0)
  })

  test("stores written before keys still fold", () => {
    const old = state(many(2))
    const folded = foldWork([{ t: "tree", phase: "start", agent: "main", state: old }])
    expect(folded.startTree).toEqual(old)
  })
})
