import { describe, expect, test } from "vitest"

import { parseIgnore, suppress } from "../../src/core/suppress"
import type { Match } from "../../src/core/types"
import { rule } from "../helpers/rules"

const at = (file: string, line: number): Match => ({ file, line, endLine: line, column: 1, text: "", captures: {} })
const finding = (id: string, file: string, line: number) => ({ rule: rule({ id }), match: at(file, line) })
const reader = (files: Record<string, string>) => async (file: string) => files[file] ?? null

describe("parseIgnore", () => {
  test.each([
    ["x = 1  # rulecast-ignore: py/no-x legacy endpoint", "py/no-x", "legacy endpoint"],
    ["foo() // rulecast-ignore: js/no-foo the SDK has no hook", "js/no-foo", "the SDK has no hook"],
    ["/* rulecast-ignore: css/no-x vendor override */", "css/no-x", "vendor override"],
    ["<!-- rulecast-ignore: docs/no-todo tracked in #412 -->", "docs/no-todo", "tracked in #412"],
    ["# rulecast-ignore: py/no-x", "py/no-x", null],
  ])("%s", (line, rule, reason) => {
    expect(parseIgnore(line)).toEqual({ rule, reason })
  })

  test("a line without one is null", () => {
    expect(parseIgnore("x = 1  # an ordinary comment")).toBeNull()
  })
})

describe("suppress", () => {
  test("an ignore on the matched line or the line above drops the finding and records why", async () => {
    const files = {
      "a.py": [
        "raise HTTPException(404)  # rulecast-ignore: py/no-http legacy",
        "# rulecast-ignore: py/no-http still legacy",
        "raise HTTPException(500)",
        "raise HTTPException(503)",
      ].join("\n"),
    }
    const result = await suppress(
      [finding("py/no-http", "a.py", 1), finding("py/no-http", "a.py", 3), finding("py/no-http", "a.py", 4)],
      reader(files),
    )
    expect(result.findings.map((kept) => kept.match.line)).toEqual([4])
    expect(result.ignored.map((dropped) => [dropped.match.line, dropped.reason])).toEqual([
      [1, "legacy"],
      [3, "still legacy"],
    ])
    expect(result.warnings).toEqual([])
  })

  test("an ignore naming another rule suppresses nothing", async () => {
    const files = { "a.py": "x  # rulecast-ignore: py/other not this one\n" }
    const result = await suppress([finding("py/no-x", "a.py", 1)], reader(files))
    expect(result.findings).toHaveLength(1)
    expect(result.ignored).toEqual([])
  })

  test("an ignore without a reason keeps the finding and says why, once per site", async () => {
    const files = { "a.py": "x  # rulecast-ignore: py/no-x\n" }
    const result = await suppress([finding("py/no-x", "a.py", 1), finding("py/no-x", "a.py", 1)], reader(files))
    expect(result.findings).toHaveLength(2)
    expect(result.warnings).toEqual(["a.py:1: rulecast-ignore needs a reason after the rule id; the finding was kept"])
  })

  test("an alias is the id an ignore names, since it is the id findings show", async () => {
    const files = { "a.py": "x  # rulecast-ignore: py/strict-x relaxed here\n" }
    const aliased = { rule: rule({ id: "py/strict-x" }), match: at("a.py", 1) }
    expect((await suppress([aliased], reader(files))).ignored).toHaveLength(1)
  })
})
