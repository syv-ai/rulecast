import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { linterSchema } from "../../../src/detectors/linter/schema"
import { TOOLS } from "../../../src/detectors/linter/tools"
import { symlinkedDir } from "../../helpers/symlink"

const payloads = fileURLToPath(new URL("../../payloads/linter/", import.meta.url))
const ROOT = "/repo"
const recording = async (tool: string) =>
  (await readFile(path.join(payloads, `${tool}.json`), "utf8")).replaceAll("__ROOT__", ROOT)

describe("linter schema", () => {
  test("accepts the four tools and an optional rule list", () => {
    expect(linterSchema.parse({ tool: "ruff" })).toEqual({ tool: "ruff" })
    expect(linterSchema.parse({ tool: "oxlint", rules: ["no-debugger"] })).toEqual({
      tool: "oxlint",
      rules: ["no-debugger"],
    })
    expect(linterSchema.parse({ tool: "gitleaks" })).toEqual({ tool: "gitleaks" })
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
    expect(TOOLS.ruff.args(["a.py"], [])).toEqual(["check", "--output-format", "json", "--force-exclude", "--", "a.py"])
    expect(TOOLS.oxlint.args(["a.js"], [])).toEqual(["--format=json", "--", "a.js"])
    expect(TOOLS.eslint.args(["a.js"], [])).toEqual(["--format=json", "--no-error-on-unmatched-pattern", "--", "a.js"])
  })

  test("each tool turns on the rules it is asked for, whatever the project's config selects", () => {
    expect(TOOLS.ruff.args(["a.py"], ["S110", "T201"])).toEqual([
      "check",
      "--output-format",
      "json",
      "--force-exclude",
      "--extend-select",
      "S110,T201",
      "--",
      "a.py",
    ])
    expect(TOOLS.ruff.stdinArgs!("a.py", ["S110"])).toEqual([
      "check",
      "--output-format",
      "json",
      "--force-exclude",
      "--extend-select",
      "S110",
      "--stdin-filename",
      "a.py",
      "-",
    ])
    expect(TOOLS.oxlint.args(["a.js"], ["no-empty", "max-params"])).toEqual([
      "--format=json",
      "-D",
      "no-empty",
      "-D",
      "max-params",
      "--",
      "a.js",
    ])
    expect(TOOLS.eslint.args(["a.js"], ["no-empty", "@typescript-eslint/no-explicit-any"])).toEqual([
      "--format=json",
      "--no-error-on-unmatched-pattern",
      "--rule",
      "no-empty: error",
      "--rule",
      "@typescript-eslint/no-explicit-any: error",
      "--",
      "a.js",
    ])
    expect(TOOLS.eslint.stdinArgs!("a.js", ["no-empty"])).toEqual([
      "--format=json",
      "--rule",
      "no-empty: error",
      "--stdin",
      "--stdin-filename",
      "a.js",
    ])
  })

  test("gitleaks scans the files given, or one file on stdin, with the rules asked for", () => {
    expect(TOOLS.gitleaks.events).toEqual(["edit", "verify"])
    expect(TOOLS.gitleaks.args(["app/conf.py"], [])).toEqual([
      "dir",
      "--no-banner",
      "--log-level",
      "error",
      "--report-format",
      "json",
      "--report-path",
      "-",
      "--",
      "app/conf.py",
    ])
    expect(TOOLS.gitleaks.stdinArgs!("app/conf.py", ["generic-api-key", "aws-access-token"])).toEqual([
      "stdin",
      "--no-banner",
      "--log-level",
      "error",
      "--report-format",
      "json",
      "--report-path",
      "-",
      "--enable-rule",
      "generic-api-key",
      "--enable-rule",
      "aws-access-token",
    ])
    // The secret is the finding: it must not be echoed into hook output, logs or SARIF.
    expect(TOOLS.gitleaks.redacts).toBe(true)
  })

  test("gitleaks output becomes findings with an exclusive end column; stdin findings name no file", async () => {
    expect(TOOLS.gitleaks.parse(await recording("gitleaks"), ROOT)).toEqual([
      {
        file: "app/conf.py",
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 42,
        ruleId: "generic-api-key",
        message:
          "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.",
      },
    ])
    expect(TOOLS.gitleaks.parse(await recording("gitleaks-stdin"), ROOT).map((finding) => finding.file)).toEqual([""])
    expect(TOOLS.gitleaks.parse("[]", ROOT)).toEqual([])
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

  test("relativises a path the tool resolved through a symlink", async () => {
    // eslint reports realpaths, so a root given as a symlinked path comes back resolved. Without
    // this the file never matches the rule's.
    const { root, real } = await symlinkedDir("rulecast-symlink")
    const stdout = JSON.stringify([{ filePath: path.join(real, "src/a.js"), messages: [{ ruleId: "x", line: 1 }] }])
    expect(TOOLS.eslint.parse(stdout, root)[0]!.file).toBe("src/a.js")
  })

  test("unreadable output is an error naming the tool", () => {
    expect(() => TOOLS.ruff.parse("boom", ROOT)).toThrow("ruff output is not JSON")
    expect(() => TOOLS.oxlint.parse("[]", ROOT)).toThrow("oxlint output is not JSON")
  })
})
