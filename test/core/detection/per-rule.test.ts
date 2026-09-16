import { describe, expect, test } from "vitest"

import { perRule } from "../../../src/core/detection/per-rule"
import { memoryCache } from "../../../src/core/detection/cache"
import type { DetectorRun, Match } from "../../../src/core/types"

function run(rules: string[]): DetectorRun<null> {
  return {
    event: "edit",
    rules: rules.map((id) => ({ id, config: null, files: ["a.ts"], context: [] })),
    changes: new Map(),
    cache: memoryCache(),
    cwd: "/tmp",
    signal: new AbortController().signal,
  }
}

const match: Match = { file: "a.ts", line: 1, endLine: 1, column: 1, text: "x", captures: {} }

describe("perRule", () => {
  test("attributes matches to their rule and isolates errors", async () => {
    const detect = perRule<null>(async (rule) => {
      if (rule.id === "broken") throw new Error("bad input")
      return [match]
    })
    expect(await detect(run(["ok", "broken"]))).toEqual({
      findings: [{ rule: "ok", match }],
      errors: [{ rule: "broken", message: "bad input" }],
    })
  })

  test("rethrows once the run is aborted", async () => {
    const controller = new AbortController()
    const input = { ...run(["a"]), signal: controller.signal }
    const detect = perRule<null>(async () => {
      controller.abort()
      throw new Error("aborted work")
    })
    await expect(detect(input)).rejects.toThrow("aborted work")
  })
})
