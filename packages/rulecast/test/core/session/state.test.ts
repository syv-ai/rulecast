import { describe, expect, test } from "vitest"

import {
  dirtyAtStart,
  emptyContext,
  emptyWork,
  foldContext,
  foldWork,
  preexistingKey,
  referenceState,
} from "../../../src/core/session/state"
import type { TreeState } from "../../../src/core/session/tree"

describe("foldWork", () => {
  test("tracks edited files, stop blocks per agent reset by prompts, and disabled rules", () => {
    const work = foldWork([
      { t: "edited", file: "a.ts" },
      { t: "edited", file: "b.ts" },
      { t: "edited", file: "a.ts" },
      { t: "stopBlock", agent: "main" },
      { t: "stopBlock", agent: "main" },
      { t: "stopBlock", agent: "sub1" },
      { t: "prompt", agent: "main" },
      { t: "stopBlock", agent: "main" },
      { t: "disabled", rule: "r1", reason: "boom" },
    ])
    expect(work).toEqual({
      ...emptyWork(),
      edited: ["b.ts", "a.ts"],
      editedVia: new Map([
        ["a.ts", "tool"],
        ["b.ts", "tool"],
      ]),
      stopBlocks: new Map([
        ["main", 1],
        ["sub1", 1],
      ]),
      disabled: new Map([["r1", "boom"]]),
    })
  })

  test("tracks the files each agent accessed, most recent last", () => {
    const work = foldWork([
      { t: "accessed", agent: "main", file: "a.ts" },
      { t: "accessed", agent: "main", file: "b.ts" },
      { t: "accessed", agent: "sub1", file: "c.ts" },
      { t: "accessed", agent: "main", file: "a.ts" },
    ])
    expect(work.accessed).toEqual(
      new Map([
        ["main", ["b.ts", "a.ts"]],
        ["sub1", ["c.ts"]],
      ]),
    )
    // Accesses are not edits: Stop verifies only edited files.
    expect(work.edited).toEqual([])
  })

  test("empty", () => {
    expect(foldWork([])).toEqual(emptyWork())
  })
})

const tree = (head: string, entries: TreeState["entries"] = {}): TreeState => ({ head, entries })

describe("tree records, shell edits and swept files", () => {
  test("the latest state is the last record of any phase", () => {
    const work = foldWork([
      { t: "tree", phase: "before", agent: "main", toolUseId: "t1", state: tree("before") },
      { t: "tree", phase: "after", agent: "main", toolUseId: "t1", state: tree("after") },
      { t: "tree", phase: "stop", agent: "main", state: tree("stop") },
    ])
    expect(work.latestTree.get("main")).toEqual(tree("stop"))
    expect(referenceState(work, "main")).toEqual(tree("stop"))
    // With the id, the state recorded before that call, whatever came after it.
    expect(referenceState(work, "main", "t1")).toEqual(tree("before"))
  })

  test("two agents interleaved keep their own states", () => {
    const work = foldWork([
      { t: "tree", phase: "before", agent: "main", toolUseId: "m1", state: tree("main-before") },
      { t: "tree", phase: "before", agent: "sub", toolUseId: "s1", state: tree("sub-before") },
      { t: "tree", phase: "after", agent: "main", toolUseId: "m1", state: tree("main-after") },
    ])
    expect(referenceState(work, "sub")).toEqual(tree("sub-before"))
    expect(referenceState(work, "main")).toEqual(tree("main-after"))
    expect(referenceState(work, "sub", "s1")).toEqual(tree("sub-before"))
    // A subagent with no state of its own compares with the session's latest.
    expect(referenceState(work, "other")).toEqual(tree("main-after"))
  })

  test("a missing id falls back to the agent's latest; nothing recorded is null", () => {
    const work = foldWork([{ t: "tree", phase: "after", agent: "main", toolUseId: "t1", state: tree("after") }])
    expect(referenceState(work, "main", "t9")).toEqual(tree("after"))
    expect(referenceState(foldWork([]), "main", "t1")).toBeNull()
  })

  test("edited records remember how; an edit takes a file out of swept", () => {
    const work = foldWork([
      { t: "swept", file: "a.ts" },
      { t: "swept", file: "b.ts" },
      { t: "edited", file: "a.ts", via: "shell" },
      { t: "edited", file: "c.ts" },
    ])
    expect(work.swept).toEqual(["b.ts"])
    expect(work.editedVia).toEqual(
      new Map([
        ["a.ts", "shell"],
        ["c.ts", "tool"],
      ]),
    )
  })

  test("dirtyAtStart reads the first start state", () => {
    const work = foldWork([
      { t: "tree", phase: "start", agent: "main", state: tree("h", { "a.ts": [1, 2] }) },
      // A resume records another start: what was dirty is what was dirty at the first.
      { t: "tree", phase: "start", agent: "main", state: tree("h", { "b.ts": [1, 2] }) },
    ])
    expect(dirtyAtStart(work, "a.ts")).toBe(true)
    expect(dirtyAtStart(work, "b.ts")).toBe(false)
    expect(dirtyAtStart(foldWork([]), "a.ts")).toBe(false)
  })

  test("an old store without these records reads as before", () => {
    const work = foldWork([{ t: "edited", file: "a.ts" }])
    expect(work.swept).toEqual([])
    expect(work.startTree).toBeNull()
    expect(referenceState(work, "main")).toBeNull()
  })
})

describe("foldContext", () => {
  test("ignores everything before the last reset", () => {
    const context = foldContext([
      { t: "delivered", path: "c.md", anchor: null, hash: 1 },
      { t: "touched", rule: "t1" },
      { t: "reset" },
      { t: "delivered", path: "c.md", anchor: "errors", hash: 2 },
      { t: "touched", rule: "t2" },
      { t: "preexisting", rule: "r", file: "a.ts" },
      { t: "warned", key: "w" },
    ])
    expect(context).toEqual({
      delivered: [{ path: "c.md", anchor: "errors", hash: 2 }],
      touched: new Set(["t2"]),
      preexisting: new Set([preexistingKey("r", "a.ts")]),
      warned: new Set(["w"]),
    })
  })

  test("empty", () => {
    expect(foldContext([])).toEqual(emptyContext())
  })
})
