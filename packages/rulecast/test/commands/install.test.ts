import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import {
  HOOK_COMMAND,
  HOOK_SCRIPT,
  HOOK_SCRIPT_FILE,
  personalHookCommand,
} from "../../src/adapters/claude-code/hook-script"
import { hookConfigs, hooksInstalled } from "../../src/commands/install"
import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture } from "../helpers/fixture"
import { createRepo, git } from "../helpers/git"
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
    expect(first.stdout).toContain("installed Claude Code hooks in .claude/settings.json: PostToolUse (Read)")
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
      "SubagentStart",
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

  test("--scope personal writes the personal settings; a personal install finds them, a shared one is refused", async () => {
    const root = await createFixture()
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain(
      "installed Claude Code hooks in .claude/settings.local.json",
    )
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toBe(
      "Claude Code hooks already installed in .claude/settings.local.json\n",
    )
    expect((await runCli(root, ["install"])).code).toBe(2)
    expect(existsSync(path.join(root, SHARED))).toBe(false)
  })

  test("--scope personal names the script by its absolute path; shared keeps $CLAUDE_PROJECT_DIR", async () => {
    // settings.local.json is read at the git top when a session starts below it, where
    // $CLAUDE_PROJECT_DIR is: a relative command would fail with 127 on every event.
    const root = await createFixture()
    await runCli(root, ["install", "--scope", "personal"])
    expect((await settingsOf(root, PERSONAL)).hooks.Stop[0].hooks[0].command).toBe(personalHookCommand(root))
    const shared = await createFixture()
    await runCli(shared, ["install"])
    expect((await settingsOf(shared)).hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
  })

  test("personal hooks on the $CLAUDE_PROJECT_DIR command are out of date, and install rewrites them", async () => {
    const root = await createFixture()
    await runCli(root, ["install", "--scope", "personal"])
    const text = (await read(root, PERSONAL)).replaceAll(
      JSON.stringify(personalHookCommand(root)).slice(1, -1),
      JSON.stringify(HOOK_COMMAND).slice(1, -1),
    )
    await writeFile(path.join(root, PERSONAL), text)
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain(
      "updated Claude Code hooks in .claude/settings.local.json",
    )
    expect((await settingsOf(root, PERSONAL)).hooks.Stop[0].hooks[0].command).toBe(personalHookCommand(root))
  })

  /** Rulecast's hooks with every command set to `command`, as a teammate's committed file has them. */
  const withCommand = (settings: Record<string, unknown>, command: string) => {
    const copy = structuredClone(settings) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    for (const groups of Object.values(copy.hooks)) {
      for (const group of groups) for (const hook of group.hooks) hook.command = command
    }
    return copy
  }

  /** The reviewer's layout: configs at the top, in pkg/ and other/; a worktree beside it and one in .claude/worktrees. */
  async function layout() {
    const main = await realpath(
      await createRepo({
        ".rulecast-config.yaml": "repos: []\n",
        "pkg/.rulecast-config.yaml": "repos: []\n",
        "other/.rulecast-config.yaml": "repos: []\n",
        ".gitignore": ".claude/settings.local.json\n.claude/worktrees/\n",
      }),
    )
    const wt = `${main}-wt`
    await git(main, "worktree", "add", "-q", wt, "-b", "wt")
    const x = path.join(main, ".claude", "worktrees", "x")
    await git(main, "worktree", "add", "-q", x, "-b", "x")
    return { main, pkg: path.join(main, "pkg"), other: path.join(main, "other"), wt, x }
  }
  const run = async (dir: string, ...args: string[]) => runCli(dir, args)

  describe("scopes: personal has one file, at the checkout's top; nothing is removed that nobody named", () => {
    test("a personal install anywhere targets the top's file, and is upgraded there in place", async () => {
      const { main, pkg, wt } = await layout()
      expect((await run(pkg, "install", "--scope", "personal")).code).toBe(0)
      expect(existsSync(path.join(main, PERSONAL))).toBe(true)
      expect(existsSync(path.join(pkg, PERSONAL))).toBe(false)
      expect((await run(main, "install", "--scope", "personal")).stdout).toContain(`already installed in ${PERSONAL}`)
      expect((await run(wt, "install", "--scope", "personal")).stdout).toContain(
        `already installed in ${path.relative(wt, main)}/${PERSONAL}`,
      )
    })

    test("a personal install never counts a settings.json as installed: shared hooks at the top refuse it, from pkg too", async () => {
      const { main, pkg } = await layout()
      await run(main, "install")
      const result = await run(pkg, "install", "--scope", "personal")
      expect(result.code).toBe(2)
      expect(result.stdout).not.toContain("already installed")
      expect(result.stderr).toContain(`../${SHARED}`)
      expect(result.stderr).toContain("rulecast uninstall --scope shared in ..")
      expect(existsSync(path.join(main, PERSONAL))).toBe(false)
    })

    test.each(["pkg", "other", "x", "wt"])(
      "a personal install refuses when %s has shared hooks, naming the file and where to uninstall",
      async (where) => {
        const dirs = await layout()
        const dir = dirs[where as "pkg" | "other" | "x" | "wt"]
        await run(dir, "install")
        const result = await run(dirs.main, "install", "--scope", "personal")
        expect(result.code).toBe(2)
        const rel = path.relative(dirs.main, dir)
        expect(result.stderr).toContain(`${rel}/${SHARED}`)
        expect(result.stderr).toContain(`rulecast uninstall --scope shared in ${rel}`)
        expect(existsSync(path.join(dirs.main, PERSONAL))).toBe(false)
      },
    )

    test("a shared install refuses where the top's personal hooks already run: in pkg, at the top, in a worktree", async () => {
      const { main, pkg, x } = await layout()
      await run(main, "install", "--scope", "personal")
      const personal = await read(main, PERSONAL)
      const fromPkg = await run(pkg, "install")
      expect(fromPkg.code).toBe(2)
      expect(fromPkg.stderr).toContain("rulecast uninstall --scope personal in ..")
      expect(fromPkg.stderr).toContain("every session in this checkout and its worktrees")
      expect((await run(main, "install")).code).toBe(2)
      const fromWorktree = await run(x, "install")
      expect(fromWorktree.code).toBe(2)
      expect(fromWorktree.stderr).toContain("every session in the main checkout and its worktrees")
      expect(fromWorktree.stderr).toContain("rulecast uninstall --scope personal in ../../..")
      expect(await read(main, PERSONAL)).toBe(personal)
      expect(existsSync(path.join(pkg, SHARED))).toBe(false)
    })

    test("following a refusal's uninstall command resolves it: no loop", async () => {
      const { main, pkg } = await layout()
      await run(main, "install", "--scope", "personal")
      expect((await run(pkg, "install")).code).toBe(2)
      expect((await run(main, "uninstall", "--scope", "personal")).code).toBe(0)
      expect((await run(pkg, "install")).code).toBe(0)
      expect((await run(main, "install", "--scope", "personal")).code).toBe(2)
      expect((await run(pkg, "uninstall", "--scope", "shared")).code).toBe(0)
      expect((await run(main, "install", "--scope", "personal")).code).toBe(0)
    })

    test("a settings.local.json below the top is a leftover: not installed, warned about, and cleaned up from there", async () => {
      const { main, pkg, x } = await layout()
      await run(main, "install", "--scope", "personal")
      const hooks = await read(main, PERSONAL)
      for (const dir of [pkg, x]) {
        await mkdir(path.join(dir, ".claude"), { recursive: true })
        await writeFile(path.join(dir, PERSONAL), hooks)
      }
      await run(main, "uninstall", "--scope", "personal")
      for (const dir of [pkg, x]) {
        const doctor = await run(dir, "doctor")
        expect(doctor.stdout).toContain("not installed (run rulecast install here)")
        expect(doctor.stdout).toContain("leftover hooks")
        expect(doctor.stdout).toContain("rulecast uninstall --scope personal here")
        expect(doctor.stdout).toContain(
          `the personal file it reads for sessions here is ${path.relative(dir, path.join(main, PERSONAL))};`,
        )
        expect((await run(dir, "uninstall", "--scope", "personal")).stdout).toContain(
          `removed Claude Code hooks from ${PERSONAL}`,
        )
        expect((await run(dir, "doctor")).stdout).not.toContain("leftover hooks")
      }
    })

    test("uninstall --scope personal below the top removes nothing there, and says where to run it", async () => {
      const { main, pkg } = await layout()
      await run(main, "install", "--scope", "personal")
      const result = await run(pkg, "uninstall", "--scope", "personal")
      expect(result.stdout).toContain("no Claude Code hooks to remove here")
      expect(result.stdout).toContain("run rulecast uninstall --scope personal in ..")
      expect(existsSync(path.join(main, PERSONAL))).toBe(true)
    })

    test("doctor's remedies say where, and following them ends the warning", async () => {
      const { main, pkg } = await layout()
      await run(main, "install", "--scope", "personal")
      const stale = withCommand(await settingsOf(main, PERSONAL), "rulecast hook claude-code")
      await writeFile(path.join(main, PERSONAL), JSON.stringify(stale))
      const doctor = await run(pkg, "doctor")
      expect(doctor.stdout).toContain(
        `../${PERSONAL} — but the hooks are out of date; run rulecast install --scope personal here`,
      )
      expect((await run(pkg, "install", "--scope", "personal")).code).toBe(0)
      expect((await run(pkg, "doctor")).stdout).not.toContain("out of date")
    })

    test("doctor reports shared and personal both as an error, saying where to uninstall either", async () => {
      const { main } = await layout()
      await run(main, "install", "--scope", "personal")
      const shared = withCommand(await settingsOf(main, PERSONAL), HOOK_COMMAND)
      await writeFile(path.join(main, SHARED), JSON.stringify(shared))
      const result = await run(main, "doctor")
      expect(result.stdout).toMatch(/error\s+Claude Code hooks twice/)
      expect(result.stdout).toContain("rulecast uninstall --scope personal here")
      expect(result.stdout).toContain("rulecast uninstall --scope shared here")
      expect(result.code).toBe(2)
    })

    test("a personal install finds shared hooks anywhere: in a worktree's config root, a dir without a config, one above configs (t17-t19)", async () => {
      const dirs = await layout()
      await mkdir(path.join(dirs.main, "src"), { recursive: true })
      await mkdir(path.join(dirs.main, "packages", "a"), { recursive: true })
      await writeFile(path.join(dirs.main, "packages", "a", ".rulecast-config.yaml"), "repos: []\n")
      for (const dir of [path.join(dirs.wt, "pkg"), path.join(dirs.main, "src"), path.join(dirs.main, "packages")]) {
        expect((await run(dir, "install")).code).toBe(0)
      }
      const result = await run(dirs.main, "install", "--scope", "personal")
      expect(result.code).toBe(2)
      for (const rel of [`${path.relative(dirs.main, dirs.wt)}/pkg`, "src", "packages"]) {
        expect(result.stderr).toContain(`${rel}/${SHARED}`)
        expect(result.stderr).toContain(`rulecast uninstall --scope shared in ${rel}`)
      }
    })

    test("doctor with no config at or above still reports the hooks sessions there run (t19)", async () => {
      const main = await realpath(await createRepo({ "packages/a/.rulecast-config.yaml": "repos: []\n" }))
      const packages = path.join(main, "packages")
      expect((await run(main, "install", "--scope", "personal")).code).toBe(0)
      await mkdir(path.join(packages, ".claude"), { recursive: true })
      const shared = withCommand(await settingsOf(main, PERSONAL), HOOK_COMMAND)
      await writeFile(path.join(packages, SHARED), JSON.stringify(shared))
      const doctor = await run(packages, "doctor")
      expect(doctor.code).toBe(2)
      expect(doctor.stdout).toMatch(/error\s+Claude Code hooks twice/)
      expect(doctor.stdout).toContain("rulecast uninstall --scope personal in ..")
    })

    test("doctor's remedy never leads into a refusal: it clears the conflict first (t20, t13)", async () => {
      const { main, pkg } = await layout()
      // t20: old personal hooks at the top, shared hooks in pkg.
      await run(pkg, "install")
      const old = withCommand(JSON.parse(await read(pkg, SHARED)), "rulecast hook claude-code")
      await writeFile(path.join(main, PERSONAL), JSON.stringify(old))
      const remedy = "rulecast uninstall --scope shared in pkg, then rulecast install --scope personal here"
      expect((await run(main, "doctor")).stdout).toContain(remedy)
      expect((await run(pkg, "uninstall", "--scope", "shared")).code).toBe(0)
      expect((await run(main, "install", "--scope", "personal")).code).toBe(0)
      // t13: both at the top, the shared ones out of date.
      await writeFile(path.join(main, SHARED), JSON.stringify(old))
      expect((await run(main, "doctor")).stdout).toContain(
        "rulecast uninstall --scope personal here, then rulecast install here",
      )
      expect((await run(main, "uninstall", "--scope", "personal")).code).toBe(0)
      expect((await run(main, "install")).code).toBe(0)
    })

    test("a shared install's refusal offers only what works: uninstalling the personal hooks", async () => {
      const { main, pkg } = await layout()
      await run(main, "install", "--scope", "personal")
      const result = await run(pkg, "install")
      expect(result.stderr).not.toContain("already installed")
      expect(result.stderr).toContain("run rulecast uninstall --scope personal in .. first")
    })

    test("identical commands in both files are one handler to Claude Code: not twice", async () => {
      const { main } = await layout()
      await run(main, "install")
      await writeFile(path.join(main, PERSONAL), await read(main, SHARED))
      expect((await run(main, "doctor")).stdout).not.toContain("hooks twice")
    })
  })

  describe("the write guard: only where a config refuses writes", () => {
    const refusing = localConfig([
      {
        id: "gen/no-edit",
        name: "Generated",
        files: "^gen/",
        detect: { path: {} },
        refuse_write: true,
        message: "{{file}} is generated.",
      },
    ])
    const guardGroups = async (root: string) =>
      ((await settingsOf(root)).hooks.PreToolUse as { matcher: string }[]).filter(
        (group) => group.matcher === "Edit|Write",
      )

    test("no refuse_write rule: no PreToolUse Edit|Write hook", async () => {
      const root = await createFixture()
      await runCli(root, ["install"])
      expect(await guardGroups(root)).toEqual([])
    })

    test("a refuse_write rule, here or in a config a session here reaches, gets one; removing it takes it out", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": "repos: []\n", "pkg/.rulecast-config.yaml": refusing })
      await runCli(root, ["install"])
      expect(await guardGroups(root)).toHaveLength(1)
      await writeFile(path.join(root, "pkg/.rulecast-config.yaml"), "repos: []\n")
      const again = await runCli(root, ["install"])
      expect(again.stdout).toContain("PreToolUse (Edit|Write) removed")
      expect(await guardGroups(root)).toEqual([])
    })

    test("refuse_write: unattended counts: the mode is the session's", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": refusing.replace("refuse_write: true", "refuse_write: unattended"),
      })
      await runCli(root, ["install"])
      expect(await guardGroups(root)).toHaveLength(1)
    })
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

  test("hooks on an older command in both settings files: doctor says so, and install refuses until one goes", async () => {
    const OLD = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const local = await createProject({
      ".rulecast-config.yaml": "repos: []\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\necho 0.8.2\n",
    })
    await chmod(path.join(local, "node_modules/.bin/rulecast"), 0o755)
    await runCli(local, ["install"])
    const older = withCommand(await settingsOf(local), OLD)
    await writeFile(path.join(local, SHARED), JSON.stringify(older))
    await writeFile(path.join(local, PERSONAL), JSON.stringify(older))
    const doctor = (await runCli(local, ["doctor"])).stdout
    // The same command in both is one handler to Claude Code: out of date, not twice.
    // Its remedy clears what would refuse it first.
    expect(doctor).toContain(
      `${SHARED} — but the hooks are out of date; run rulecast uninstall --scope personal here, then rulecast install here`,
    )
    expect(doctor).not.toContain("hooks twice")
    // Upgraded, the shared ones would no longer match the personal ones: refused until one goes.
    expect((await runCli(local, ["install"])).code).toBe(2)
    await runCli(local, ["uninstall", "--scope", "personal"])
    const fixed = await runCli(local, ["install"])
    expect(fixed.stdout).toContain(`updated Claude Code hooks in ${SHARED}: `)
    expect((await runCli(local, ["doctor"])).stdout).not.toContain("out of date")
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

    const result = await runCli(root, ["install", "--scope", "personal"])
    expect(result.stdout).toBe(
      "installed Claude Code hooks in .claude/settings.local.json: PostToolUseFailure (Read), PreToolUse (Bash), PostToolUse (Bash), PostToolUseFailure (Bash), SessionStart (clear|fork)\n",
    )
    // Upgraded where it was, not installed a second time in the shared file.
    expect(existsSync(path.join(root, SHARED))).toBe(false)
    expect((await settingsOf(root, PERSONAL)).hooks.PostToolUseFailure).toHaveLength(2)
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain("already installed")
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
    expect(result.stdout).toContain(
      "updated Claude Code hooks in .claude/settings.json: PreToolUse (SubagentHandback), Stop, SubagentStop",
    )
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
    expect(await runCli(root, ["uninstall"])).toMatchObject({
      code: 0,
      stdout: "no Claude Code hooks to remove here\n",
    })
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
