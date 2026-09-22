import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"
import { parse } from "yaml"

import { CONFIG_FILE } from "../../src/core/config/load"
import type { Env } from "../../src/core/home"
import { VERSION } from "../../src/core/version"
import { createCatalogRepo } from "../helpers/catalog"
import { runCli } from "../helpers/cli"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { ACCEPT, CANCEL, scriptedPrompter } from "../helpers/prompter"

let catalog: string
let env: Env

beforeAll(async () => {
  catalog = await createCatalogRepo()
  env = { ...testEnv, RULECAST_CATALOG: catalog }
}, 30_000)

/** A Python project whose CLAUDE.md imports AGENTS.md (so Claude Code is detected). */
const PROJECT: Record<string, string> = {
  "app/services/users.py": "def get():\n    return None\n",
  // Matches python/thin-routes, the catalog's one llm rule — so every assertion on PYTHON below
  // is also an assertion that an llm rule is never ticked for someone (spec §6, Consent).
  "app/api/users.py": "@router.get('/users')\ndef list_users():\n    return svc.list()\n",
  "AGENTS.md": "# Agents\n\n## Errors\n\nServices raise domain exceptions.\n",
  "CLAUDE.md": "@AGENTS.md\n",
}
const PYTHON = [
  "python/layering",
  "python/no-httpexception-in-services",
  "python/no-queries-in-services",
  "python/no-silent-except",
]
const PROMPT =
  "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md\n" +
  "and follow it to draft rulecast rules for this project from AGENTS.md."

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const catalogEntry = (text: string) =>
  (parse(text) as { repos: { repo: string; rev?: string; rules: { id: string; context?: string[] }[] }[] }).repos[0]!
const ids = (text: string) =>
  catalogEntry(text)
    .rules.map((rule) => rule.id)
    .sort()

describe("rulecast init --yes", () => {
  test("configures the catalog rules that apply to the project and shared hooks", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    const config = await read(root, CONFIG_FILE)
    expect(catalogEntry(config)).toMatchObject({ repo: catalog, rev: "v0.2.0" })
    expect(ids(config)).toEqual(PYTHON)
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("rulecast hook claude-code")
    expect(result.stdout).toContain("python · AGENTS.md (imported by CLAUDE.md) · Claude Code (CLAUDE.md)")
    expect(result.stdout).toContain("rulecast validate: 4 rules valid")
    expect(result.stdout).toContain(PROMPT)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml and .claude/settings.json.")
    expect(result.copied).toEqual([])
  })

  test("--yes never installs an llm rule, however well it matches", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["init", "--yes"], "", env)
    expect(ids(await read(root, CONFIG_FILE))).not.toContain("python/thin-routes")
  })

  test("--rules installs an llm rule, because naming it is the consent", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init", "--rules", "python/thin-routes", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(["python/thin-routes"])
  })

  test("re-running only adds rules, keeping the existing text and hooks", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["init", "--yes"], "", env)
    const before = `# our team's rulecast config\n${await read(root, CONFIG_FILE)}`
    await writeFile(path.join(root, CONFIG_FILE), before)
    await mkdir(path.join(root, "src/components"), { recursive: true })
    await writeFile(path.join(root, "src/components/Card.tsx"), "export const Card = () => fetch('/api')\n")

    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    const after = await read(root, CONFIG_FILE)
    expect(ids(after)).toEqual(
      [...PYTHON, "react/data-fetching", "react/no-fetch-in-components", "react/no-inline-style"].sort(),
    )
    const local = before.indexOf("  - repo: local")
    expect(after.startsWith(before.slice(0, local))).toBe(true)
    expect(after.endsWith(before.slice(local))).toBe(true)
    expect(result.stdout).not.toContain("hooks (Claude Code)")
  })

  test("flags choose the rules, the agent and the scope", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(
      root,
      ["init", "--rules", "generated-code", "--agent", "claude-code", "--scope", "personal", "--yes"],
      "",
      env,
    )
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(["generated-code"])
    expect(existsSync(path.join(root, ".claude/settings.local.json"))).toBe(true)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml.")
    expect(result.stdout).toContain("from the project's docs.")
  })

  test("--no-rules writes only the local repo; no detected agent installs no hooks", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(root, ["init", "--no-rules", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(existsSync(path.join(root, ".claude"))).toBe(false)
    expect(result.stdout).toContain("No agent hooks will be installed.")
  })

  test("an unreachable catalog is skipped with a warning", async () => {
    const root = await createRepo(PROJECT)
    const missing = { ...testEnv, RULECAST_CATALOG: path.join(root, "missing.git") }
    const result = await runCli(root, ["init", "--yes"], "", missing)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Catalog unavailable")
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(result.stdout).toContain(`rulecast/v${VERSION}/agents/DRAFT-RULES.md`)
  })

  test("unknown rules, agents and scopes are usage errors that write nothing", async () => {
    const root = await createRepo(PROJECT)
    for (const args of [
      ["--rules", "nope/x"],
      ["--agent", "vim"],
      ["--scope", "team"],
      ["--rules", "a", "--no-rules"],
    ]) {
      const result = await runCli(root, ["init", ...args, "--yes"], "", env)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("usage:")
    }
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})

describe("rulecast init without a terminal", () => {
  test("prints the planned changes and exits 2 without --yes", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init"], "", env)
    expect(result.code).toBe(2)
    expect(result.stdout).toMatch(/\.rulecast-config\.yaml {2}new, 4 rules from .+@v0\.2\.0\n/)
    expect(result.stdout).toContain(".claude/settings.json  +6 hooks (Claude Code)")
    expect(result.stdout).toContain("Rerun with --yes")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
  })
})

