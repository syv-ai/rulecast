import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import { hooksInstalled } from "../../src/commands/install"
import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { TEST_HOME } from "../helpers/home"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const SHARED = ".claude/settings.json"
const PERSONAL = ".claude/settings.local.json"
const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const settingsOf = async (root: string, file = SHARED) => JSON.parse(await read(root, file))
const repoConfig = (url: string) => `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    rules: []\n`

describe("rulecast install", () => {
  test("installs the Claude Code hooks in the shared settings; a second run changes nothing", async () => {
    const root = await createFixture()
    const first = await runCli(root, ["install"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain("installed Claude Code hooks in .claude/settings.json: PostToolUse (Read)")
    const settings = await settingsOf(root)
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
    ])
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "rulecast hook claude-code",
      timeout: 70,
    })

    const before = await read(root, SHARED)
    expect(await runCli(root, ["install"])).toMatchObject({
      code: 0,
      stdout: "Claude Code hooks already installed in .claude/settings.json\n",
    })
    expect(await read(root, SHARED)).toBe(before)
  })

  test("--scope personal writes the personal settings, and hooks there count as installed", async () => {
    const root = await createFixture()
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain(
      "installed Claude Code hooks in .claude/settings.local.json",
    )
    expect((await runCli(root, ["install"])).stdout).toBe(
      "Claude Code hooks already installed in .claude/settings.local.json\n",
    )
    expect(existsSync(path.join(root, SHARED))).toBe(false)
  })

  test("uses the project's own rulecast when it is installed", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].command).toBe("rulecast hook claude-code")
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    expect((await settingsOf(local)).hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
    expect(claudeCodeAdapter.install?.command(true)).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
  })

  test("fetches rule repos missing from the cache", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": "[]\n" } }])
    const root = await createProject({ ".rulecast-config.yaml": repoConfig(url) })
    const first = await runCli(root, ["install"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain(`fetched ${repoLabel(url, "v1.0.0")}\n`)
    expect(existsSync(repoDir(TEST_HOME, url, "v1.0.0"))).toBe(true)
    expect((await runCli(root, ["install"])).stdout).not.toContain("fetched")
  })

  test("a repo that cannot be fetched fails the run after the hooks are installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": repoConfig("/nonexistent/rules.git") })
    const result = await runCli(root, ["install"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(`could not fetch ${repoLabel("/nonexistent/rules.git", "v1.0.0")}`)
    expect(existsSync(path.join(root, SHARED))).toBe(true)
  })

  test("errors: unparseable settings, unknown agents and scopes, no project", async () => {
    const root = await createFixture()
    const broken = await createProject({ ".rulecast-config.yaml": "repos: []\n", [SHARED]: "{ nope" })
    const unparseable = await runCli(broken, ["install"])
    expect(unparseable.code).toBe(2)
    expect(unparseable.stderr).toContain(".claude/settings.json:")
    expect(await read(broken, SHARED)).toBe("{ nope")

    const agent = await runCli(root, ["install", "--agent", "cursor"])
    expect(agent.code).toBe(2)
    expect(agent.stderr).toContain('unknown agent "cursor" (use claude-code)')
    const scope = await runCli(root, ["install", "--scope", "team"])
    expect(scope.code).toBe(2)
    expect(scope.stderr).toContain('unknown scope "team" (use shared, personal)')
    const outside = await runCli(await createProject({}), ["install"])
    expect(outside.code).toBe(2)
    expect(outside.stderr).toContain("no .rulecast-config.yaml in")
  })
})

describe("hooksInstalled", () => {
  const installed = (root: string) => hooksInstalled(root, claudeCodeAdapter, 30_000)

  test("null when the project has no settings file at all", async () => {
    expect(await installed(await createFixture())).toBeNull()
  })

  test("null when a settings file exists but holds other hooks", async () => {
    const root = await createFixture()
    await mkdir(path.join(root, ".claude"), { recursive: true })
    await writeFile(
      path.join(root, SHARED),
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "true" }] }] } }),
    )
    expect(await installed(root)).toBeNull()
  })

  test("the file the hooks are in, once install has run", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    expect(await installed(root)).toBe(SHARED)
  })

  test("a hook counts wherever it is: personal hooks satisfy a shared question", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["install", "--scope", "personal"])).toMatchObject({ code: 0 })
    expect(existsSync(path.join(root, SHARED))).toBe(false)
    expect(await installed(root)).toBe(PERSONAL)
  })
})

describe("rulecast uninstall", () => {
  test("removes only what install added", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const original = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [dash] }] } }
    const root = await createFixture()
    // Hooks in both files: install into personal, hide it while installing into shared, then put it back.
    await runCli(root, ["install", "--scope", "personal"])
    const personal = await read(root, PERSONAL)
    await writeFile(path.join(root, PERSONAL), "{}")
    await writeFile(path.join(root, SHARED), JSON.stringify(original))
    await runCli(root, ["install", "--scope", "shared"])
    await writeFile(path.join(root, PERSONAL), personal)

    const result = await runCli(root, ["uninstall"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("removed Claude Code hooks from .claude/settings.json: ")
    expect(result.stdout).toContain("removed Claude Code hooks from .claude/settings.local.json: ")
    expect(await settingsOf(root)).toEqual(original)
    expect(await settingsOf(root, PERSONAL)).toEqual({})
    expect(await runCli(root, ["uninstall"])).toMatchObject({ code: 0, stdout: "no Claude Code hooks to remove\n" })
  })
})
