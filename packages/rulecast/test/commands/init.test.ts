import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { parseConfig, readConfigData } from "../../src/core/config/load"
import { defaultConfig } from "../../src/core/config/schema"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

describe("rulecast init", () => {
  test("writes a config with an empty local repo and installs the hooks", async () => {
    const root = await createProject({})
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("created  .rulecast-config.yaml")
    expect(result.stdout).toContain("installed Claude Code hooks in .claude/settings.json")
    expect(result.stdout).toContain("next: add rules to .rulecast-config.yaml, then run rulecast validate")
    expect(await runCli(root, ["validate"])).toMatchObject({
      code: 0,
      stdout: ".rulecast-config.yaml: 0 rules valid\n",
    })
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
  })

  test("the written config holds an empty local repo and default settings", async () => {
    const root = await createProject({})
    await runCli(root, ["init"])
    const data = await readConfigData(root)
    expect(data.ok && parseConfig(data.value)).toEqual({
      ok: true,
      value: { ...defaultConfig(), repos: [{ repo: "local", rules: [] }] },
    })
  })

  test("keeps existing files and settings, and a second run changes nothing", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const config = "repos: []\ntimeouts:\n  verify_ms: 20000\n"
    const root = await createProject({
      ".rulecast-config.yaml": config,
      ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [dash] }] } }),
    })
    const first = await runCli(root, ["init"])
    expect(first.stdout).toContain("exists   .rulecast-config.yaml")
    expect(await read(root, ".rulecast-config.yaml")).toBe(config)
    const installed = await read(root, ".claude/settings.json")
    expect(JSON.parse(installed).hooks.Stop).toEqual([
      { hooks: [dash] },
      { hooks: [{ type: "command", command: "rulecast hook claude-code", timeout: 30 }] },
    ])

    const second = await runCli(root, ["init"])
    expect(second.stdout).toContain("Claude Code hooks already installed in .claude/settings.json")
    expect(await read(root, ".claude/settings.json")).toBe(installed)
  })

  test("an invalid config is reported and nothing is installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\nmaxMatchesPerRule: 3\n" })
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".rulecast-config.yaml: ")
    expect(result.stderr).toContain("(fix it, then run rulecast init again)")
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

  test("hooks installed in the personal settings count as installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\n" })
    expect((await runCli(root, ["install", "--scope", "personal"])).code).toBe(0)
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Claude Code hooks already installed in .claude/settings.local.json")
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
  })
})
