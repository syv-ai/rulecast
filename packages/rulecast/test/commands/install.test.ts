import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter, HOOK_COMMAND } from "../../src/adapters/claude-code/adapter"
import { hooksInstalled } from "../../src/commands/install"
import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
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
    expect(first.stdout).toContain("installed Claude Code hooks in .claude/settings.json: PreToolUse (Edit|Write)")
    const settings = await settingsOf(root)
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
    ])
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: HOOK_COMMAND,
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

  test("writes the guarded command with or without the project's own rulecast, never the bare one", async () => {
    // The bare command exits 127 on every tool call where rulecast is not on the PATH: the plugin's
    // setup runs init through npx, so that was every first setup (plan 21, #1).
    const root = await createFixture()
    await runCli(root, ["install"])
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    expect((await settingsOf(local)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    expect(claudeCodeAdapter.install?.command(true)).toBe(HOOK_COMMAND)
  })

  test("re-running install upgrades rulecast's own hooks from an older command, and nothing else", async () => {
    const OLD = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    const settings = await settingsOf(local)
    for (const groups of Object.values(settings.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = OLD
    }
    settings.hooks.Stop.push({ hooks: [{ type: "command", command: "dash-hook stop" }] })
    await writeFile(path.join(local, ".claude/settings.json"), JSON.stringify(settings))
    expect((await runCli(local, ["doctor"])).stdout).toContain("the hooks are out of date; run rulecast install")
    const result = await runCli(local, ["install"])
    expect(result.stdout).toContain("updated Claude Code hooks in .claude/settings.json: ")
    const after = await settingsOf(local)
    expect(after.hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    expect(after.hooks.Stop[1].hooks[0].command).toBe("dash-hook stop")
    expect((await runCli(local, ["install"])).stdout).toContain("already installed")
  })

  test("re-running install adds the Bash hooks to an install from before them, in the same file", async () => {
    const root = await createFixture()
    await runCli(root, ["install", "--scope", "personal"])
    const settings = await settingsOf(root, PERSONAL)
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
      (group: { matcher: string }) => group.matcher !== "Bash",
    )
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      (group: { matcher: string }) => group.matcher !== "Bash",
    )
    delete settings.hooks.PostToolUseFailure
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
      (group: { matcher: string }) => group.matcher !== "clear|fork",
    )
    await writeFile(path.join(root, PERSONAL), JSON.stringify(settings))
    expect(await hooksInstalled(root, claudeCodeAdapter, 60_000)).toBe(PERSONAL)

    const result = await runCli(root, ["install"])
    expect(result.stdout).toBe(
      "installed Claude Code hooks in .claude/settings.local.json: PreToolUse (Bash), PostToolUse (Bash), PostToolUseFailure (Bash), SessionStart (clear|fork)\n",
    )
    // Upgraded where it was, not installed a second time in the shared file.
    expect(existsSync(path.join(root, SHARED))).toBe(false)
    expect((await settingsOf(root, PERSONAL)).hooks.PostToolUseFailure).toHaveLength(1)
    expect((await runCli(root, ["install"])).stdout).toContain("already installed")
  })

  test("a clone without node_modules keeps the committed guarded command", async () => {
    // The guarded form is right with or without the binary. Rewriting it to the bare command in a
    // clone before `npm install` would bring back the exit 127 on every hook that it exists to stop.
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    const committed = await settingsOf(local)
    const clone = await createProject({
      ".rulecast-config.yaml": "repos: []\n",
      ".claude/settings.json": JSON.stringify(committed),
    })
    expect((await runCli(clone, ["doctor"])).stdout).not.toContain("old command")
    expect((await runCli(clone, ["install"])).stdout).toContain("already installed")
    expect((await settingsOf(clone)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
  })

  test("a clone without node_modules upgrades a released guard to the current guard, not the bare command", async () => {
    const released =
      'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; ' +
      `grep -q '"hook_event_name": *"SessionStart"' && printf '%s' '{"systemMessage":"not installed"}'; exit 0`
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    const committed = JSON.parse(
      (await read(local, SHARED)).replaceAll(JSON.stringify(HOOK_COMMAND), JSON.stringify(released)),
    )
    const clone = await createProject({
      ".rulecast-config.yaml": "repos: []\n",
      ".claude/settings.json": JSON.stringify(committed),
    })
    expect((await runCli(clone, ["doctor"])).stdout).toContain("the hooks are out of date; run rulecast install")
    expect((await runCli(clone, ["install"])).code).toBe(0)
    const commands = Object.values(
      (await settingsOf(clone)).hooks as Record<string, { hooks: { command: string }[] }[]>,
    )
      .flat()
      .flatMap((group) => group.hooks.map((hook) => hook.command))
    expect(new Set(commands)).toEqual(new Set([HOOK_COMMAND]))
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

  test("doctor judges the hooks by every config they serve, as install sizes them", async () => {
    // doctor used its own config's verify_ms, install the largest of every config a session there
    // reaches: a package needing 300 s went unnoticed from the top (plan 21, #11).
    const top = await createRepo({ ".rulecast-config.yaml": "repos: []\n" })
    await runCli(top, ["install"])
    await mkdir(path.join(top, "backend"), { recursive: true })
    await writeFile(path.join(top, "backend/.rulecast-config.yaml"), "repos: []\ntimeouts:\n  verify_ms: 300000\n")
    expect((await runCli(top, ["doctor"])).stdout).toContain("the hooks are out of date; run rulecast install")
    await runCli(top, ["install"])
    expect((await runCli(top, ["doctor"])).stdout).not.toContain("out of date")
    expect((await settingsOf(top)).hooks.Stop[0].hooks[0].timeout).toBe(310)
  })

  test("raising verify_ms after install: doctor says the hooks are out of date, install raises the stop timeout", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\n" })
    await runCli(root, ["install"])
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].timeout).toBe(70)
    await writeFile(path.join(root, ".rulecast-config.yaml"), "repos: []\ntimeouts:\n  verify_ms: 300000\n")
    expect((await runCli(root, ["doctor"])).stdout).toContain("the hooks are out of date; run rulecast install")
    const result = await runCli(root, ["install"])
    expect(result.stdout).toContain("updated Claude Code hooks in .claude/settings.json: Stop, SubagentStop")
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].timeout).toBe(310)
    expect((await settingsOf(root)).hooks.SubagentStop[0].hooks[0].timeout).toBe(310)
  })

  test("in a directory with only a package config below it: settings here, its repos fetched, its verify_ms", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": "[]\n" } }])
    const top = await createRepo({
      "backend/.rulecast-config.yaml": `${repoConfig(url)}timeouts:\n  verify_ms: 300000\n`,
    })
    const result = await runCli(top, ["install"])
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("configs: backend/.rulecast-config.yaml\n")
    expect(result.stdout).toContain(`fetched ${repoLabel(url, "v1.0.0")}\n`)
    expect(existsSync(repoDir(TEST_HOME, url, "v1.0.0"))).toBe(true)
    expect((await settingsOf(top)).hooks.Stop[0].hooks[0].timeout).toBe(310)
    expect((await settingsOf(top)).hooks.SubagentStop[0].hooks[0].timeout).toBe(310)
    expect(existsSync(path.join(top, "backend", SHARED))).toBe(false)

    // doctor in the package names the config above and says the package's own settings have none.
    await writeFile(path.join(top, ".rulecast-config.yaml"), "repos: []\n")
    const doctor = await runCli(path.join(top, "backend"), ["doctor"])
    expect(doctor.stdout).toContain("other configs\n  ../.rulecast-config.yaml\n")
    expect(doctor.stdout).toMatch(/Claude Code — not installed/)
    expect((await runCli(top, ["doctor"])).stdout).toContain("other configs\n  backend/.rulecast-config.yaml\n")
  })

  test("another reachable config that does not load fails the install, naming it", async () => {
    const top = await createRepo({
      ".rulecast-config.yaml": "repos: []\n",
      "backend/.rulecast-config.yaml": "repos: 7\n",
    })
    const result = await runCli(top, ["install"])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("backend/.rulecast-config.yaml: ")
    expect(existsSync(path.join(top, SHARED))).toBe(false)
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
    // install created the personal file, so removing its hooks removes the file: no `{}` left behind.
    expect(existsSync(path.join(root, PERSONAL))).toBe(false)
    expect(await runCli(root, ["uninstall"])).toMatchObject({ code: 0, stdout: "no Claude Code hooks to remove\n" })
  })

  test("a settings file that held only rulecast's hooks is removed, not left as {}", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    await runCli(root, ["uninstall"])
    expect(existsSync(path.join(root, SHARED))).toBe(false)
  })
})
