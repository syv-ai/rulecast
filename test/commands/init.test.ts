import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { defaultConfig, loadConfig } from "../../src/core/compile/config"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

describe("rulecast init", () => {
  test("scaffolds a valid project and installs the hooks", async () => {
    const root = await createProject({})
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("created  .rulecast/config.yml")
    expect(result.stdout).toContain("created  .rulecast/rules/example.yml")
    expect(result.stdout).toContain("created  conventions/example.md")
    expect(result.stdout).toContain("installed Claude Code hooks in .claude/settings.json")
    expect(await runCli(root, ["validate"])).toMatchObject({ code: 0, stdout: "rulecast: 1 rule valid\n" })
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
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
    expect(await read(root, ".rulecast/.state/.gitignore")).toBe("*\n")
  })

  test("the scaffolded config spells out the defaults", async () => {
    const root = await createProject({})
    await runCli(root, ["init"])
    expect(await loadConfig(root)).toEqual({ ok: true, config: defaultConfig() })
  })

  test("keeps existing files and settings, and a second run changes nothing", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const root = await createProject({
      ".rulecast/config.yml": "timeouts:\n  verifyMs: 20000\n",
      ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [dash] }] } }),
    })
    const first = await runCli(root, ["init"])
    expect(first.stdout).toContain("exists   .rulecast/config.yml")
    expect(await read(root, ".rulecast/config.yml")).toBe("timeouts:\n  verifyMs: 20000\n")
    const installed = await read(root, ".claude/settings.json")
    expect(JSON.parse(installed).hooks.Stop).toEqual([
      { hooks: [dash] },
      { hooks: [{ type: "command", command: "rulecast hook claude-code", timeout: 30 }] },
    ])

    const second = await runCli(root, ["init"])
    expect(second.stdout).toContain("Claude Code hooks already installed in .claude/settings.json")
    expect(await read(root, ".claude/settings.json")).toBe(installed)
  })

  test("uses the project's own rulecast when it is installed", async () => {
    const root = await createProject({ "node_modules/.bin/rulecast": "" })
    await runCli(root, ["init"])
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
  })

  test("leaves unparseable settings alone", async () => {
    const root = await createProject({ ".claude/settings.json": "{ nope" })
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".claude/settings.json:")
    expect(await read(root, ".claude/settings.json")).toBe("{ nope")
  })
})
