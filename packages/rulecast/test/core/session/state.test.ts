import { describe, expect, test } from "vitest"

import {
  ANY_AGENT,
  CLAIM_TTL_MS,
  claimedByOther,
  dirtyAtStart,
  editedBy,
  emptyContext,
  emptyWork,
  foldContext,
  foldWork,
  MAIN_AGENT,
  preexistingKey,
  referenceSeq,
  referenceState,
  sweptFor,
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
      editors: new Map([
        ["a.ts", new Set([ANY_AGENT])],
        ["b.ts", new Set([ANY_AGENT])],
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
    expect(referenceSeq(work, "main")).toBeNull()
    // An edit recorded without its agent is every agent's, so no stop verifies less than before.
    expect(editedBy(work, "sub1")).toEqual(["a.ts"])
    expect(claimedByOther(work, "sub1", "a.ts", null)).toBe(false)
  })

  test("referenceSeq points at the state referenceState returns", () => {
    const work = foldWork([
      { t: "tree", phase: "before", agent: "main", toolUseId: "m1", state: tree("main-before") },
      { t: "tree", phase: "before", agent: "sub", toolUseId: "s1", state: tree("sub-before") },
      { t: "tree", phase: "after", agent: "main", toolUseId: "m1", state: tree("main-after") },
    ])
    expect(referenceSeq(work, "main", "m1")).toBe(0)
    expect(referenceSeq(work, "main")).toBe(2)
    expect(referenceSeq(work, "sub")).toBe(1)
    expect(referenceSeq(work, "other")).toBe(2)
    expect(referenceSeq(foldWork([]), "main", "t1")).toBeNull()
  })
})

describe("edits by agent", () => {
  test("a subagent's files are its own edits, in edit order; the main agent's are everyone's", () => {
    const work = foldWork([
      { t: "edited", file: "a.ts", agent: "sub1" },
      { t: "edited", file: "b.ts", agent: "sub2" },
      { t: "edited", file: "c.ts", agent: "main" },
      { t: "edited", file: "d.ts", agent: "sub1", via: "shell" },
      { t: "edited", file: "a.ts", agent: "sub2" },
    ])
    expect(editedBy(work, "sub1")).toEqual(["d.ts", "a.ts"])
    expect(editedBy(work, "sub2")).toEqual(["b.ts", "a.ts"])
    expect(editedBy(work, "sub3")).toEqual([])
    expect(editedBy(work, MAIN_AGENT)).toEqual(["b.ts", "c.ts", "d.ts", "a.ts"])
  })

  test("another agent's write recorded after the reference state is its own; a shell edit is no write", () => {
    const work = foldWork([
      { t: "edited", file: "early.ts", agent: "sub2" },
      { t: "tree", phase: "before", agent: "sub1", toolUseId: "s1", state: tree("before") },
      { t: "claimed", agent: "sub2", files: ["a.ts"], at: 0 },
      { t: "accessed", agent: "sub2", file: "a.ts" },
      { t: "edited", file: "a.ts", agent: "sub2" },
      // PostToolUse without its PreToolUse claim (the guard not installed): the edit is the write.
      { t: "edited", file: "b.ts", agent: "sub2" },
      { t: "claimed", agent: "sub1", files: ["own.ts"], at: 0 },
      { t: "edited", file: "own.ts", agent: "sub1" },
      { t: "edited", file: "shell.ts", agent: "sub2", via: "shell" },
    ])
    const since = referenceSeq(work, "sub1", "s1")
    const now = CLAIM_TTL_MS * 10
    expect(claimedByOther(work, "sub1", "a.ts", since, now)).toBe(true)
    expect(claimedByOther(work, "sub1", "b.ts", since, now)).toBe(true)
    expect(claimedByOther(work, "sub1", "early.ts", since, now)).toBe(false)
    expect(claimedByOther(work, "sub1", "own.ts", since, now)).toBe(false)
    expect(claimedByOther(work, "sub1", "shell.ts", since, now)).toBe(false)
    expect(claimedByOther(work, "sub2", "a.ts", since, now)).toBe(false)
    // No reference state: every write is after it.
    expect(claimedByOther(work, "sub1", "early.ts", null, now)).toBe(true)
  })

  test("a claim with no write yet is in flight, however early it was made, until it ends or expires", () => {
    const claimed = { t: "claimed" as const, agent: "sub2", files: ["a.ts"], at: 1000 }
    const before = { t: "tree" as const, phase: "before" as const, agent: "sub1", toolUseId: "s1", state: tree("b") }
    const inFlight = foldWork([claimed, before])
    const since = referenceSeq(inFlight, "sub1", "s1")
    expect(claimedByOther(inFlight, "sub1", "a.ts", since, 1500)).toBe(true)
    expect(claimedByOther(inFlight, "sub1", "a.ts", since, 1000 + CLAIM_TTL_MS)).toBe(false)
    // Ended without a write: any other event of the claiming agent's, or the guard refusing it.
    const endings = [
      { t: "accessed" as const, agent: "sub2", file: "b.ts" },
      { t: "claimed" as const, agent: "sub2", files: ["b.ts"], at: 1200 },
      { t: "released" as const, agent: "sub2" },
      { t: "tree" as const, phase: "before" as const, agent: "sub2", toolUseId: "s2", state: tree("c") },
      { t: "edited" as const, file: "b.ts", agent: "sub2" },
      { t: "edited" as const, file: "a.ts", agent: "sub2", via: "shell" as const },
    ]
    for (const ending of endings) {
      expect(claimedByOther(foldWork([claimed, before, ending]), "sub1", "a.ts", since, 1500)).toBe(false)
    }
    // Not ended: another agent's events, or the PostToolUse's access to the file itself.
    expect(
      claimedByOther(
        foldWork([claimed, before, { t: "accessed", agent: "sub2", file: "a.ts" }, { t: "released", agent: "sub3" }]),
        "sub1",
        "a.ts",
        since,
        1500,
      ),
    ).toBe(true)
  })
})

describe("swept files by agent", () => {
  test("a subagent's stop reports what its own comparisons swept; the main agent's, all of them", () => {
    const work = foldWork([
      { t: "swept", file: "a.ts", agent: "sub1" },
      { t: "swept", file: "b.ts", agent: "sub2" },
      { t: "swept", file: "old.ts" },
      { t: "swept", file: "c.ts", agent: "sub1" },
      { t: "edited", file: "c.ts", agent: "sub2" },
    ])
    expect(sweptFor(work, "sub1")).toEqual(["a.ts", "old.ts"])
    expect(sweptFor(work, "sub2")).toEqual(["b.ts", "old.ts"])
    expect(sweptFor(work, MAIN_AGENT)).toEqual(["a.ts", "b.ts", "old.ts"])
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
