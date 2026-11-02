import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { HOOK_COMMAND, NOT_INSTALLED, NOT_INSTALLED_UNATTENDED } from "../../../src/adapters/claude-code/adapter"
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

  test("the project's own rulecast wins over one on the PATH", async () => {
    const root = await createProject({})
    stub(path.join(root, "node_modules", ".bin"), path.join(root, "local.txt"), '{"local":true}')
    stub(path.join(root, "global-bin"), path.join(root, "global.txt"), '{"global":true}')
    const result = hook(root, { hook_event_name: "Stop" }, { PATH: `${path.join(root, "global-bin")}:/usr/bin:/bin` })
    expect(result.stdout).toBe('{"local":true}\n')
  })
})
