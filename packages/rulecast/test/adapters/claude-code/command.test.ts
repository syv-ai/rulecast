import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { LOCAL_COMMAND, NOT_INSTALLED } from "../../../src/adapters/claude-code/adapter"
import { createProject } from "../../helpers/project"

/** Runs the committed hook command the way Claude Code does: through a shell, payload on stdin. */
function hook(root: string, payload: Record<string, unknown>) {
  const result = spawnSync("sh", ["-c", LOCAL_COMMAND], {
    input: JSON.stringify(payload),
    env: { PATH: "/usr/bin:/bin", CLAUDE_PROJECT_DIR: root },
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
})
