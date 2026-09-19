import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { git } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

const run = (cwd: string, ...argv: string[]) => runCli(cwd, ["run", ...argv])
const lines = (stdout: string) => JSON.parse(stdout).findings.map((finding: { line: number }) => finding.line)

describe("rulecast run: file selection", () => {
  test("--all-files checks every file git knows about", async () => {
    const root = await createFixture()
    const result = await run(root, "--all-files")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("app/services/users.py:2:5  error    backend/no-httpexception")
    expect(result.stdout).toContain("src/client/api.ts:1:1  warning  frontend/no-generated-edits")
    expect(result.stdout.trimEnd().endsWith("1 error, 1 warning")).toBe(true)
  })

  test("without flags only staged files are checked", async () => {
    const root = await createFixture()
    expect(await run(root)).toMatchObject({ code: 0, stdout: "no findings\n" })
    await writeFile(path.join(root, USERS), VIOLATION)
    expect((await run(root)).stdout).toBe("no findings\n")
    await git(root, "add", USERS)
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    // No baseline without --from-ref or --session: every finding is new.
    expect(lines(result.stdout)).toEqual([2, 3])
  })

  test("--files resolves paths relative to the current directory", async () => {
    const root = await createFixture()
    const result = await run(path.join(root, "src"), "--files", "client/api.ts", "--format", "json")
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "frontend/no-generated-edits",
    ])
  })

  test("--from-ref checks files changed since the merge base, classified against it", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    expect((await run(root, "--from-ref", "main")).stdout).toBe("no findings\n")

    await writeFile(path.join(root, USERS), VIOLATION)
    const uncommitted = await run(root, "--from-ref", "main", "--format", "json")
    expect(uncommitted.code).toBe(1)
    expect(lines(uncommitted.stdout)).toEqual([3])
    expect(JSON.parse(uncommitted.stdout).preexistingSummary).toEqual([
      { rule: "backend/no-httpexception", file: USERS, count: 1 },
    ])

    await git(root, "commit", "-qam", "change")
    expect(lines((await run(root, "--from-ref", "main", "--to-ref", "feature", "--format", "json")).stdout)).toEqual([
      3,
    ])
    expect((await run(root, "--from-ref", "main", "--to-ref", "main")).stdout).toBe("no findings\n")
  })

  test("--session verifies the session's edited files without deciding a stop", async () => {
    const root = await createFixture()
    expect((await run(root, "--session", "s1")).stdout).toBe("no findings\n")
    await writeFile(path.join(root, USERS), VIOLATION)
    await pipelineAt(root, { kind: "edit", files: [USERS], cwd: root, session: { id: "s1" } })

    const result = await run(root, "--session", "s1", "--format", "json")
    expect(result.code).toBe(1)
    expect(lines(result.stdout)).toEqual([3])
    expect(JSON.parse(result.stdout).stop).toBeNull()
    // The CLI run did not use up the agent's stop block.
    const stop = await pipelineAt(
      root,
      { kind: "verify", files: [], cwd: root, session: { id: "s1" } },
      { stopGate: true },
    )
    expect(stop.delivery.stop).toBe("block")
  })
})

describe("rulecast run: rules and errors", () => {
  test("RULE_ID runs only that rule", async () => {
    const root = await createFixture()
    const result = await run(root, "backend/no-httpexception", "--all-files", "--format", "json")
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "backend/no-httpexception",
    ])
    const unknown = await run(root, "nope", "--all-files")
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('no rule "nope" (see rulecast validate)')
  })

  test.each([
    [["--format", "xml"], 'unknown format "xml"'],
    [["--to-ref", "main"], "--to-ref needs --from-ref"],
    [["--all-files", "--files", "a.py"], "--all-files and --files cannot be combined"],
    [["--from-ref", "main", "--all-files"], "--from-ref cannot be combined with --all-files or --files"],
    [["--files"], "--files needs at least one file"],
    [["--ref", "v1"], "--ref only applies to try-repo"],
    [["a", "b"], "unexpected arguments: b"],
    [["--from-ref", "nope"], "nope"],
  ])("usage problems exit 2: %j", async (argv, message) => {
    const root = await createFixture()
    const result = await run(root, ...argv)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(message)
  })

  test("outside a project run fails", async () => {
    const root = await createProject({})
    const result = await run(root, "--all-files")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
  })
})
