import { describe, expect, test } from "vitest"

import { outputSchema, readOutput } from "../../../../src/core/detection/outputs"
import { payload } from "./payload"

const cwd = "/repo"
const brief = (findings: ReturnType<typeof readOutput>) =>
  findings.map(({ file, line, column, ruleId, severity, message }) => ({
    file,
    line,
    column,
    ruleId,
    severity,
    message,
  }))

describe("lines: gcc", () => {
  test("mypy: the trailing [code] is the rule id and leaves the message", () => {
    expect(brief(readOutput({ lines: "gcc" }, payload("mypy.txt"), cwd))[0]).toEqual({
      file: "a.py",
      line: 10,
      column: 15,
      ruleId: "assignment",
      severity: "error",
      message: 'Incompatible types in assignment (expression has type "int", variable has type "str")',
    })
  })

  test("ty concise: error[rule] carries the rule id, and the summary line is ignored", () => {
    const findings = brief(readOutput({ lines: "gcc" }, payload("ty.concise.txt"), cwd))
    expect(findings).toHaveLength(4)
    expect(findings[1]).toEqual({
      file: "a.py",
      line: 11,
      column: 7,
      ruleId: "unresolved-reference",
      severity: "error",
      message: "Name `undefined_name` used when not defined",
    })
  })

  test("staticcheck, golangci-lint and shellcheck: a trailing (rule) or [rule]", () => {
    expect(readOutput({ lines: "gcc" }, payload("staticcheck.txt"), cwd).map((f) => f.ruleId)).toEqual([
      "U1000",
      "S1003",
      "SA5009",
    ])
    expect(readOutput({ lines: "gcc" }, payload("golangci-lint.txt"), cwd).map((f) => f.ruleId)).toEqual([
      "govet",
      "ineffassign",
      "staticcheck",
      "unused",
    ])
    const shellcheck = readOutput({ lines: "gcc" }, payload("shellcheck.gcc.txt"), cwd)
    expect(shellcheck.map((f) => [f.ruleId, f.severity])).toEqual([
      ["SC2115", "warning"],
      ["SC2086", "note"],
      ["SC2045", "error"],
      ["SC2035", "note"],
      ["SC2086", "note"],
      ["SC2164", "warning"],
    ])
  })

  test("tflint compact: 'Warning - ' is a severity, and the header line is ignored", () => {
    const findings = brief(readOutput({ lines: "gcc" }, payload("tflint.compact.txt"), cwd))
    expect(findings).toHaveLength(3)
    expect(findings[0]).toMatchObject({
      line: 5,
      column: 1,
      severity: "warning",
      ruleId: "terraform_required_providers",
    })
    expect(findings[0]!.message).toBe('Missing version constraint for provider "aws" in `required_providers`')
  })

  test("deadcode: no severity, no rule id, the whole rest is the message", () => {
    expect(brief(readOutput({ lines: "gcc" }, payload("deadcode.txt"), cwd))).toEqual([
      { file: "main.go", line: 8, column: 6, ruleId: "", severity: "", message: "unreachable func: unused" },
    ])
  })

  test("a parenthesised remark with spaces is part of the message, not a rule id", () => {
    const [finding] = readOutput({ lines: "gcc" }, "a.py:1:1: something odd (90% confidence)\n", cwd)
    expect(finding).toMatchObject({ ruleId: "", message: "something odd (90% confidence)" })
  })

  test("absolute paths are made repo-relative; ANSI colour is stripped; CRLF is fine", () => {
    const text = "\u001b[1m/repo/src/a.py\u001b[0m:3:4: warning: careful [W1]\r\nnoise line\r\n"
    expect(brief(readOutput({ lines: "gcc" }, text, cwd))).toEqual([
      { file: "src/a.py", line: 3, column: 4, ruleId: "W1", severity: "warning", message: "careful" },
    ])
  })

  test("a Windows drive letter is part of the file", () => {
    const [finding] = readOutput({ lines: "gcc" }, "C:\\work\\a.py:3:4: oops\n", "C:\\work")
    expect(finding).toMatchObject({ line: 3, column: 4, message: "oops" })
  })
})

describe("lines: gcc-nocol", () => {
  test("vulture: line only, column 1, the confidence stays in the message", () => {
    const findings = brief(readOutput({ lines: "gcc-nocol" }, payload("vulture.txt"), cwd))
    expect(findings).toHaveLength(4)
    expect(findings[0]).toEqual({
      file: "a.py",
      line: 1,
      column: 1,
      ruleId: "",
      severity: "",
      message: "unused import 'os' (90% confidence)",
    })
  })
})

describe("lines: msbuild", () => {
  test("tsc: file(line,col): error TSnnnn: message", () => {
    expect(brief(readOutput({ lines: "msbuild" }, payload("tsc.txt"), cwd))).toEqual([
      {
        file: "src/index.ts",
        line: 2,
        column: 7,
        ruleId: "TS2322",
        severity: "error",
        message: "Type 'string' is not assignable to type 'number'.",
      },
    ])
  })

  test("dotnet: a Windows path, and the trailing [project] is dropped", () => {
    const text = "C:\\src\\App\\File.cs(12,5): warning CA1822: Member 'X' can be static [C:\\src\\App\\App.csproj]\n"
    expect(brief(readOutput({ lines: "msbuild" }, text, "C:\\src"))[0]).toMatchObject({
      line: 12,
      column: 5,
      ruleId: "CA1822",
      severity: "warning",
      message: "Member 'X' can be static",
    })
  })
})

describe("lines: { pattern }", () => {
  const pyright = {
    lines: { pattern: "^\\s+(?<file>.+?):(?<line>\\d+):(?<col>\\d+) - (?<severity>\\w+): (?<message>.*)$" },
  }

  test("pyright text: named groups, absolute paths made relative, continuation lines ignored", () => {
    const findings = brief(readOutput(outputSchema.parse(pyright), payload("pyright.txt", cwd), cwd))
    expect(findings).toHaveLength(4)
    expect(findings[1]).toEqual({
      file: "a.py",
      line: 11,
      column: 7,
      ruleId: "",
      severity: "error",
      message: '"undefined_name" is not defined (reportUndefinedVariable)',
    })
  })

  test("a rule group and any other named group, which becomes a property for captures", () => {
    const format = outputSchema.parse({
      lines: { pattern: "^(?<file>[^:]+):(?<line>\\d+): (?<rule>\\w+) (?<layer>\\w+): (?<message>.*)$" },
    })
    const [finding] = readOutput(format, "app/x.py:4: L1 crud: reached into routes\n", cwd)
    expect(finding).toMatchObject({ ruleId: "L1", message: "reached into routes", properties: { layer: "crud" } })
  })

  test("a pattern without file, line or message, or one that does not compile, is a schema error", () => {
    expect(outputSchema.safeParse({ lines: { pattern: "^(?<file>.+):(?<line>\\d+)$" } }).success).toBe(false)
    expect(outputSchema.safeParse({ lines: { pattern: "^(?<line>\\d+): (?<message>.*)$" } }).success).toBe(false)
    const broken = outputSchema.safeParse({ lines: { pattern: "(?<file>[a-" } })
    expect(broken.success).toBe(false)
    expect(broken.error!.issues[0]!.message).toContain("does not compile")
  })

  test("an unknown preset is a schema error", () => {
    expect(outputSchema.safeParse({ lines: "clang" }).success).toBe(false)
  })
})
