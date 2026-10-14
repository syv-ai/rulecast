import path from "node:path"
import { describe, expect, test } from "vitest"

import { readOutput } from "../../../../src/core/detection/outputs"
import { symlinkedDir } from "../../../helpers/symlink"
import { payload } from "./payload"

const cwd = "/repo"

describe("gitlab", () => {
  test("ty: check_name is the rule id, its prefix leaves the message, positions give the range", () => {
    const findings = readOutput("gitlab", payload("ty.gitlab.json"), cwd)
    expect(findings).toHaveLength(4)
    expect(findings[0]).toEqual({
      file: "a.py",
      line: 10,
      column: 15,
      endLine: 10,
      endColumn: 24,
      ruleId: "invalid-assignment",
      severity: "major",
      message: "Object of type `int` is not assignable to `str`",
      text: null,
      properties: expect.objectContaining({ fingerprint: "77ae48826b9bcd8b" }),
    })
  })

  test("lines.begin, as most code-quality reports carry it", () => {
    const report = JSON.stringify([
      { description: "too long", check_name: "max-len", location: { path: "/repo/a.js", lines: { begin: 7 } } },
    ])
    expect(readOutput("gitlab", report, cwd)[0]).toMatchObject({ file: "a.js", line: 7, column: 1, endLine: 7 })
  })

  test("not an array is an error", () => {
    expect(() => readOutput("gitlab", '{"a":1}', cwd)).toThrow("not a GitLab code-quality")
  })
})

describe("sarif", () => {
  test("staticcheck: ruleId, end column, and the default level", () => {
    const findings = readOutput("sarif", payload("staticcheck.sarif.json"), cwd)
    expect(findings.map((f) => f.ruleId)).toEqual(["U1000", "S1003", "SA5009"])
    expect(findings[1]).toMatchObject({
      file: "main.go",
      line: 12,
      column: 5,
      endLine: 12,
      endColumn: 32,
      severity: "warning",
      message: 'should use strings.Contains(s, "a") instead',
    })
  })

  test("a result with no region is on line 1; passing and suppressed results are dropped", () => {
    const sarif = JSON.stringify({
      runs: [
        {
          results: [
            { ruleId: "GHSA-1", level: "error", message: { text: "vulnerable" }, locations: [loc("requirements.txt")] },
            { ruleId: "P", kind: "pass", message: { text: "fine" }, locations: [loc("a")] },
            { ruleId: "S", message: { text: "hidden" }, locations: [loc("a")], suppressions: [{ kind: "inSource" }] },
            {
              ruleId: "R",
              message: { text: "rejected suppression" },
              locations: [loc("b")],
              suppressions: [{ kind: "external", status: "rejected" }],
            },
          ],
        },
      ],
    })
    expect(readOutput("sarif", sarif, cwd).map((f) => [f.file, f.line, f.ruleId, f.severity])).toEqual([
      ["requirements.txt", 1, "GHSA-1", "error"],
      ["b", 1, "R", "warning"],
    ])
  })

  test("a uri relative to a base the run declares is resolved against it", () => {
    const sarif = JSON.stringify({
      runs: [
        {
          originalUriBaseIds: { SRC: { uri: "file:///repo/pkg/" } },
          results: [{ message: { text: "x" }, locations: [loc("a.go", "SRC")] }],
        },
      ],
    })
    expect(readOutput("sarif", sarif, cwd)[0]!.file).toBe("pkg/a.go")
  })

  test("a file:// uri, percent-encoded as SARIF requires, is decoded and made relative", () => {
    const sarif = JSON.stringify({
      runs: [{ results: [{ locations: [loc("file:///repo/my%20file.py")] }] }],
    })
    expect(readOutput("sarif", sarif, cwd)[0]).toMatchObject({ file: "my file.py", line: 1, message: "" })
  })

  test("the result's own string fields and its properties are both available to captures", () => {
    const sarif = JSON.stringify({
      runs: [{ results: [{ layer: "svc", properties: { target: "routes" }, locations: [loc("a.py")] }] }],
    })
    expect(readOutput("sarif", sarif, cwd)[0]!.properties).toMatchObject({ layer: "svc", target: "routes" })
  })

  test("output that is not SARIF is an error", () => {
    expect(() => readOutput("sarif", '{"runs":{}}', cwd)).toThrow("output is not SARIF")
  })
})

function loc(uri: string, uriBaseId?: string) {
  return { physicalLocation: { artifactLocation: { uri, ...(uriBaseId ? { uriBaseId } : {}) } } }
}

