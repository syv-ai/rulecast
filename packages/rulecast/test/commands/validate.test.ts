import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const HTTP_DOC = "# HTTP\n\n## Errors\nRaise domain exceptions.\n"

const MANIFEST = [
  "- id: demo/http",
  "  name: No HTTPException",
  "  files: \\.py$",
  "  detect:",
  "    regex: { pattern: 'HTTPException' }",
  '  message: "{{file}}:{{line}} uses HTTPException."',
  '  context: ["@docs/http.md#errors"]',
  "",
].join("\n")

const BROKEN_RULE = ["- id: demo/bad", "  name: Bad", "  detect: { path: {} }", '  message: "{{nope}}"', ""].join("\n")

const validate = (cwd: string, ...files: string[]) => runCli(cwd, ["validate", ...files])

describe("rulecast validate", () => {
  test("validates the project config", async () => {
    const root = await createFixture()
    expect(await validate(root)).toEqual({
      code: 0,
      stdout: ".rulecast-config.yaml: 3 rules valid\n",
      stderr: "",
      warmed: [],
    })
  })

  test("prints each diagnostic and exits 2", async () => {
    const root = await createProject({
      ".rulecast-config.yaml": localConfig([{ id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    })
    expect(await validate(root)).toMatchObject({
      code: 2,
      stdout: '.rulecast-config.yaml: .rulecast-config.yaml (broken): unknown detector "nope"\n',
    })
  })

  test("validates a rule repo's manifest, resolving references against its directory", async () => {
    const root = await createProject({ ".rulecast-rules.yaml": MANIFEST, "docs/http.md": HTTP_DOC })
    expect(await validate(root)).toMatchObject({ code: 0, stdout: ".rulecast-rules.yaml: 1 rule valid\n" })
    await writeFile(path.join(root, ".rulecast-rules.yaml"), MANIFEST + BROKEN_RULE)
    expect(await validate(root)).toMatchObject({
      code: 2,
      stdout: '.rulecast-rules.yaml: .rulecast-rules.yaml (demo/bad): unknown template variable "nope"\n',
    })
  })

  test("takes files by name, and validates both files at the root without arguments", async () => {
    const nested = await createProject({ "rules/.rulecast-rules.yaml": MANIFEST, "rules/docs/http.md": HTTP_DOC })
    expect(await validate(nested, "rules/.rulecast-rules.yaml")).toMatchObject({
      code: 0,
      stdout: "rules/.rulecast-rules.yaml: 1 rule valid\n",
    })
    const both = await createProject({
      ".rulecast-config.yaml": localConfig([]),
      ".rulecast-rules.yaml": MANIFEST,
      "docs/http.md": HTTP_DOC,
    })
    expect(await validate(both)).toMatchObject({
      code: 0,
      stdout: ".rulecast-config.yaml: 0 rules valid\n.rulecast-rules.yaml: 1 rule valid\n",
    })
  })

  test("a branch-like rev is a warning, not a failure", async () => {
    const url = await createRuleRepo([
      { tag: "stable", files: { ".rulecast-rules.yaml": MANIFEST, "docs/http.md": HTTP_DOC } },
    ])
    const root = await createProject({
      ".rulecast-config.yaml": `repos:\n  - repo: ${url}\n    rev: stable\n    rules:\n      - id: demo/http\n`,
    })
    expect(await validate(root)).toMatchObject({
      code: 0,
      stdout: [
        `.rulecast-config.yaml: warning: ${url}@stable: rev "stable" looks like a branch: pin a tag or a full commit SHA`,
        ".rulecast-config.yaml: 1 rule valid",
        "",
      ].join("\n"),
    })
  })

  test("other file names and empty directories are errors", async () => {
    const root = await createProject({ "README.md": "" })
    const other = await validate(root, "README.md")
    expect(other.code).toBe(2)
    expect(other.stderr).toContain("README.md: not a .rulecast-config.yaml or .rulecast-rules.yaml")
    const empty = await validate(root)
    expect(empty.code).toBe(2)
    expect(empty.stderr).toContain("nothing to validate: no .rulecast-config.yaml or .rulecast-rules.yaml")
  })
})
