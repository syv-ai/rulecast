import { describe, expect, test } from "vitest"

import { loadRuleFiles, ruleSchema } from "../../../src/core/compile/rules"
import { createProject } from "../../helpers/project"

describe("ruleSchema", () => {
  test("applies defaults", () => {
    const rule = ruleSchema.parse({ id: "api/no-client", files: "src/**/*.tsx", detect: { path: {} }, message: "x" })
    expect(rule).toMatchObject({ severity: "error", on: ["violation"], ignore: [], context: [] })
  })

  test("rejects bad ids, several detectors and unknown keys", () => {
    expect(ruleSchema.safeParse({ id: "Api", files: "x" }).success).toBe(false)
    expect(ruleSchema.safeParse({ id: "a", files: "x", detect: { path: {}, regex: {} } }).success).toBe(false)
    expect(ruleSchema.safeParse({ id: "a", files: "x", colour: "red" }).success).toBe(false)
  })
})

describe("loadRuleFiles", () => {
  test("loads matching files in sorted order and reports YAML errors", async () => {
    const root = await createProject({
      ".rulecast/rules/b.yml": "id: b\n",
      ".rulecast/rules/nested/a.yml": "id: a\n",
      ".rulecast/rules/broken.yml": "id: [",
      ".rulecast/rules/notes.md": "not a rule",
    })
    const files = await loadRuleFiles(root, ".rulecast/rules/**/*.yml")
    expect(files.map((file) => [file.source, file.ok])).toEqual([
      [".rulecast/rules/b.yml", true],
      [".rulecast/rules/broken.yml", false],
      [".rulecast/rules/nested/a.yml", true],
    ])
    expect(files[0]).toMatchObject({ ok: true, data: { id: "b" } })
  })
})
