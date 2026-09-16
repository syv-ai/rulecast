import { describe, expect, test } from "vitest"

import { mergeHooks, SettingsError } from "../../../src/adapters/claude-code/settings"

const COMMAND = "rulecast hook claude-code"
const hook = (timeout: number) => ({ type: "command", command: COMMAND, timeout })

describe("Claude Code settings: mergeHooks", () => {
  test("installs every rulecast hook into empty settings", () => {
    expect(mergeHooks({}, COMMAND, 60_000)).toEqual({
      settings: {
        hooks: {
          PostToolUse: [
            { matcher: "Read", hooks: [hook(5)] },
            { matcher: "Edit|Write", hooks: [hook(5)] },
          ],
          Stop: [{ hooks: [hook(70)] }],
          SubagentStop: [{ hooks: [hook(70)] }],
          UserPromptSubmit: [{ hooks: [hook(5)] }],
          SessionStart: [{ matcher: "startup|resume|compact", hooks: [hook(5)] }],
        },
      },
      added: [
        "PostToolUse (Read)",
        "PostToolUse (Edit|Write)",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
      ],
    })
  })

  test("keeps existing settings and hooks exactly as they are, and does not mutate its input", () => {
    const existing = {
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: {
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "dash-hook post" }] }],
        Stop: [{ hooks: [{ type: "command", command: "dash-hook stop" }] }],
      },
    }
    const input = structuredClone(existing)
    const { settings } = mergeHooks(input, COMMAND, 20_000)
    expect(input).toEqual(existing)
    expect(settings.permissions).toEqual(existing.permissions)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(hooks.PostToolUse).toEqual([
      existing.hooks.PostToolUse[0],
      { matcher: "Read", hooks: [hook(5)] },
      { matcher: "Edit|Write", hooks: [hook(5)] },
    ])
    expect(hooks.Stop).toEqual([existing.hooks.Stop[0], { hooks: [hook(30)] }])
  })

  test("is idempotent, and any command running rulecast hook claude-code counts as installed", () => {
    const once = mergeHooks({}, COMMAND, 60_000).settings
    expect(mergeHooks(once, COMMAND, 60_000)).toEqual({ settings: once, added: [] })
    const local = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    expect(mergeHooks(once, local, 60_000).added).toEqual([])
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => mergeHooks(bad, COMMAND, 60_000)).toThrow(SettingsError)
  })
})
