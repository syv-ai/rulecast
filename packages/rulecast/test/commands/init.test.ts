import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import type { InitReport } from "../../src/commands/init"
import { CONFIG_FILE } from "../../src/core/config/load"
import { runCli } from "../helpers/cli"
import { createRepo, git } from "../helpers/git"
import { createProject } from "../helpers/project"

/** A Python project whose CLAUDE.md imports AGENTS.md (so Claude Code is detected). */
const PROJECT: Record<string, string> = {
  "app/api/users.py": "@router.get('/users')\ndef list_users():\n    return svc.list()\n",
  "AGENTS.md": "# Agents\n\n## Errors\n\nServices raise domain exceptions.\n",
  "CLAUDE.md": "@AGENTS.md\n",
}

const HOOKS: Record<string, string> = {
  ...PROJECT,
  ".pre-commit-config.yaml":
    "repos:\n  - repo: local\n    hooks:\n      - id: types\n        name: types\n        entry: ./types.sh\n        language: system\n      - id: black\n        name: black\n        entry: black\n        language: system\n",
}

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const init = (cwd: string, ...args: string[]) => runCli(cwd, ["init", ...args])
const report = async (cwd: string, ...args: string[]) => {
  const result = await init(cwd, ...args, "--format", "json")
  expect(result.stderr).toBe("")
  return { code: result.code, report: JSON.parse(result.stdout) as InitReport }
}
const localIds = (text: string) =>
  (parse(text) as { repos: { repo: string; rules: { id: string }[] }[] }).repos
    .find((repo) => repo.repo === "local")!
    .rules.map((rule) => rule.id)

