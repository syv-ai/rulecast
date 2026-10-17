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
import { createRepo, git } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { createProject } from "../helpers/project"
import { ACCEPT, CANCEL, scriptedPrompter } from "../helpers/prompter"

let catalog: string
let env: Env

/** The catalog has no llm rule, so the consent tests add one. */
const LLM_RULE = `- id: fixture/thin-handlers
  name: Handlers stay thin
  description: A model judges whether a handler does more than parse input, call a service and return.
  files: (^|/)api/.*\\.py$
  severity: warning
  detect:
    llm:
      model: haiku
      question: Does this handler do more than parse input, call a service and return the result?
  message: "{{file}}:{{line}} {{reason}}"
`

beforeAll(async () => {
  catalog = await createCatalogRepo(LLM_RULE)
  env = { ...testEnv, RULECAST_CATALOG: catalog }
}, 30_000)

/** A Python project whose CLAUDE.md imports AGENTS.md (so Claude Code is detected). */
const PROJECT: Record<string, string> = {
  // Matches fixture/thin-handlers, an llm rule — so every assertion on PYTHON below is also an
  // assertion that an llm rule is never ticked for someone (spec §6, Consent).
  "app/api/users.py": "@router.get('/users')\ndef list_users():\n    return svc.list()\n",
  "AGENTS.md": "# Agents\n\n## Errors\n\nServices raise domain exceptions.\n",
  "CLAUDE.md": "@AGENTS.md\n",
}
const PYTHON = ["python/no-silent-except"]
const PROMPT =
  "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/CONVENTIONS.md\n" +
  "and follow it with me to work out this project's conventions, starting from AGENTS.md, then draft rulecast rules for them."

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const catalogEntry = (text: string) =>
  (parse(text) as { repos: { repo: string; rev?: string; rules: { id: string; context?: string[] }[] }[] }).repos[0]!
const ids = (text: string) =>
  catalogEntry(text)
    .rules.map((rule) => rule.id)
    .sort()

