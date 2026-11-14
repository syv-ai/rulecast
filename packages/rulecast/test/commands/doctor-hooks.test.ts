import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import { HOOK_COMMAND } from "../../src/adapters/claude-code/hook-script"
import { agentHookChecks } from "../../src/commands/doctor-hooks"
import { installHooks } from "../../src/commands/install"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { createRuleRepo } from "../helpers/rule-repo"

const CONFIG = "repos: []\n"
const checks = (dir: string, guardRoots: string[] = []) => agentHookChecks(dir, claudeCodeAdapter, 60_000, guardRoots)

describe("doctor: the write guard (R8)", () => {
  test("a config with a refuse_write rule and no hook before an edit is an error naming rulecast install", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": CONFIG })
    await installHooks(root, claudeCodeAdapter, "shared", 60_000, false)
    const [check] = await checks(root, [root])
    expect(check).toMatchObject({ level: "error" })
    expect(check?.detail).toContain(".rulecast-config.yaml has refuse_write rules")
    expect(check?.detail).toContain("run rulecast install")
  })

  test("with the hook installed, or nothing to refuse, it says nothing", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": CONFIG })
    await installHooks(root, claudeCodeAdapter, "shared", 60_000, true)
    expect(await checks(root, [root])).toEqual([])
    const plain = await createRepo({ ".rulecast-config.yaml": CONFIG })
    await installHooks(plain, claudeCodeAdapter, "shared", 60_000, false)
    expect(await checks(plain, [])).toEqual([])
  })
})

describe("doctor: a session started below the configs (R6)", () => {
  test("a subdirectory without hooks, under a config whose hooks are at the top, is warned and pointed there", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": CONFIG, "backend/app.py": "" })
    await installHooks(root, claudeCodeAdapter, "shared", 60_000)
    const [check] = await checks(path.join(root, "backend"))
    expect(check?.level).toBe("warning")
    expect(check?.detail).toContain("run no rulecast hooks: ../.rulecast-config.yaml is above this directory")
    expect(check?.detail).toContain("start it in ..")
  })

  test("a directory with its own hooks is not warned, whatever is above it", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": CONFIG, "backend/app.py": "" })
    await installHooks(path.join(root, "backend"), claudeCodeAdapter, "shared", 60_000)
    expect(await checks(path.join(root, "backend"))).toEqual([])
  })

  test("a linked worktree under .claude/worktrees with its own committed settings is not warned (Conductor)", async () => {
    const main = await createRepo({ ".rulecast-config.yaml": CONFIG })
    await installHooks(main, claudeCodeAdapter, "shared", 60_000)
    await git(main, "add", "-A")
    await git(main, "commit", "-qm", "hooks")
    const worktree = path.join(main, ".claude", "worktrees", "feature")
    await git(main, "worktree", "add", "-q", worktree)
    expect(await checks(worktree)).toEqual([])
    // Nor a subdirectory's question answered by the main checkout's configs: they are another checkout's.
    await mkdir(path.join(worktree, "src"), { recursive: true })
    await installHooks(path.join(worktree, "src"), claudeCodeAdapter, "shared", 60_000)
    expect(await checks(path.join(worktree, "src"))).toEqual([])
  })

  test("a linked worktree without settings is not warned about the main checkout's configs", async () => {
    const main = await createRepo({ "a.txt": "" })
    await writeFile(path.join(main, ".rulecast-config.yaml"), CONFIG)
    const worktree = path.join(main, ".claude", "worktrees", "bare")
    await git(main, "worktree", "add", "-q", worktree)
    expect(await checks(worktree)).toEqual([])
  })

  test("personal hooks at the checkout's top run in a subdirectory on an absolute path, and fail on the old one", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": CONFIG, "backend/app.py": "" })
    await installHooks(root, claudeCodeAdapter, "personal", 60_000)
    // doctor's hooks line names them; nothing more to say.
    expect(await checks(path.join(root, "backend"))).toEqual([])
    const local = path.join(root, ".claude/settings.local.json")
    const { readFile } = await import("node:fs/promises")
    const text = JSON.parse(await readFile(local, "utf8"))
    for (const groups of Object.values(text.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups) for (const hook of group.hooks) hook.command = HOOK_COMMAND
    }
    await writeFile(local, JSON.stringify(text))
    const [warning] = await checks(path.join(root, "backend"))
    expect(warning?.level).toBe("warning")
    expect(warning?.detail).toContain("every hook fails here")
  })
})

describe("rulecast doctor names the write guard", () => {
  test("a missing guard is named by its event, not only its matcher, and is an error", async () => {
    const config = localConfig([
      {
        id: "gen/no-edit",
        name: "Generated",
        files: "^gen/",
        detect: { path: {} },
        refuse_write: true,
        message: "{{file}}",
      },
    ])
    const root = await createRepo({ ".rulecast-config.yaml": config })
    await installHooks(root, claudeCodeAdapter, "shared", 60_000, false)
    const result = await runCli(root, ["doctor"])
    expect(result.stdout).toContain("hooks for the write guard (PreToolUse Edit|Write) missing")
    expect(result.stdout).toMatch(/error\s+Claude Code write guard/)
    expect(result.code).toBe(2)
  })
})

describe("rulecast doctor with a rule repo not in the cache", () => {
  test("the write guard can't be judged until the repo is fetched: said, not called out of date", async () => {
    const manifest =
      "- id: gen-guard\n  name: Generated\n  files: ^gen/\n  detect:\n    path: {}\n" +
      '  refuse_write: true\n  message: "{{file}} is generated."\n'
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": manifest } }])
    const root = await createRepo({
      ".rulecast-config.yaml": `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    rules:\n      - id: gen-guard\n`,
    })
    expect((await runCli(root, ["install"])).code).toBe(0)
    const emptyCache = { ...testEnv, RULECAST_HOME: await mkdtemp(path.join(tmpdir(), "rulecast-empty-")) }
    const result = await runCli(root, ["doctor", "--ci"], "", emptyCache)
    expect(result.stdout).not.toContain("out of date")
    expect(result.stdout).toContain("can't be judged until")
  })
})
