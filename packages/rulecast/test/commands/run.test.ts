import { writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { NOTHING_STAGED } from "../../src/adapters/cli/format"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { createRepo, git } from "../helpers/git"
import { stubAgentCli, stubStdin } from "../helpers/llm"
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
    expect(result.stdout).toContain("checked all 4 files\nfindings: 1 error, 1 warning")
    // The backlog is what is left on screen: the count is the thing to act on. Its note about stock
    // and rate is for --summary, where someone asked about adoption.
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^\s+(app\/services\/users\.py|src\/client\/api\.ts)\s+1$/,
    )
    expect(result.stdout).toContain("backlog: 2 violations in 2 files")
    expect(result.stdout).not.toContain("This is the stock, not a rate.")
    expect((await run(root, "--all-files", "--summary")).stdout).toContain("This is the stock, not a rate.")
  })

  test("--summary prints the backlog alone, with the same exit code", async () => {
    const root = await createFixture()
    const summary = await run(root, "--all-files", "--summary")
    expect(summary.code).toBe(1)
    expect(summary.stdout).toContain("backlog: 2 violations in 2 files")
    expect(summary.stdout).not.toContain("app/services/users.py:2:5")
    expect(summary.code).toBe((await run(root, "--all-files")).code)
  })

  test("--summary works with any file selection and reports nothing when there is nothing", async () => {
    const root = await createFixture()
    expect(await run(root, "--summary")).toMatchObject({ code: 0, stdout: `${NOTHING_STAGED}\n` })
    expect(await run(root, "--all-files", "--summary")).toMatchObject({ code: 1 })
  })

  test("--summary with --format sarif is a usage error naming both", async () => {
    const root = await createFixture()
    const result = await run(root, "--all-files", "--summary", "--format", "sarif")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--summary cannot be combined with --format sarif")
  })

  test("--format json carries the backlog whatever flags were given", async () => {
    const root = await createFixture()
    const result = await run(root, "--all-files", "--format", "json")
    const parsed = JSON.parse(result.stdout)
    expect(parsed.backlog.totalViolations).toBe(2)
    expect(parsed.backlog.rules.map((entry: { rule: string }) => entry.rule).sort()).toEqual([
      "backend/no-httpexception",
      "frontend/no-generated-edits",
    ])
  })

  test("without flags only staged files are checked", async () => {
    const root = await createFixture()
    expect(await run(root)).toMatchObject({ code: 0, stdout: `${NOTHING_STAGED}\n` })
    await writeFile(path.join(root, USERS), VIOLATION)
    expect((await run(root)).stdout).toBe(`${NOTHING_STAGED}\n`)
    await git(root, "add", USERS)
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    // Judged against HEAD, as the agent hook judges against its baseline: line 2 was committed.
    expect(lines(result.stdout)).toEqual([3])
    expect(JSON.parse(result.stdout).preexistingSummary).toEqual([
      { rule: "backend/no-httpexception", file: USERS, count: 1 },
    ])
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
    expect((await run(root, "--from-ref", "main")).stdout).toBe("checked 0 changed files\nno findings\n")

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
    expect((await run(root, "--from-ref", "main", "--to-ref", "main")).stdout).toBe(
      "checked 0 changed files\nno findings\n",
    )
  })

  test("--session verifies the session's edited files without deciding a stop", async () => {
    const root = await createFixture()
    expect((await run(root, "--session", "s1")).stdout).toBe("checked the session's edited files\nno findings\n")
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

/**
 * The DX review's reproductions (plan 10, H1 and H2): a git hook must judge a commit as it will be
 * committed, against HEAD, and a push as it will be pushed.
 */
describe("rulecast run: staged and pushed content", () => {
  const OLD = "def get():\n    raise HTTPException(404)\n"

  test("a commit that touches a file with an old violation passes; the old line is backlog", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), `"""User service."""\n${OLD}`)
    await git(root, "add", USERS)
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings).toEqual([])
    expect(JSON.parse(result.stdout).preexistingSummary).toEqual([
      { rule: "backend/no-httpexception", file: USERS, count: 1 },
    ])
  })

  test("a violation staged and then fixed only in the working tree still fails the commit", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), `${OLD}    raise HTTPException(500)\n`)
    await git(root, "add", USERS)
    await writeFile(path.join(root, USERS), OLD)
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    expect(lines(result.stdout)).toEqual([3])
  })

  test("a clean staged file passes whatever the working tree holds", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), `${OLD}# a comment\n`)
    await git(root, "add", USERS)
    await writeFile(path.join(root, USERS), `${OLD}    raise HTTPException(500)\n`)
    expect((await run(root)).code).toBe(0)
  })

  test("--to-ref judges the commit, not uncommitted edits", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, USERS), `${OLD}# a comment\n`)
    await git(root, "commit", "-qam", "clean change")
    await writeFile(path.join(root, USERS), `${OLD}    raise HTTPException(500)\n`)
    const result = await run(root, "--from-ref", "main", "--to-ref", "HEAD", "--format", "json")
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings).toEqual([])
  })

  test("before the first commit there is no baseline: every finding is new", async () => {
    const root = await createProject(fixtureFiles)
    await git(root, "init", "-q", "-b", "main")
    await git(root, "add", "-A")
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    const users = JSON.parse(result.stdout).findings.filter((finding: { file: string }) => finding.file === USERS)
    expect(users.map((finding: { line: number; status: string }) => [finding.line, finding.status])).toEqual([
      [2, "new"],
    ])
  })

  test("a command rule is handed the staged content", async () => {
    const script = [
      'import { readFileSync } from "node:fs"',
      "const out = []",
      "for (const file of process.argv.slice(2)) {",
      '  readFileSync(file, "utf8").split("\\n").forEach((text, i) => {',
      '    if (text.includes("BAD")) out.push({ file, line: i + 1, text })',
      "  })",
      "}",
      "console.log(JSON.stringify(out))",
    ].join("\n")
    const rules = [
      {
        id: "scripts/no-bad",
        name: "No BAD",
        files: "^app/.*\\.py$",
        detect: { command: { run: ["node", "check.mjs", "{{files}}"], output: "json" } },
        message: "{{file}}:{{line}} says BAD.",
      },
    ]
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(rules),
      "check.mjs": script,
      "app/a.py": "ok\n",
    })
    await writeFile(path.join(root, "app/a.py"), "ok\nBAD\n")
    await git(root, "add", "app/a.py")
    await writeFile(path.join(root, "app/a.py"), "ok\n")
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    const findings = JSON.parse(result.stdout).findings
    expect(findings.map((finding: { file: string; line: number }) => [finding.file, finding.line])).toEqual([
      ["app/a.py", 2],
    ])
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

