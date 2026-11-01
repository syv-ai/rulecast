import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"

/** Every config above a file judges it: a top config and one in backend/, each with its own rule. */
const TOP_RULE = {
  id: "top/no-todo",
  name: "No TODO",
  files: "\\.py$",
  detect: { regex: { pattern: "TODO" } },
  message: "{{file}}:{{line}} has a TODO.",
}
const BACKEND_RULE = {
  id: "backend/no-print",
  name: "No print",
  files: "\\.py$",
  detect: { regex: { pattern: "print\\(" } },
  message: "{{file}}:{{line}} prints.",
}
const BAD = "# TODO\nprint(1)\n"

function createMonorepo(): Promise<string> {
  return createRepo({
    ".rulecast-config.yaml": localConfig([TOP_RULE]),
    "backend/.rulecast-config.yaml": localConfig([BACKEND_RULE]),
    "backend/ok.py": "x = 1\n",
    "top.py": "x = 1\n",
  })
}

const findings = (stdout: string) =>
  JSON.parse(stdout)
    .findings.map((finding: { rule: string; file: string }) => `${finding.rule} ${finding.file}`)
    .sort()

describe("rulecast run: every config above a file", () => {
  test("a pre-commit at the top with a staged backend/x.py runs both configs", async () => {
    const root = await createMonorepo()
    await writeFile(path.join(root, "backend/x.py"), BAD)
    await git(root, "add", "backend/x.py")
    const result = await runCli(root, ["run", "--format", "json"])
    expect(result.code).toBe(1)
    expect(findings(result.stdout)).toEqual(["backend/no-print backend/x.py", "top/no-todo backend/x.py"])
    expect(JSON.parse(result.stdout).checked).toEqual({ files: 1, selection: "staged" })
  })

  test("--all-files in backend/ runs the backend and top configs, on backend files only", async () => {
    const root = await createMonorepo()
    await writeFile(path.join(root, "backend/x.py"), BAD)
    await writeFile(path.join(root, "top.py"), BAD)
    const result = await runCli(path.join(root, "backend"), ["run", "--all-files", "--format", "json"])
    expect(result.code).toBe(1)
    // Shown from backend/, where run was started.
    expect(findings(result.stdout)).toEqual(["backend/no-print x.py", "top/no-todo x.py"])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.checked.files).toBe(3)
    expect(parsed.baseline).toBeUndefined()
    expect(parsed.baselines).toEqual([
      { root: ".", baseline: null },
      { root: "..", baseline: null },
    ])
  })

  test("a RULE_ID defined only in the backend config runs from the top", async () => {
    const root = await createMonorepo()
    await writeFile(path.join(root, "backend/x.py"), BAD)
    await writeFile(path.join(root, "top.py"), BAD)
    const result = await runCli(root, ["run", "backend/no-print", "--all-files", "--format", "json"])
    expect(result.code).toBe(1)
    expect(findings(result.stdout)).toEqual(["backend/no-print backend/x.py"])
    const missing = await runCli(root, ["run", "nobody/defines-this", "--all-files"])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('no rule "nobody/defines-this"')
  })

  test("SARIF with two projects has two runs, each with its own rules, locations from where run started", async () => {
    const root = await createMonorepo()
    await writeFile(path.join(root, "backend/x.py"), BAD)
    const result = await runCli(root, ["run", "--all-files", "--format", "sarif"])
    const runs = JSON.parse(result.stdout).runs
    expect(runs).toHaveLength(2)
    expect(runs.map((run: { automationDetails: { id: string } }) => run.automationDetails.id)).toEqual([
      "rulecast/",
      "rulecast/backend/",
    ])
    expect(runs.map((run: { tool: { driver: { rules: { id: string }[] } } }) => run.tool.driver.rules)).toEqual([
      [expect.objectContaining({ id: "top/no-todo" })],
      [expect.objectContaining({ id: "backend/no-print" })],
    ])
    for (const run of runs) {
      expect(run.results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("backend/x.py")
    }
  })

  test("fix: every project writes before any checks, so each exit code sees the other's edits", async () => {
    const fixable = (id: string, pattern: string, fix: string) => ({
      id,
      name: id,
      files: "\\.py$",
      detect: { regex: { pattern, fix } },
      message: "{{file}}:{{line}}",
      examples: { bad: [{ path: "a.py", code: `${pattern}\n`, fixed: `${fix}\n` }] },
    })
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([fixable("top/a", "aaa", "bbb")]),
      "backend/.rulecast-config.yaml": localConfig([fixable("backend/b", "bbb", "ccc")]),
      "backend/x.py": "aaa\n",
    })
    const result = await runCli(root, ["fix", "--all-files", "--format", "json"])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.changedFiles).toEqual(["backend/x.py", "backend/x.py"])
    expect(parsed.findings).toEqual([])
    expect(result.code).toBe(0)
  })
})
