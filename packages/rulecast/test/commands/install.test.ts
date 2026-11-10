import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import { HOOK_COMMAND, HOOK_SCRIPT, HOOK_SCRIPT_FILE } from "../../src/adapters/claude-code/hook-script"
import { hookConfigs, hooksInstalled } from "../../src/commands/install"
import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const SHARED = ".claude/settings.json"
const PERSONAL = ".claude/settings.local.json"
const WROTE = `wrote ${HOOK_SCRIPT_FILE}\n`
const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const settingsOf = async (root: string, file = SHARED) => JSON.parse(await read(root, file))
const repoConfig = (url: string) => `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    rules: []\n`

describe("rulecast install", () => {
  test("installs the Claude Code hooks in the shared settings and writes their script; a second run changes nothing", async () => {
    const root = await createFixture()
    const first = await runCli(root, ["install"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain("installed Claude Code hooks in .claude/settings.json: PreToolUse (Edit|Write)")
    expect(first.stdout).toContain(WROTE)
    expect(await read(root, HOOK_SCRIPT_FILE)).toBe(HOOK_SCRIPT)
    // Run as `sh <file>`: it needs no executable bit, and is not given one.
    expect((await stat(path.join(root, HOOK_SCRIPT_FILE))).mode & 0o777).toBe(0o644 & ~process.umask())
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

  test("settings current and the script missing: install writes the script alone", async () => {
    // Someone committed settings.json without the script: every hook exits 127 until it is back.
    const root = await createFixture()
    await runCli(root, ["install"])
    const before = await read(root, SHARED)
    await rm(path.join(root, HOOK_SCRIPT_FILE))
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0, stdout: WROTE })
    expect(await read(root, HOOK_SCRIPT_FILE)).toBe(HOOK_SCRIPT)
    expect(await read(root, SHARED)).toBe(before)
  })

  test("a hand-edited script is rewritten", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    await writeFile(path.join(root, HOOK_SCRIPT_FILE), `${HOOK_SCRIPT}echo edited\n`)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0, stdout: WROTE })
    expect(await read(root, HOOK_SCRIPT_FILE)).toBe(HOOK_SCRIPT)
  })

  test("--scope personal writes the script too", async () => {
    const root = await createFixture()
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain(WROTE)
    expect(await read(root, HOOK_SCRIPT_FILE)).toBe(HOOK_SCRIPT)
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

  test("writes the script command with or without the project's own rulecast, never a bare one", async () => {
    // A bare command exits 127 on every tool call where rulecast is not on the PATH: the plugin's
    // setup runs init through npx, so that was every first setup (plan 21, #1).
    const root = await createFixture()
    await runCli(root, ["install"])
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    expect((await settingsOf(local)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    expect(claudeCodeAdapter.install?.command).toBe(HOOK_COMMAND)
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

  test("hooks on an older command in both settings files: doctor says so, install upgrades and reports both", async () => {
    const OLD = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const local = await createProject({
      ".rulecast-config.yaml": "repos: []\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\necho 0.8.2\n",
    })
    await chmod(path.join(local, "node_modules/.bin/rulecast"), 0o755)
    await runCli(local, ["install"])
    const shared = await settingsOf(local)
    const personal = structuredClone(shared)
    for (const groups of Object.values(personal.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = OLD
    }
    await writeFile(path.join(local, PERSONAL), JSON.stringify(personal))

    // The shared file is current, so only the personal one needs naming.
    expect((await runCli(local, ["doctor"])).stdout).toContain(
      `${SHARED} — but the hooks in ${PERSONAL} are out of date; run rulecast install`,
    )
    const result = await runCli(local, ["install"])
    expect(result.stdout).toContain(`updated Claude Code hooks in ${PERSONAL}: `)
    expect((await settingsOf(local, PERSONAL)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
    expect((await runCli(local, ["doctor"])).stdout).not.toContain("out of date")
    expect((await runCli(local, ["install"])).stdout).toContain("already installed")

    // Both older: both named, in the order install will report them.
    const older = await settingsOf(local, PERSONAL)
    for (const groups of Object.values(older.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = OLD
    }
    await writeFile(path.join(local, SHARED), JSON.stringify(older))
    await writeFile(path.join(local, PERSONAL), JSON.stringify(older))
    expect((await runCli(local, ["doctor"])).stdout).toContain(
      `${SHARED} — but the hooks there and in ${PERSONAL} are out of date; run rulecast install`,
    )
    const both = await runCli(local, ["install"])
    expect(both.stdout).toContain(`updated Claude Code hooks in ${SHARED}: `)
    expect(both.stdout).toContain(`updated Claude Code hooks in ${PERSONAL}: `)
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

  test("a clone with committed settings and script prints already installed", async () => {
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    const clone = await createProject({
      ".rulecast-config.yaml": "repos: []\n",
      [SHARED]: await read(local, SHARED),
      [HOOK_SCRIPT_FILE]: await read(local, HOOK_SCRIPT_FILE),
    })
    expect((await runCli(clone, ["install"])).stdout).toBe(
      "Claude Code hooks already installed in .claude/settings.json\n",
    )
    expect((await settingsOf(clone)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
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

  test("hookConfigs with every config skipped sizes the hooks for the default verify_ms, not -Infinity", async () => {
    const top = await createRepo({ "pkg/.rulecast-config.yaml": "repos: [\n" })
    const skipped: string[] = []
    const reached = await hookConfigs(top, "doctor", undefined, (problem) => skipped.push(problem))
    expect(skipped).toHaveLength(1)
    expect(reached.verifyMs).toBe(60_000)
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

  test("removes the script, and .claude/hooks/ only when that empties it", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    const result = await runCli(root, ["uninstall"])
    expect(result.stdout).toContain(`removed ${HOOK_SCRIPT_FILE}\n`)
    expect(existsSync(path.join(root, HOOK_SCRIPT_FILE))).toBe(false)
    expect(existsSync(path.join(root, ".claude/hooks"))).toBe(false)

    await runCli(root, ["install"])
    await writeFile(path.join(root, ".claude/hooks/own.sh"), "echo own\n")
    await runCli(root, ["uninstall"])
    expect(existsSync(path.join(root, HOOK_SCRIPT_FILE))).toBe(false)
    expect(await read(root, ".claude/hooks/own.sh")).toBe("echo own\n")
  })

  test("a script left without hooks is removed too", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    await rm(path.join(root, SHARED))
    expect(await runCli(root, ["uninstall"])).toMatchObject({ code: 0, stdout: `removed ${HOOK_SCRIPT_FILE}\n` })
    expect(existsSync(path.join(root, HOOK_SCRIPT_FILE))).toBe(false)
  })
})
