import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { linterSchema } from "../../../src/detectors/linter/schema"
import { TOOLS } from "../../../src/detectors/linter/tools"

const payloads = fileURLToPath(new URL("../../payloads/linter/", import.meta.url))
const ROOT = "/repo"
const recording = async (tool: string) =>
  (await readFile(path.join(payloads, `${tool}.json`), "utf8")).replaceAll("__ROOT__", ROOT)

describe("linter schema", () => {
  test("accepts the three tools and an optional rule list", () => {
    expect(linterSchema.parse({ tool: "ruff" })).toEqual({ tool: "ruff" })
    expect(linterSchema.parse({ tool: "oxlint", rules: ["no-debugger"] })).toEqual({
      tool: "oxlint",
      rules: ["no-debugger"],
    })
    expect(linterSchema.safeParse({ tool: "biome" }).success).toBe(false)
    expect(linterSchema.safeParse({ tool: "ruff", extra: 1 }).success).toBe(false)
  })
})

describe("tool adapters", () => {
  test("eslint defaults to verify only; ruff and oxlint run on edits too", () => {
    expect(TOOLS.eslint.events).toEqual(["verify"])
    expect(TOOLS.ruff.events).toEqual(["edit", "verify"])
    expect(TOOLS.oxlint.events).toEqual(["edit", "verify"])
  })

  test("each tool asks for JSON and passes the files last", () => {
    expect(TOOLS.ruff.args(["a.py"])).toEqual(["check", "--output-format", "json", "--force-exclude", "--", "a.py"])
    expect(TOOLS.oxlint.args(["a.js"])).toEqual(["--format=json", "--", "a.js"])
    expect(TOOLS.eslint.args(["a.js"])).toEqual(["--format=json", "--no-error-on-unmatched-pattern", "--", "a.js"])
  })

  test("ruff output becomes findings with repo-relative files", async () => {
    expect(TOOLS.ruff.parse(await recording("ruff"), ROOT)).toEqual([
      {
        file: "app/a.py",
        line: 1,
        column: 8,
        endLine: 1,
        endColumn: 10,
        ruleId: "F401",
        message: "`os` imported but unused",
      },
      { file: "app/a.py", line: 2, column: 1, endLine: 2, endColumn: 6, ruleId: "T201", message: "`print` found" },
    ])
  })

  test("oxlint output becomes findings, with the rule id taken out of its code", async () => {
    const findings = TOOLS.oxlint.parse(await recording("oxlint"), ROOT)
    expect(findings.map((finding) => [finding.ruleId, finding.file, finding.line, finding.column])).toEqual([
      ["no-unused-vars", "src/a.js", 2, 7],
      ["no-debugger", "src/a.js", 3, 1],
    ])
  })

  test("eslint output becomes findings with absolute paths made relative", async () => {
    const findings = TOOLS.eslint.parse(await recording("eslint"), ROOT)
    expect(findings.map((finding) => [finding.ruleId, finding.file, finding.line, finding.endLine])).toEqual([
      ["no-console", "src/a.js", 1, 1],
      ["no-debugger", "src/a.js", 3, 3],
    ])
  })

  test("empty output from each tool is no findings", () => {
    expect(TOOLS.ruff.parse("[]", ROOT)).toEqual([])
    expect(TOOLS.oxlint.parse('{"diagnostics":[]}', ROOT)).toEqual([])
    expect(TOOLS.eslint.parse('[{"filePath":"/repo/a.js","messages":[]}]', ROOT)).toEqual([])
  })

  test("unreadable output is an error naming the tool", () => {
    expect(() => TOOLS.ruff.parse("boom", ROOT)).toThrow("ruff output is not JSON")
    expect(() => TOOLS.oxlint.parse("[]", ROOT)).toThrow("oxlint output is not JSON")
  })
})