describe("rulecast run: metered rules in a staged run", () => {
  beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
  afterEach(() => vi.unstubAllEnvs())

  const LLM_RULES = [
    {
      id: "py/thin",
      name: "Thin routes",
      files: "^app/",
      detect: { llm: { model: "haiku", question: "Does this do too much?" } },
      message: "{{file}}:{{line}} does too much. {{reason}}",
    },
  ]

  async function staged() {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig(LLM_RULES), "app/a.py": "x = 1\n" })
    await stubAgentCli(root, "claude")
    await writeFile(path.join(root, "app/a.py"), "x = 2\n")
    await git(root, "add", "app/a.py")
    return root
  }

  test("a staged run skips them and says which, and how to include them", async () => {
    const root = await staged()
    const result = await run(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("skipped 1 metered rule (py/thin): costs money per file. Pass --llm to include it.")
    expect(await stubStdin(root, "claude")).toEqual([])
    expect(JSON.parse((await run(root, "--format", "json")).stdout).skipped).toEqual(["py/thin"])
  })

  test("--llm includes them", async () => {
    const root = await staged()
    const result = await run(root, "--llm")
    expect(result.stdout).not.toContain("skipped")
    expect(await stubStdin(root, "claude")).toHaveLength(1)
  })

  test("other selections run them, and --no-llm skips them anywhere", async () => {
    const root = await staged()
    await run(root, "--all-files")
    expect(await stubStdin(root, "claude")).toHaveLength(1)
    const skipped = await run(root, "--all-files", "--no-llm")
    expect(skipped.stdout).toContain("skipped 1 metered rule (py/thin)")
    expect(await stubStdin(root, "claude")).toHaveLength(1)
  })

  test("--llm with --no-llm is a usage error", async () => {
    const root = await staged()
    const result = await run(root, "--llm", "--no-llm")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--llm and --no-llm cannot be combined")
  })
})