describe("rulecast init in a terminal", () => {
  test("scripted answers: one rule pointed at the project's doc, personal hooks, prompt copied", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([
      ["python/no-httpexception-in-services"],
      "@AGENTS.md#errors",
      ACCEPT,
      "personal",
      true,
      true,
    ])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    expect(script.asked.map((prompt) => prompt.kind)).toEqual([
      "groupMultiselect",
      "select",
      "multiselect",
      "select",
      "confirm",
      "confirm",
    ])
    const [rules, conventions] = script.asked
    expect([...(rules!.initial as string[])].sort()).toEqual(PYTHON)
    expect(rules!.values).toHaveLength(9)
    expect(conventions!.values).toEqual(["", "@AGENTS.md", "@AGENTS.md#agents", "@AGENTS.md#errors"])
    expect(catalogEntry(await read(root, CONFIG_FILE)).rules).toEqual([
      { id: "python/no-httpexception-in-services", context: ["@AGENTS.md#errors"] },
    ])
    expect(existsSync(path.join(root, ".claude/settings.local.json"))).toBe(true)
    expect(result.copied).toEqual([PROMPT])
    expect(script.shown.at(-1)).toBe("Commit .rulecast-config.yaml.")
  })

  test("an llm rule is offered with its cost in the hint, but never ticked", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([[], ACCEPT, "personal", true, true])
    await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })

    const rules = script.asked[0]!
    expect(rules.values).toContain("python/thin-routes")
    // It matches app/api/users.py, so only the consent rule keeps it out of the ticked set.
    expect(rules.initial as string[]).not.toContain("python/thin-routes")
    const hint = (rules.hints as Record<string, string>)["python/thin-routes"]!
    expect(hint).toContain("llm")
    expect(hint).toContain("haiku")
    expect(hint).toContain("sends")
  })

  test("Ctrl+C exits 130 and writes nothing", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([CANCEL])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(130)
    expect(result.stderr).toBe("rulecast: init cancelled\n")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })

  test("declining the review writes nothing", async () => {
    const root = await createRepo(PROJECT)
    // Rules, four conventions (one per preselected rule), agents, scope, then "Write?".
    const script = scriptedPrompter([ACCEPT, ACCEPT, ACCEPT, ACCEPT, ACCEPT, ACCEPT, ACCEPT, false])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    expect(script.shown.at(-1)).toBe("Nothing written.")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})