describe("rulecast init --yes", () => {
  test("configures the catalog rules that match the project and shared hooks", async () => {
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
    expect(result.stdout).toContain("rulecast validate: 1 rule valid")
    expect(result.stdout).toContain(PROMPT)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml and .claude/settings.json.")
    expect(result.copied).toEqual([])
  })

  test("a config above the repository is not taken for this project's", async () => {
    // A stray .rulecast-config.yaml in a parent directory (the home directory, a workspace folder)
    // used to make init edit that file instead of creating the repository's own.
    const outer = await createProject({ ".rulecast-config.yaml": "repos: []\n" })
    const root = path.join(outer, "repo")
    await mkdir(root)
    for (const [file, text] of Object.entries(PROJECT)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), text)
    }
    await git(root, "init", "-q")
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(true)
    expect(await read(outer, CONFIG_FILE)).toBe("repos: []\n")
  })

  test("says so when nothing in the catalog matches, rather than only 'no rules yet'", async () => {
    const root = await createRepo({ "src/index.ts": "export const x = 1\n", "AGENTS.md": "# Agents\n" })
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/Nothing in \S+@v0\.2\.0 matches this project's files\./)
    expect(result.stdout).toContain("new, no rules yet")
  })

  test("--yes never installs an llm rule, however well it matches", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["init", "--yes"], "", env)
    expect(ids(await read(root, CONFIG_FILE))).not.toContain("fixture/thin-handlers")
  })

  test("--rules installs an llm rule, because naming it is the consent", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init", "--rules", "fixture/thin-handlers", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(["fixture/thin-handlers"])
  })

  test("--yes never installs the loop-safety pack, and says how to add it", async () => {
    const root = await createRepo({ ...PROJECT, "tests/test_users.py": "def test_get():\n    assert get() is None\n" })
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(PYTHON)
    expect(result.stdout).toContain("For agents that run with nobody watching")
    expect(result.stdout).toContain("Add it with: rulecast init --rules loop-safety")
    // /goal and claude -p are not unattended by themselves: the note names the switch.
    expect(result.stdout).toContain("RULECAST_MODE=unattended")
    expect(result.stdout).not.toMatch(/watching: \/goal, claude -p/)
  })

  test("with part of the pack installed, the note says how many rules are missing", async () => {
    const root = await createRepo({ ...PROJECT, "tests/test_users.py": "def test_get():\n    assert get() is None\n" })
    await runCli(root, ["init", "--rules", "loop-safety/no-new-suppressions", "--yes"], "", env)
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      "10 of 11 loop-safety rules not installed. Add them with: rulecast init --rules loop-safety",
    )
    expect(result.stdout).not.toContain("Not installed.")
  })

  test("--rules loop-safety installs the whole pack, and it validates", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init", "--rules", "loop-safety", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual([
      "loop-safety/no-config-suppressions-js",
      "loop-safety/no-config-suppressions-python",
      "loop-safety/no-deleted-assertions-js",
      "loop-safety/no-deleted-assertions-python",
      "loop-safety/no-deleted-assertions-ts",
      "loop-safety/no-lowered-thresholds",
      "loop-safety/no-new-suppressions",
      "loop-safety/no-skipped-tests-js",
      "loop-safety/no-skipped-tests-python",
      "loop-safety/no-skipped-tests-ts",
      "loop-safety/protected-loop-config",
    ])
    expect(result.stdout).toContain("rulecast validate: 11 rules valid")
    expect(result.stdout).not.toContain("Add it with")
  })

  test("a config that is already unattended gets the pack's matching rules preselected", async () => {
    const root = await createRepo({
      ...PROJECT,
      "tests/test_users.py": "def test_get():\n    assert get() is None\n",
      ".rulecast-config.yaml": "mode: unattended\nrepos: []\n",
    })
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(
      [
        ...PYTHON,
        "loop-safety/no-deleted-assertions-python",
        "loop-safety/no-new-suppressions",
        "loop-safety/no-skipped-tests-python",
        // The config file it is written to is one of the pack's protected files.
        "loop-safety/protected-loop-config",
      ].sort(),
    )
  })

  test("re-running only adds rules, keeping the existing text and hooks", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["init", "--yes"], "", env)
    const before = `# our team's rulecast config\n${await read(root, CONFIG_FILE)}`
    await writeFile(path.join(root, CONFIG_FILE), before)
    await mkdir(path.join(root, "src/client"), { recursive: true })
    await writeFile(path.join(root, "src/client/sdk.gen.ts"), "export {}\n")

    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    const after = await read(root, CONFIG_FILE)
    expect(ids(after)).toEqual(["generated-code", ...PYTHON].sort())
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
    expect(result.stdout).toContain("starting from the project's docs,")
  })

  test("--no-rules writes only the local repo; with no agent detected, every adapter's hooks are installed", async () => {
    // Plan 10, A1: a project with only an AGENTS.md is the common case, and installing nothing
    // there was the one default that made rulecast do nothing at all.
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(root, ["init", "--no-rules", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(existsSync(path.join(root, ".claude", "settings.json"))).toBe(true)
  })

  test("--no-agents installs no hooks, and says what that means", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(root, ["init", "--no-rules", "--no-agents", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(existsSync(path.join(root, ".claude"))).toBe(false)
    // In the Review, where the developer decides, not in a step they have already passed.
    const review = result.stdout.indexOf("Review")
    expect(review).toBeGreaterThan(-1)
    expect(
      result.stdout.indexOf("No agent hooks: rulecast will not run in your agent until you run rulecast install"),
    ).toBeGreaterThan(review)
  })

  test("re-running init upgrades rulecast's own hooks from an older command", async () => {
    const OLD = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const root = await createRepo({ "app/services/users.py": "x = 1\n", "node_modules/.bin/rulecast": "" })
    await runCli(root, ["init", "--no-rules", "--agent", "claude-code", "--yes"], "", env)
    const file = path.join(root, ".claude", "settings.json")
    const settings = JSON.parse(await readFile(file, "utf8"))
    for (const groups of Object.values(settings.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = OLD
    }
    await writeFile(file, JSON.stringify(settings))

    const result = await runCli(root, ["init", "--no-rules", "--agent", "claude-code", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("~11 hooks updated (Claude Code)")
    const after = JSON.parse(await readFile(file, "utf8"))
    expect(after.hooks.Stop[0].hooks[0].command).not.toBe(OLD)
    expect(after.hooks.Stop).toHaveLength(1)
  })

  test("an unreachable catalog is skipped with a warning", async () => {
    const root = await createRepo(PROJECT)
    const missing = { ...testEnv, RULECAST_CATALOG: path.join(root, "missing.git") }
    const result = await runCli(root, ["init", "--yes"], "", missing)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Catalog unavailable")
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(result.stdout).toContain(`rulecast/v${VERSION}/agents/CONVENTIONS.md`)
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
      expect(result.stderr).toContain("rulecast init [--rules")
    }
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})

describe("rulecast init without a terminal", () => {
  test("prints the planned changes and exits 2 without --yes", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init"], "", env)
    expect(result.code).toBe(2)
    expect(result.stdout).toMatch(/\.rulecast-config\.yaml {2}new, 1 rule from .+@v0\.2\.0\n/)
    expect(result.stdout).toContain(".claude/settings.json  +11 hooks (Claude Code)")
    expect(result.stdout).toContain("Rerun with --yes")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
  })
})

describe("rulecast init in a terminal", () => {
  test("scripted answers: one rule pointed at the project's doc, personal hooks, prompt copied", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([["python/no-silent-except"], "@AGENTS.md#errors", ACCEPT, "personal", true, true])
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
    expect(rules!.values).toHaveLength(14)
    expect(conventions!.values).toEqual(["", "@AGENTS.md", "@AGENTS.md#agents", "@AGENTS.md#errors"])
    expect(catalogEntry(await read(root, CONFIG_FILE)).rules).toEqual([
      { id: "python/no-silent-except", context: ["@AGENTS.md#errors"] },
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
    expect(rules.values).toContain("fixture/thin-handlers")
    // It matches app/api/users.py, so only the consent rule keeps it out of the ticked set.
    expect(rules.initial as string[]).not.toContain("fixture/thin-handlers")
    const hint = (rules.hints as Record<string, string>)["fixture/thin-handlers"]!
    expect(hint).toContain("llm")
    expect(hint).toContain("haiku")
    expect(hint).toContain("sends")
  })

  test("the loop-safety pack is offered with its note, but never ticked", async () => {
    const root = await createRepo({ ...PROJECT, "tests/test_users.py": "def test_get():\n    assert get() is None\n" })
    const script = scriptedPrompter([[], ACCEPT, "personal", true, true])
    await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })

    const rules = script.asked[0]!
    expect(rules.values).toContain("loop-safety/no-skipped-tests-python")
    expect((rules.initial as string[]).filter((id) => id.startsWith("loop-safety/"))).toEqual([])
    expect(script.shown.some((text) => text.startsWith("Loop safety\nFor agents that run with nobody watching"))).toBe(
      true,
    )
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
    // Rules, one convention (one per preselected rule), agents, scope, then "Write?".
    const script = scriptedPrompter([ACCEPT, ACCEPT, ACCEPT, ACCEPT, false])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    expect(script.shown.at(-1)).toBe("Nothing written.")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})

describe("rulecast init defaults (plan 10, A1 and G6)", () => {
  test("with no agent marker, accepting every default installs hooks and maps the rule to the project's heading", async () => {
    const { "CLAUDE.md": _claude, ...noMarker } = PROJECT
    const root = await createRepo(noMarker)
    const script = scriptedPrompter([["python/no-silent-except"], ACCEPT, ACCEPT, ACCEPT, true, true])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    const [, conventions, agents] = script.asked
    expect(conventions!.initial).toBe("@AGENTS.md#errors")
    expect(agents!.initial).toEqual(["claude-code"])
    expect(catalogEntry(await read(root, CONFIG_FILE)).rules).toEqual([
      { id: "python/no-silent-except", context: ["@AGENTS.md#errors"] },
    ])
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(true)
  })
})

describe("rulecast init with the project's own hooks (plan 16)", () => {
  const HOOKS: Record<string, string> = {
    ...PROJECT,
    ".pre-commit-config.yaml":
      "repos:\n  - repo: local\n    hooks:\n      - id: types\n        name: types\n        entry: ./types.sh\n        language: system\n      - id: black\n        name: black\n        entry: black\n        language: system\n",
  }

  test("--yes adds the hooks that do not change files as hook rules, and they validate", async () => {
    const root = await createRepo(HOOKS)
    const result = await runCli(root, ["init", "--yes", "--no-rules"], "", env)
    expect(result.code).toBe(0)
    const config = parse(await read(root, CONFIG_FILE)) as { repos: { repo: string; rules: { id: string }[] }[] }
    const local = config.repos.find((repo) => repo.repo === "local")!
    expect(local.rules.map((rule) => rule.id)).toEqual(["hook/types"])
    expect(result.stdout).toContain("new, 1 hook rule")
    expect(result.stdout).toContain("rulecast validate: 1 rule valid")
  })

  test("in a terminal they are offered, formatters unticked, and --no-hooks skips them", async () => {
    const root = await createRepo(HOOKS)
    const script = scriptedPrompter([[], ACCEPT, ACCEPT, "shared", false])
    await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    const hooks = script.asked[1]!
    expect(hooks.message).toBe("Run your project's hooks as rules")
    expect(hooks.values).toEqual(["hook/types", "hook/black"])
    expect(hooks.initial).toEqual(["hook/types"])
    expect(hooks.hints["hook/black"]).toContain("changes files")

    const skipped = await createRepo(HOOKS)
    const plain = await runCli(skipped, ["init", "--yes", "--no-rules", "--no-hooks"], "", env)
    expect(plain.stdout).toContain("new, no rules yet")
  })
})
