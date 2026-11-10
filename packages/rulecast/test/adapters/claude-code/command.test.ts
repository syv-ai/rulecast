import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  HOOK_COMMAND,
  HOOK_SCRIPT,
  HOOK_SCRIPT_FILE,
  NOT_INSTALLED,
  NOT_INSTALLED_UNATTENDED,
} from "../../../src/adapters/claude-code/hook-script"
import { breakPathRulecast, LOOKUP_FIXTURES, lookupEnv, lookupSetup } from "../../helpers/lookup"
import { createProject } from "../../helpers/project"

/**
 * Runs the committed hook the way Claude Code does: the script where install writes it, and the
 * settings' command through a shell, payload on stdin.
 */
function hook(root: string, payload: Record<string, unknown> | string, env: Record<string, string> = {}) {
  mkdirSync(path.join(root, path.dirname(HOOK_SCRIPT_FILE)), { recursive: true })
  writeFileSync(path.join(root, HOOK_SCRIPT_FILE), HOOK_SCRIPT)
  const result = spawnSync("sh", ["-c", HOOK_COMMAND], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { PATH: "/usr/bin:/bin", CLAUDE_PROJECT_DIR: root, ...env },
    encoding: "utf8",
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Plan 10, A3: a clone that has not run npm install yet. */
describe("the committed hook script", () => {
  test("is valid sh with Unix line endings, run by a command that names no rulecast itself", () => {
    const check = spawnSync("sh", ["-n"], { input: HOOK_SCRIPT, encoding: "utf8" })
    expect(check).toMatchObject({ status: 0, stderr: "" })
    expect(HOOK_SCRIPT).not.toContain("\r")
    expect(HOOK_COMMAND).toBe('sh "$CLAUDE_PROJECT_DIR"/.claude/hooks/rulecast.sh')
    expect(HOOK_COMMAND).not.toContain("rulecast hook claude-code")
  })

  test("without rulecast installed, every event exits 0 silently", async () => {
    const root = await createProject({})
    for (const event of ["PostToolUse", "PreToolUse", "Stop", "UserPromptSubmit"]) {
      expect(hook(root, { hook_event_name: event })).toEqual({ code: 0, stdout: "", stderr: "" })
    }
  })

  test("without rulecast installed, SessionStart tells the user once, as a system message", async () => {
    const root = await createProject({})
    const result = hook(root, { session_id: "s", hook_event_name: "SessionStart", source: "startup" })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })

  test("without rulecast installed, an unattended run is told at every stop, as a system message (#29)", async () => {
    const root = await createProject({})
    const envs: Record<string, string>[] = [
      { RULECAST_MODE: "unattended" },
      { CI: "true" },
      { GITHUB_ACTIONS: "true", CI: "false" },
    ]
    for (const env of envs) {
      for (const event of ["Stop", "SubagentStop"]) {
        const result = hook(root, { session_id: "s", hook_event_name: event }, env)
        expect(result.code).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({ systemMessage: NOT_INSTALLED_UNATTENDED })
      }
      // Every other event still exits 0 silently, and SessionStart still says the attended message.
      expect(hook(root, { hook_event_name: "PostToolUse" }, env)).toEqual({ code: 0, stdout: "", stderr: "" })
      expect(JSON.parse(hook(root, { hook_event_name: "SessionStart" }, env).stdout)).toEqual({
        systemMessage: NOT_INSTALLED,
      })
    }
  })

  test("without rulecast installed, an attended stop stays silent", async () => {
    const root = await createProject({})
    const envs: Record<string, string>[] = [
      {},
      { CI: "false" },
      { CI: "0" },
      { CI: "true", RULECAST_MODE: "attended" },
      { RULECAST_MODE: "interactive", GITHUB_ACTIONS: "true" },
    ]
    for (const env of envs) {
      expect(hook(root, { hook_event_name: "Stop" }, env)).toEqual({ code: 0, stdout: "", stderr: "" })
    }
  })

  test("the messages fit inside the script's single quotes", () => {
    expect(NOT_INSTALLED).not.toContain("'")
    expect(NOT_INSTALLED_UNATTENDED).not.toContain("'")
  })

  test("with rulecast installed, it is run with the payload untouched", async () => {
    const root = await createProject({})
    const bin = path.join(root, "node_modules", ".bin")
    mkdirSync(bin, { recursive: true })
    const seen = path.join(root, "seen.txt")
    writeFileSync(
      path.join(bin, "rulecast"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${seen}"\ncat >> "${seen}"\necho '{"ok":true}'\n`,
    )
    chmodSync(path.join(bin, "rulecast"), 0o755)
    const payload = { hook_event_name: "SessionStart", source: "startup" }
    const result = hook(root, payload)
    expect(result).toEqual({ code: 0, stdout: '{"ok":true}\n', stderr: "" })
    expect(readFileSync(seen, "utf8")).toBe(`hook claude-code\n${JSON.stringify(payload)}`)
  })

  /** A stub rulecast in `dir` that records its arguments and stdin in `seen` and answers `reply`. */
  function stub(dir: string, seen: string, reply: string) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "rulecast"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${seen}"\ncat >> "${seen}"\necho '${reply}'\n`,
    )
    chmodSync(path.join(dir, "rulecast"), 0o755)
  }

  test("with rulecast only on the PATH, as a global install, it is run with the payload untouched", async () => {
    // A Python-only project has no node_modules: a global rulecast is the one its developer has.
    const root = await createProject({})
    const global = path.join(root, "global-bin")
    const seen = path.join(root, "seen.txt")
    stub(global, seen, '{"global":true}')
    const payload = { hook_event_name: "PostToolUse", tool_name: "Read" }
    const result = hook(root, payload, { PATH: `${global}:/usr/bin:/bin` })
    expect(result).toEqual({ code: 0, stdout: '{"global":true}\n', stderr: "" })
    expect(readFileSync(seen, "utf8")).toBe(`hook claude-code\n${JSON.stringify(payload)}`)
  })

  test("a rulecast on the PATH that cannot run, such as a version-manager shim, is treated as not installed", async () => {
    // asdf, mise and nodenv shims are found by command -v and then fail when the project's Node has
    // no rulecast: without this, every hook would fail again (plan 21 review).
    const root = await createProject({})
    const shims = path.join(root, "shims")
    mkdirSync(shims, { recursive: true })
    writeFileSync(path.join(shims, "rulecast"), "#!/usr/bin/env no-such-node\n")
    chmodSync(path.join(shims, "rulecast"), 0o755)
    const env = { PATH: `${shims}:/usr/bin:/bin` }
    expect(hook(root, { hook_event_name: "PostToolUse" }, env)).toMatchObject({ code: 0, stdout: "" })
    const start = hook(root, { hook_event_name: "SessionStart", source: "startup" }, env)
    expect(start.code).toBe(0)
    expect(JSON.parse(start.stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })

  test("a rulecast on the PATH keeps its own exit code and output", async () => {
    const root = await createProject({})
    const global = path.join(root, "global-bin")
    mkdirSync(global, { recursive: true })
    writeFileSync(
      path.join(global, "rulecast"),
      "#!/bin/sh\ncat > /dev/null\necho '{\"x\":1}'\necho blocked >&2\nexit 2\n",
    )
    chmodSync(path.join(global, "rulecast"), 0o755)
    const result = hook(root, { hook_event_name: "Stop" }, { PATH: `${global}:/usr/bin:/bin` })
    expect(result).toEqual({ code: 2, stdout: '{"x":1}\n', stderr: "blocked\n" })
  })

  test("install.sh's rulecast in ~/.local/bin is found with HOME alone, as a GUI-started agent has it", async () => {
    const root = await createProject({})
    const home = path.join(root, "user")
    mkdirSync(path.join(home, ".local", "bin"), { recursive: true })
    writeFileSync(
      path.join(home, ".local", "bin", "rulecast"),
      "#!/bin/sh\ncat > /dev/null\necho '{\"installed\":true}'\n",
    )
    chmodSync(path.join(home, ".local", "bin", "rulecast"), 0o755)
    expect(hook(root, { hook_event_name: "Stop" }, { HOME: home }).stdout).toBe('{"installed":true}\n')
  })

  test.each(LOOKUP_FIXTURES)("$name", async ({ places, runs, installedOnPath }) => {
    const root = await createProject({})
    const env = lookupEnv(lookupSetup(places, root), installedOnPath)
    const result = hook(root, { hook_event_name: "Stop" }, env)
    expect(result.stdout).toBe(`{"${runs}":true}\n`)
  })

  test("a PATH rulecast that cannot run on this machine counts as none: not installed", async () => {
    // A binary for another machine, or one the OS refuses.
    const root = await createProject({})
    const setup = lookupSetup(["path"], root)
    breakPathRulecast(setup)
    const env = { PATH: `${setup.pathDir}:/usr/bin:/bin` }
    // The shell's own "cannot execute" goes to stderr, which Claude Code shows only in verbose mode.
    expect(hook(root, { hook_event_name: "PostToolUse", tool_name: "Edit" }, env)).toMatchObject({
      code: 0,
      stdout: "",
    })
    const start = hook(root, { hook_event_name: "SessionStart", source: "startup" }, env)
    expect(start.code).toBe(0)
    expect(JSON.parse(start.stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })

  test("a PATH rulecast that crashes or is killed is the answer: the not-installed message does not follow", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["path"], root)
    writeFileSync(setup.file.path, "#!/bin/sh\ncat > /dev/null\nkill -KILL $$\n")
    const result = hook(root, { hook_event_name: "SessionStart" }, { PATH: `${setup.pathDir}:/usr/bin:/bin` })
    expect(result.code).toBe(137)
    expect(result.stdout).toBe("")
  })

  test("with HOME unset it still exits 0", async () => {
    const root = await createProject({})
    // hook() passes no HOME: the command's environment is PATH and CLAUDE_PROJECT_DIR alone.
    expect(hook(root, { hook_event_name: "PostToolUse" })).toEqual({ code: 0, stdout: "", stderr: "" })
    expect(hook(root, { hook_event_name: "SessionStart" }).code).toBe(0)
  })

  test("the project's own rulecast wins over one on the PATH", async () => {
    const root = await createProject({})
    stub(path.join(root, "node_modules", ".bin"), path.join(root, "local.txt"), '{"local":true}')
    stub(path.join(root, "global-bin"), path.join(root, "global.txt"), '{"global":true}')
    const result = hook(root, { hook_event_name: "Stop" }, { PATH: `${path.join(root, "global-bin")}:/usr/bin:/bin` })
    expect(result.stdout).toBe('{"local":true}\n')
  })

  test("a large payload reaches the PATH's rulecast unchanged", async () => {
    // A Write of a 200 KB file: past the project's own rulecast, the script holds the payload in a variable.
    const root = await createProject({})
    const setup = lookupSetup(["path"], root)
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_input: { content: "x'\" $y\n".repeat(40_000) },
    })
    const result = hook(root, payload, { PATH: `${setup.pathDir}:/usr/bin:/bin` })
    expect(result.stdout).toBe('{"path":true}\n')
    expect(readFileSync(path.join(root, "ran-path"), "utf8")).toBe(`hook claude-code\n${payload}`)
  })

  test("a project path with a space and a single quote still finds each rulecast", async () => {
    const parent = await createProject({})
    for (const places of [["project"], ["path"], ["installed"]] as const) {
      const root = path.join(parent, `it's a ${places[0]}`)
      mkdirSync(root, { recursive: true })
      const { pathDir, installDir } = lookupSetup([...places], root)
      const env = { PATH: `${pathDir}:/usr/bin:/bin`, RULECAST_INSTALL_DIR: installDir }
      expect(hook(root, { hook_event_name: "Stop" }, env).stdout).toBe(`{"${places[0]}":true}\n`)
    }
    const bare = path.join(parent, "it's bare")
    mkdirSync(bare, { recursive: true })
    expect(JSON.parse(hook(bare, { hook_event_name: "SessionStart" }).stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })
})
