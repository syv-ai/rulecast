import { describe, expect, test } from "vitest"

import { emptyContext, emptyWork, foldContext, foldWork, preexistingKey } from "../../../src/core/session/state"

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
      edited: ["b.ts", "a.ts"],
      stopBlocks: new Map([
        ["main", 1],
        ["sub1", 1],
      ]),
      disabled: new Map([["r1", "boom"]]),
    })
  })

  test("empty", () => {
    expect(foldWork([])).toEqual(emptyWork())
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
