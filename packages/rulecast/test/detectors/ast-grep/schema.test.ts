import { describe, expect, test } from "vitest"

import { astGrepSchema, captureNames } from "../../../src/detectors/ast-grep/schema"

const parse = (config: unknown) => astGrepSchema.safeParseAsync(config)

describe("ast-grep schema", () => {
  test("accepts every supported language", async () => {
    for (const language of ["css", "html", "javascript", "python", "tsx", "typescript"]) {
      const result = await parse({ language, rule: { pattern: "f($A)" } })
      expect(result.success, language).toBe(true)
    }
  })

  test("rejects an unknown language, a missing or empty rule, and unknown keys", async () => {
    expect((await parse({ language: "ruby", rule: { pattern: "f" } })).success).toBe(false)
    expect((await parse({ language: "python" })).success).toBe(false)
    expect((await parse({ language: "python", rule: {} })).success).toBe(false)
    expect((await parse({ language: "python", rule: { pattern: "f" }, oops: 1 })).success).toBe(false)
  })

  test("a rule object ast-grep cannot compile is a diagnostic naming the problem", async () => {
    const result = await parse({ language: "python", rule: { kind: "not_a_real_kind" } })
    expect(result.success).toBe(false)
    const issue = result.error!.issues[0]!
    expect(issue.path).toEqual(["rule"])
    expect(issue.message).toContain("rule` is not configured correctly")
    // Collapsed onto one line so compile diagnostics stay one line each.
    expect(issue.message).not.toContain("\n")
  })

  test("keeps constraints and utils", async () => {
    const result = await parse({
      language: "python",
      rule: { pattern: "f($A)" },
      constraints: { A: { regex: "^x" } },
      utils: { "is-call": { kind: "call" } },
    })
    expect(result.success).toBe(true)
  })

  test("captures are the config's metavariables", () => {
    expect(
      captureNames({
        language: "python",
        rule: { pattern: "raise HTTPException($$$ARGS)" },
        constraints: { ARGS: { regex: "$CODE" } },
      }),
    ).toEqual(["ARGS", "CODE"])
  })
})
