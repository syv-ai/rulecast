import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { git } from "../helpers/git"

async function run(cwd: string, ...argv: string[]) {
  const { code, stdout, stderr } = await runCli(cwd, argv)
  return { code, stdout, stderr }
}

describe("rulecast CLI", () => {
  test("validate reports rule count, or diagnostics with exit 2", async () => {
    const root = await createFixture()
    expect(await run(root, "validate")).toEqual({ code: 0, stdout: "rulecast: 3 rules valid\n", stderr: "" })
    await writeFile(
      path.join(root, ".rulecast/rules/broken.yml"),
      "id: broken\nfiles: '**'\ndetect: { nope: {} }\nmessage: m\n",
    )
    expect(await run(root, "validate")).toEqual({
      code: 2,
      stdout: '.rulecast/rules/broken.yml (broken): unknown detector "nope"\n',
      stderr: "",
    })
  })

  test("check without arguments checks every file matched by a rule", async () => {
    const root = await createFixture()
    const result = await run(root, "check")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("app/services/users.py:2:5  error    backend/no-httpexception")
    expect(result.stdout).toContain("src/client/api.ts:1:1  warning  frontend/no-generated-edits")
    expect(result.stdout.trimEnd().endsWith("1 error, 1 warning")).toBe(true)
  })

  test("check with files resolves them relative to cwd", async () => {
    const root = await createFixture()
    const result = await run(path.join(root, "src"), "check", "client/api.ts", "--format", "json")
    // cwd is a subdirectory, but the project root is found by walking up to .rulecast.
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "frontend/no-generated-edits",
    ])
  })

  test("check --base only checks changed files and only new findings count", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    expect((await run(root, "check", "--base", "main")).stdout.trim()).toBe("no findings")
    await writeFile(path.join(root, "app/services/users.py"), "def get():\n    raise HTTPException(404)\n    x = 1\n")
    const result = await run(root, "check", "--base", "main")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("pre-existing (not blocking): backend/no-httpexception ×1 in app/services/users.py")
  })

  test("usage errors exit 2", async () => {
    const root = await createFixture()
    expect((await run(root, "frobnicate")).code).toBe(2)
    expect((await run(root, "check", "--format", "xml")).stderr).toContain('unknown format "xml"')
    expect((await run(root, "check", "--base", "nope")).stderr).toContain("cannot find merge base with nope")
  })
})