describe("checkstyle", () => {
  test("shellcheck: entities decoded, the last part of source is the rule id", () => {
    const findings = readOutput("checkstyle", payload("shellcheck.checkstyle.xml"), cwd)
    expect(findings).toHaveLength(6)
    expect(findings[0]).toMatchObject({
      file: "s.sh",
      line: 2,
      column: 8,
      ruleId: "SC2115",
      severity: "warning",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shellcheck's own text, quoting shell syntax.
      message: 'Use "${var:?}" to ensure this never expands to /* .',
    })
    expect(findings[5]!.message).toBe("Use 'cd ... || exit' or 'cd ... || return' in case cd fails.")
  })

  test("double-quoted attributes, several files, and a file with no errors", () => {
    const xml = `<?xml version="1.0"?><checkstyle><file name="/repo/a.js"><error line="3" severity="error" message="a &amp; b" source="eslint.rules.no-eval"/></file><file name="b.js"></file></checkstyle>`
    expect(readOutput("checkstyle", xml, cwd)).toEqual([
      expect.objectContaining({ file: "a.js", line: 3, column: 1, ruleId: "no-eval", message: "a & b" }),
    ])
  })

  test("output that is not checkstyle is an error", () => {
    expect(() => readOutput("checkstyle", "warning: something", cwd)).toThrow("not checkstyle XML")
  })
})

describe("rdjson", () => {
  test("a diagnostic result: code.value, severity lowercased, a missing range is line 1", () => {
    expect(readOutput("rdjson", payload("rdjson.json"), cwd)).toEqual([
      expect.objectContaining({
        file: "src/a.ts",
        line: 3,
        column: 9,
        endLine: 3,
        endColumn: 21,
        ruleId: "prefer-template",
        severity: "error",
      }),
      expect.objectContaining({ file: "src/b.ts", line: 1, column: 1, ruleId: "", severity: "warning" }),
    ])
  })

  test("rdjsonl: one diagnostic per line", () => {
    const lines = [
      JSON.stringify({ message: "a", location: { path: "x.go", range: { start: { line: 2 } } } }),
      JSON.stringify({ message: "b", location: { path: "y.go", range: { start: { line: 5, column: 3 } } } }),
    ].join("\n")
    expect(readOutput("rdjson", lines, cwd).map((f) => [f.file, f.line, f.column])).toEqual([
      ["x.go", 2, 1],
      ["y.go", 5, 3],
    ])
  })
})

describe("json", () => {
  test("rulecast's own array: optional ruleId, message, severity and text", () => {
    const json = JSON.stringify([
      { file: "app/a.py", line: 3 },
      {
        file: "/repo/app/b.py",
        line: 5,
        endLine: 7,
        column: 2,
        text: "boom",
        ruleId: "R1",
        message: "m",
        layer: "crud",
      },
    ])
    expect(readOutput("json", json, cwd)).toEqual([
      {
        file: "app/a.py",
        line: 3,
        column: 1,
        endLine: 3,
        endColumn: null,
        ruleId: "",
        severity: "",
        message: "",
        text: null,
        properties: { file: "app/a.py" },
      },
      expect.objectContaining({
        file: "app/b.py",
        endLine: 7,
        column: 2,
        text: "boom",
        ruleId: "R1",
        message: "m",
        properties: expect.objectContaining({ layer: "crud" }),
      }),
    ])
  })

  test("a path the checker resolved through a symlink is still made relative", async () => {
    // A checker that calls Path.resolve() reports a realpath. Without this the finding names a
    // path no rule selected and is dropped.
    const { root, real } = await symlinkedDir("rulecast-outputs-symlink")
    const json = JSON.stringify([{ file: path.join(real, "src/a.py"), line: 1 }])
    expect(readOutput("json", json, root)[0]!.file).toBe("src/a.py")
  })

  test("rejects output that is not an array of results with a file and a line", () => {
    expect(() => readOutput("json", "not json", cwd)).toThrow("output is not JSON")
    expect(() => readOutput("json", '{"a":1}', cwd)).toThrow("output is not a JSON array")
    expect(() => readOutput("json", '[{"line":1}]', cwd)).toThrow('result 1: "file" must be a string')
    expect(() => readOutput("json", '[{"file":"a"}]', cwd)).toThrow('result 1: "line" must be a number')
  })
})

describe("every structured format", () => {
  test("empty output is no findings: a clean tool may print nothing", () => {
    for (const format of ["json", "sarif", "gitlab", "rdjson", "checkstyle"] as const) {
      expect(readOutput(format, "  \n", cwd)).toEqual([])
    }
  })
})