describe("rulecast init", () => {
  test("writes a config and shared hooks at once, validates them and says what to commit", async () => {
    const root = await createRepo(PROJECT)
    const result = await init(root)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("rulecast hook claude-code")
    expect(result.stdout).toContain("python · AGENTS.md (imported by CLAUDE.md) · Claude Code (CLAUDE.md)")
    expect(result.stdout).toContain("rulecast validate: 0 rules valid")
    expect(result.stdout).toContain("Commit .rulecast-config.yaml and .claude/settings.json.")
  })

  test("the interview's answers become the config's settings", async () => {
    const root = await createRepo(PROJECT)
    const result = await init(root, "--llm-model", "haiku", "--conventions", "docs/conventions/")
    expect(result.code).toBe(0)
    expect(parse(await read(root, CONFIG_FILE))).toEqual({
      conventions: "docs/conventions/",
      llm: { model: "haiku" },
      repos: [{ repo: "local", rules: [] }],
    })
    // The folder does not exist yet: said, not refused.
    expect(result.stdout).toContain("conventions: docs/conventions/ does not exist yet")
  })

  test("on an existing config, settings are added and its comments and other keys kept", async () => {
    const text = "# ours\nllm:\n  provider: opencode # keep\nrepos:\n  - repo: local\n    rules: []\n"
    const root = await createRepo({ ...PROJECT, [CONFIG_FILE]: text })
    const result = await init(root, "--llm-model", "haiku", "--conventions", "docs/c.md")
    expect(result.code).toBe(0)
    const after = await read(root, CONFIG_FILE)
    expect(after).toContain("# ours")
    expect(after).toContain("provider: opencode # keep")
    expect(parse(after)).toMatchObject({ llm: { provider: "opencode", model: "haiku" }, conventions: "docs/c.md" })
  })

  test("--dry-run writes nothing, and its planned content is exactly what a real run writes", async () => {
    const root = await createRepo(HOOKS)
    const args = ["--hooks", "hook/types", "--llm-model", "haiku", "--conventions", "docs/conventions/"]
    const dry = await report(root, ...args, "--dry-run")
    expect(dry.code).toBe(0)
    expect(dry.report.written).toBe(false)
    expect(dry.report.validate).toBeNull()
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
    expect(existsSync(path.join(root, ".claude"))).toBe(false)

    const real = await report(root, ...args)
    expect(real.code).toBe(0)
    expect(real.report.written).toBe(true)
    expect(real.report.validate!.errors).toBe(0)
    for (const change of dry.report.changes) expect(await read(root, change.file)).toBe(change.content)
    expect(dry.report.changes.map((change) => change.file)).toEqual([CONFIG_FILE, ".claude/settings.json"])
  })

  test("the JSON report says what init found, for the agent's interview", async () => {
    const root = await createRepo({ ...HOOKS, [CONFIG_FILE]: "conventions: docs/c.md\nrepos: []\n" })
    const { report: found } = await report(root, "--dry-run")
    expect(found.detected.stack).toContain("python")
    expect(found.detected.docs[0]).toEqual({ file: "AGENTS.md", headings: ["Agents", "Errors"] })
    expect(found.detected.agents).toContainEqual({ name: "claude-code", label: "Claude Code", supported: true })
    expect(found.hooks.offered.map((hook) => [hook.id, hook.modifies])).toEqual([
      ["hook/types", false],
      ["hook/black", true],
    ])
    expect(found.config).toEqual({
      exists: true,
      conventions: { path: "docs/c.md", from: CONFIG_FILE },
      llm: { model: null, provider: "claude-code" },
    })
  })

  test("--hooks wraps only the hooks it names, and they validate", async () => {
    const root = await createRepo(HOOKS)
    const result = await init(root, "--hooks", "hook/types")
    expect(result.code).toBe(0)
    expect(localIds(await read(root, CONFIG_FILE))).toEqual(["hook/types"])
    expect(result.stdout).toContain("new, 1 hook rule")
    expect(result.stdout).toContain("rulecast validate: 1 rule valid")
  })

  test("without --hooks no hook is wrapped, and the terminal output names the ones on offer", async () => {
    const root = await createRepo(HOOKS)
    const result = await init(root, "--dry-run")
    expect(result.stdout).toContain("Offered as rules with --hooks: hook/types, hook/black (changes files)")
    expect(result.stdout).toContain("Nothing written (--dry-run).")
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
    const result = await init(root)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(true)
    expect(await read(outer, CONFIG_FILE)).toBe("repos: []\n")
  })

  test("in a package of a repository with a top config, creates the package's own config and hooks there", async () => {
    const top = await createRepo({ ...PROJECT, ".rulecast-config.yaml": "repos: []\n", "backend/app.py": "x = 1\n" })
    const backend = path.join(top, "backend")
    const result = await init(backend)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(existsSync(path.join(backend, CONFIG_FILE))).toBe(true)
    expect(existsSync(path.join(backend, ".claude/settings.json"))).toBe(true)
    expect(await read(top, CONFIG_FILE)).toBe("repos: []\n")
    expect(existsSync(path.join(top, ".claude/settings.json"))).toBe(false)
  })

  test("at the top of a repository with a package config, the Stop timeout covers the package's larger verify_ms", async () => {
    const top = await createRepo({
      ...PROJECT,
      "backend/.rulecast-config.yaml": "repos: []\ntimeouts:\n  verify_ms: 300000\n",
    })
    const result = await init(top)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    const settings = JSON.parse(await read(top, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(310)
    expect(settings.hooks.SubagentStop[0].hooks[0].timeout).toBe(310)
  })

  test("another config that does not load is warned about and left out of the hooks' timeout", async () => {
    const top = await createRepo({
      ...PROJECT,
      "backend/.rulecast-config.yaml": "repos: 7\ntimeouts:\n  verify_ms: 300000\n",
    })
    const result = await init(top)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("backend/.rulecast-config.yaml: ")
    expect(result.stdout).toContain("Left out of the hooks' timeout and repo fetch.")
    const settings = JSON.parse(await read(top, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(70)
  })

  test("--agent and --scope choose the hooks; with no agent detected, every adapter's are installed", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await init(root, "--agent", "claude-code", "--scope", "personal")
    expect(result.code).toBe(0)
    expect(existsSync(path.join(root, ".claude/settings.local.json"))).toBe(true)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml.")

    // Plan 10, A1: a project with only an AGENTS.md is the common case, and installing nothing
    // there was the one default that made rulecast do nothing at all.
    const bare = await createRepo({ "app/services/users.py": "x = 1\n" })
    expect((await init(bare)).code).toBe(0)
    expect(existsSync(path.join(bare, ".claude", "settings.json"))).toBe(true)
  })

  test("--no-agents installs no hooks, and says what that means", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await init(root, "--no-agents")
    expect(result.code).toBe(0)
    expect(existsSync(path.join(root, ".claude"))).toBe(false)
    expect(result.stdout).toContain(
      "No agent hooks: rulecast will not run in your agent until you run rulecast install",
    )
  })

  test("re-running changes nothing that is there, and upgrades rulecast's own hooks from an older command", async () => {
    const OLD = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const root = await createRepo({ "app/services/users.py": "x = 1\n", "node_modules/.bin/rulecast": "" })
    await init(root, "--agent", "claude-code", "--llm-model", "haiku")
    const config = await read(root, CONFIG_FILE)
    expect((await report(root, "--agent", "claude-code", "--llm-model", "haiku", "--dry-run")).report.changes).toEqual(
      [],
    )

    const file = path.join(root, ".claude", "settings.json")
    const settings = JSON.parse(await readFile(file, "utf8"))
    for (const groups of Object.values(settings.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = OLD
    }
    await writeFile(file, JSON.stringify(settings))
    const result = await init(root, "--agent", "claude-code")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("~11 hooks updated (Claude Code)")
    const after = JSON.parse(await readFile(file, "utf8"))
    expect(after.hooks.Stop[0].hooks[0].command).not.toBe(OLD)
    expect(after.hooks.Stop).toHaveLength(1)
    expect(await read(root, CONFIG_FILE)).toBe(config)
  })

  test("in a package, the hooks are read at the git top; the ones not offered are named with why", async () => {
    const top = await createRepo({
      ...PROJECT,
      "lefthook.yml":
        "pre-commit:\n  jobs:\n    - name: lint\n      glob: '{a,b}/*.py'\n      run: ruff check\n    - name: web\n      root: frontend/\n      run: eslint\n    - name: pytest\n      root: backend/\n      glob: '*.py'\n      run: pytest\n",
      "backend/app.py": "x = 1\n",
    })
    const backend = path.join(top, "backend")
    const result = await init(backend, "--hooks", "hook/pre-commit-pytest")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      "Not offered from ../lefthook.yml: lint (glob {a,b}/*.py can't be rebased onto backend)",
    )
    expect(result.stdout).toContain("Not offered from ../lefthook.yml: web (runs outside backend)")
    expect(result.stdout).toContain("1 hook rule cites no doc section: its config is outside this project.")
    const config = parse(await read(backend, CONFIG_FILE)) as {
      repos: { repo: string; rules: { id: string; files?: string; description?: string }[] }[]
    }
    const local = config.repos.find((repo) => repo.repo === "local")!
    expect(local.rules.map((rule) => [rule.id, rule.files, rule.description])).toEqual([
      [
        "hook/pre-commit-pytest",
        "^.*\\.py$",
        "Runs the lefthook job pytest from ../lefthook.yml. No doc section: the config is outside this project.",
      ],
    ])
    expect(result.stdout).toContain("rulecast validate: 1 rule valid")
  })

  test("unknown agents, scopes, hooks, providers and formats are usage errors that write nothing", async () => {
    const root = await createRepo(HOOKS)
    for (const args of [
      ["--agent", "vim"],
      ["--scope", "team"],
      ["--hooks", "hook/nope"],
      ["--llm-provider", "gemini"],
      ["--format", "yaml"],
      ["--conventions", "/abs/docs"],
      ["--agent", "claude-code", "--no-agents"],
      ["--yes"],
      ["--rules", "generated-code"],
    ]) {
      const result = await init(root, ...args)
      expect(result.code, args.join(" ")).toBe(2)
      expect(result.stderr).toContain("rulecast init [--agent")
    }
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})
