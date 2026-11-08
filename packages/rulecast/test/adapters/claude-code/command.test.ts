import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { HOOK_COMMAND, NOT_INSTALLED, NOT_INSTALLED_UNATTENDED } from "../../../src/adapters/claude-code/adapter"
import { currentBinaryPath } from "../../../src/core/binary-home"
import { breakInstalledBinary, LOOKUP_FIXTURES, lookupSetup } from "../../helpers/lookup"
import { createProject } from "../../helpers/project"

/** Runs the committed hook command the way Claude Code does: through a shell, payload on stdin. */
function hook(root: string, payload: Record<string, unknown>, env: Record<string, string> = {}) {
  const result = spawnSync("sh", ["-c", HOOK_COMMAND], {
    input: JSON.stringify(payload),
    env: { PATH: "/usr/bin:/bin", CLAUDE_PROJECT_DIR: root, ...env },
    encoding: "utf8",
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Plan 10, A3: a clone that has not run npm install yet. */
describe("the committed hook command", () => {
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

  test("the messages fit inside the command's single quotes", () => {
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

  test("with only the installed binary, it is run with the payload untouched", async () => {
    const root = await createProject({})
    const { home } = lookupSetup(["binary"], root)
    const payload = { hook_event_name: "PostToolUse", tool_name: "Edit" }
    expect(hook(root, payload, { RULECAST_HOME: home })).toEqual({ code: 0, stdout: '{"binary":true}\n', stderr: "" })
    expect(readFileSync(path.join(root, "ran-binary"), "utf8")).toBe(`hook claude-code\n${JSON.stringify(payload)}`)
  })

  test.each(LOOKUP_FIXTURES)("$name", async ({ places, runs }) => {
    const root = await createProject({})
    const { home, pathDir } = lookupSetup(places, root)
    const result = hook(root, { hook_event_name: "Stop" }, { RULECAST_HOME: home, PATH: `${pathDir}:/usr/bin:/bin` })
    expect(result.stdout).toBe(`{"${runs}":true}\n`)
  })

  test("the installed binary is found through XDG_CACHE_HOME and HOME as well", async () => {
    const root = await createProject({})
    const { home } = lookupSetup(["binary"], root)
    // lookupSetup's home is <scratch>/home: as XDG_CACHE_HOME it would be <scratch>/home/rulecast.
    const xdg = path.join(path.dirname(home), "xdg")
    mkdirSync(xdg)
    symlinkSync(home, path.join(xdg, "rulecast"))
    expect(hook(root, { hook_event_name: "Stop" }, { XDG_CACHE_HOME: xdg }).stdout).toBe('{"binary":true}\n')
    const user = path.join(path.dirname(home), "user")
    mkdirSync(user)
    symlinkSync(xdg, path.join(user, ".cache"))
    expect(hook(root, { hook_event_name: "Stop" }, { HOME: user }).stdout).toBe('{"binary":true}\n')
  })

  test("a link to a missing binary counts as none", async () => {
    const root = await createProject({})
    const { home, file } = lookupSetup(["binary"], root)
    rmSync(realpathSync(file.binary))
    const env = { RULECAST_HOME: home }
    expect(hook(root, { hook_event_name: "PostToolUse" }, env)).toEqual({ code: 0, stdout: "", stderr: "" })
    const start = hook(root, { hook_event_name: "SessionStart", source: "startup" }, env)
    expect(JSON.parse(start.stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })

  test("an installed binary that cannot run on this machine falls through to the PATH, then to not installed", async () => {
    // A shared cache home with another machine's binary in it, or one the OS refuses.
    const root = await createProject({})
    const setup = lookupSetup(["binary", "path"], root)
    breakInstalledBinary(setup)
    const env = { RULECAST_HOME: setup.home, PATH: `${setup.pathDir}:/usr/bin:/bin` }
    const payload = { hook_event_name: "PostToolUse", tool_name: "Edit" }
    expect(hook(root, payload, env)).toMatchObject({ code: 0, stdout: '{"path":true}\n' })
    expect(readFileSync(path.join(root, "ran-path"), "utf8")).toBe(`hook claude-code\n${JSON.stringify(payload)}`)
    rmSync(setup.file.path)
    const start = hook(root, { hook_event_name: "SessionStart", source: "startup" }, { RULECAST_HOME: setup.home })
    expect(start.code).toBe(0)
    expect(JSON.parse(start.stdout)).toEqual({ systemMessage: NOT_INSTALLED })
  })

  test("an installed binary that crashes or is killed is the answer: the PATH rulecast does not run too", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary", "path"], root)
    writeFileSync(realpathSync(setup.file.binary), "#!/bin/sh\ncat > /dev/null\nkill -KILL $$\n")
    const env = { RULECAST_HOME: setup.home, PATH: `${setup.pathDir}:/usr/bin:/bin` }
    const result = hook(root, { hook_event_name: "PostToolUse" }, env)
    expect(result.code).toBe(137)
    expect(result.stdout).toBe("")
    expect(existsSync(path.join(root, "ran-path"))).toBe(false)
  })

  test("a home holding only another platform's binary falls through to the PATH", async () => {
    // A cache home shared with another machine: its link is never run here, by any shell.
    const root = await createProject({})
    const setup = lookupSetup(["path"], root)
    const foreign = currentBinaryPath(setup.home, process.platform === "linux" ? "darwin" : "linux", "x64")
    mkdirSync(path.dirname(foreign), { recursive: true })
    writeFileSync(foreign, "#!/bin/sh\necho '{\"foreign\":true}'\n")
    chmodSync(foreign, 0o755)
    const env = { RULECAST_HOME: setup.home, PATH: `${setup.pathDir}:/usr/bin:/bin` }
    expect(hook(root, { hook_event_name: "Stop" }, env).stdout).toBe('{"path":true}\n')
  })

  test("the installed binary keeps its own exit code and output", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary"], root)
    writeFileSync(
      realpathSync(setup.file.binary),
      "#!/bin/sh\ncat > /dev/null\necho '{\"x\":1}'\necho blocked >&2\nexit 2\n",
    )
    expect(hook(root, { hook_event_name: "Stop" }, { RULECAST_HOME: setup.home })).toEqual({
      code: 2,
      stdout: '{"x":1}\n',
      stderr: "blocked\n",
    })
  })

  test("with HOME unset and no RULECAST_HOME it still exits 0", async () => {
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
})
