import path from "node:path"
import { describe, expect, test } from "vitest"

import { matchesFromJson, matchesFromSarif } from "../../../src/detectors/command/results"
import { commandSchema } from "../../../src/detectors/command/schema"
import { symlinkedDir } from "../../helpers/symlink"

const cwd = "/repo"

describe("command schema", () => {
  test("defaults output to json and captures to none", () => {
    expect(commandSchema.parse({ run: ["./check"] })).toEqual({ run: ["./check"], output: "json", captures: [] })
  })

  test("rejects an empty run, an unknown output and a capture that is not a variable name", () => {
    expect(commandSchema.safeParse({ run: [] }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], output: "xml" }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], captures: ["not a name"] }).success).toBe(false)
  })

  test("rejects a capture that shadows a core template variable", () => {
    const result = commandSchema.safeParse({ run: ["x"], captures: ["line"] })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toContain("line")
  })
})

describe("matchesFromJson", () => {
  test("maps results, defaulting endLine, column and text", () => {
    const json = JSON.stringify([
      { file: "app/a.py", line: 3 },
      { file: "/repo/app/b.py", line: 5, endLine: 7, column: 2, text: "boom" },
    ])
    expect(matchesFromJson(json, [], cwd)).toEqual([
      { file: "app/a.py", line: 3, endLine: 3, column: 1, text: "", captures: {} },
      { file: "app/b.py", line: 5, endLine: 7, column: 2, text: "boom", captures: {} },
    ])
  })

  test("a declared capture that is missing or not a string is an error naming the result", () => {
    expect(() => matchesFromJson(JSON.stringify([{ file: "a.py", line: 1 }]), ["layer"], cwd)).toThrow(
      'result 1: capture "layer" is not a string',
    )
    expect(() => matchesFromJson(JSON.stringify([{ file: "a.py", line: 1, layer: 3 }]), ["layer"], cwd)).toThrow(
      'result 1: capture "layer" is not a string',
    )
    expect(
      matchesFromJson(JSON.stringify([{ file: "a.py", line: 1, layer: "crud" }]), ["layer"], cwd)[0]!.captures,
    ).toEqual({ layer: "crud" })
  })

  test("rejects output that is not an array of results with a file and a line", () => {
    expect(() => matchesFromJson("not json", [], cwd)).toThrow("output is not JSON")
    expect(() => matchesFromJson('{"a":1}', [], cwd)).toThrow("output is not a JSON array")
    expect(() => matchesFromJson('[{"line":1}]', [], cwd)).toThrow('result 1: "file" must be a string')
    expect(() => matchesFromJson('[{"file":"a"}]', [], cwd)).toThrow('result 1: "line" must be a number')
  })
})

describe("matchesFromSarif", () => {
  const sarif = JSON.stringify({
    version: "2.1.0",
    runs: [
      {
        results: [
          {
            message: { text: "crud reached into routes" },
            properties: { layer: "crud", target: "routes" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "app/crud/users.py" },
                  region: { startLine: 12, startColumn: 5, endLine: 13 },
                },
              },
            ],
          },
          { message: { text: "no location" }, properties: { layer: "x", target: "y" }, locations: [] },
        ],
      },
    ],
  })

  test("reads results from every run, dropping one with no location", () => {
    expect(matchesFromSarif(sarif, ["layer", "target"], cwd)).toEqual([
      {
        file: "app/crud/users.py",
        line: 12,
        endLine: 13,
        column: 5,
        text: "crud reached into routes",
        captures: { layer: "crud", target: "routes" },
      },
    ])
  })

  test("strips a file:// uri and falls back to the result's own fields for captures", () => {
    const withUri = JSON.stringify({
      runs: [
        {
          results: [
            {
              layer: "svc",
              locations: [{ physicalLocation: { artifactLocation: { uri: "file:///repo/app/s.py" } } }],
            },
          ],
        },
      ],
    })
    expect(matchesFromSarif(withUri, ["layer"], cwd)).toEqual([
      { file: "app/s.py", line: 1, endLine: 1, column: 1, text: "", captures: { layer: "svc" } },
    ])
  })

  test("decodes a percent-encoded file:// uri", () => {
    // SARIF 2.1.0 requires uri to be percent-encoded, so a path with a space arrives escaped.
    const encoded = JSON.stringify({
      runs: [
        {
          results: [{ locations: [{ physicalLocation: { artifactLocation: { uri: "file:///repo/my%20file.py" } } }] }],
        },
      ],
    })
    expect(matchesFromSarif(encoded, [], cwd)[0]!.file).toBe("my file.py")
  })

  test("relativises a path the checker resolved through a symlink", async () => {
    // A checker that calls Path.resolve() reports a realpath. Without this the finding names a
    // path no rule selected and is dropped.
    const { root, real } = await symlinkedDir("rulecast-cmd-symlink")
    const json = JSON.stringify([{ file: path.join(real, "src/a.py"), line: 1 }])
    expect(matchesFromJson(json, [], root)[0]!.file).toBe("src/a.py")
  })

  test("rejects output that is not SARIF", () => {
    expect(() => matchesFromSarif('{"runs":{}}', [], cwd)).toThrow("output is not SARIF")
  })
})
