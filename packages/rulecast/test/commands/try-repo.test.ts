import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { git } from "../helpers/git"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const MANIFEST = [
  "- id: demo/http",
  "  name: No HTTPException",
  "  files: \\.py$",
  "  detect:",
  "    regex: { pattern: 'HTTPException' }",
  '  message: "{{file}}:{{line}} uses HTTPException."',
  '  context: ["@docs/http.md#errors"]',
  "- id: demo/generated",
  "  name: Generated client",
  "  files: ^src/client/",
  "  detect: { path: {} }",
  '  message: "{{file}} is generated."',
  "",
].join("\n")

const REPO_FILES = {
  ".rulecast-rules.yaml": MANIFEST,
  "docs/http.md": "# HTTP\n\n## Errors\nRaise domain exceptions.\n",
}

type Json = { findings: { rule: string; line: number }[]; references: { ref: string }[] }
const parse = (stdout: string): Json => JSON.parse(stdout)

describe("rulecast try-repo", () => {
  test("runs a local directory's rules against the project without touching its config", async () => {
    const root = await createFixture()
    const config = await readFile(path.join(root, ".rulecast-config.yaml"), "utf8")
    const repo = await createProject(REPO_FILES)

    const result = await runCli(root, ["try-repo", repo, "--all-files", "--format", "json"])
    expect(result.code).toBe(1)
    const output = parse(result.stdout)
    expect(output.findings.map((finding) => [finding.rule, finding.line])).toEqual([
      ["demo/generated", 1],
      ["demo/http", 2],
    ])
    expect(output.references.map((reference) => reference.ref)).toEqual([
      `${path.basename(repo)}@working-tree:docs/http.md#errors`,
    ])
    expect(await readFile(path.join(root, ".rulecast-config.yaml"), "utf8")).toBe(config)
  })

  test("RULE_ID runs one rule", async () => {
    const root = await createFixture()
    const repo = await createProject(REPO_FILES)
    const result = await runCli(root, ["try-repo", repo, "demo/http", "--all-files", "--format", "json"])
    expect(parse(result.stdout).findings.map((finding) => finding.rule)).toEqual(["demo/http"])

    const unknown = await runCli(root, ["try-repo", repo, "nope", "--all-files"])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain(`no rule "nope" in ${path.basename(repo)}@working-tree`)
  })

  test("fetches a URL at --ref", async () => {
    const root = await createFixture()
    const url = await createRuleRepo([{ tag: "v1.0.0", files: REPO_FILES }])
    const result = await runCli(root, [
      "try-repo",
      url,
      "demo/http",
      "--ref",
      "v1.0.0",
      "--all-files",
      "--format",
      "json",
    ])
    expect(result.code).toBe(1)
    expect(parse(result.stdout).references.map((reference) => reference.ref)).toEqual([
      `${repoLabel(url, "v1.0.0")}:docs/http.md#errors`,
    ])
  })

  test("a relative path to a local git repo is resolved against the current directory, not the checkout", async () => {
    const root = await createFixture()
    const url = await createRuleRepo([{ tag: "v1.0.0", files: REPO_FILES }])
    // A bare repo inside the project, named the way a rule author would type it.
    await git(root, "clone", "-q", "--bare", url, path.join(root, "vendor-rules.git"))
    const result = await runCli(root, [
      "try-repo",
      "vendor-rules.git",
      "demo/http",
      "--ref",
      "v1.0.0",
      "--all-files",
      "--format",
      "json",
    ])
    expect(result.code).toBe(1)
    expect(parse(result.stdout).findings.map((finding) => finding.rule)).toEqual(["demo/http"])
  })

  test("works outside a rulecast project", async () => {
    const root = await createProject({ "app.py": "raise HTTPException(1)\n" })
    const repo = await createProject(REPO_FILES)
    const result = await runCli(root, ["try-repo", repo, "--files", "app.py", "--format", "json"])
    expect(parse(result.stdout).findings.map((finding) => finding.rule)).toEqual(["demo/http"])
  })

  test("usage problems exit 2", async () => {
    const root = await createFixture()
    const repo = await createProject(REPO_FILES)
    expect((await runCli(root, ["try-repo"])).stderr).toContain("try-repo needs a repository path or URL")
    expect((await runCli(root, ["try-repo", repo, "--ref", "v1"])).stderr).toContain("--ref only applies to URLs")
    expect((await runCli(root, ["try-repo", repo, "a", "b"])).stderr).toContain("unexpected arguments: b")
    const empty = await runCli(root, ["try-repo", await createProject({}), "--all-files"])
    expect(empty.code).toBe(2)
    expect(empty.stderr).toContain(".rulecast-rules.yaml not found")
  })
})
