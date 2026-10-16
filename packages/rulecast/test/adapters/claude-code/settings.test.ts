import { describe, expect, test } from "vitest"

import { LOCAL_COMMAND } from "../../../src/adapters/claude-code/adapter"
import { mergeHooks, removeHooks, SettingsError } from "../../../src/adapters/claude-code/settings"

const COMMAND = "rulecast hook claude-code"
const hook = (timeout: number) => ({ type: "command", command: COMMAND, timeout })

describe("Claude Code settings: mergeHooks", () => {
  test("installs every rulecast hook into empty settings", () => {
    expect(mergeHooks({}, COMMAND, 60_000)).toEqual({
      settings: {
        hooks: {
          PreToolUse: [
            { matcher: "Edit|Write", hooks: [hook(5)] },
            { matcher: "Bash", hooks: [hook(5)] },
          ],
          PostToolUse: [
            { matcher: "Read", hooks: [hook(5)] },
            { matcher: "Edit|Write", hooks: [hook(5)] },
            { matcher: "Bash", hooks: [hook(5)] },
          ],
          PostToolUseFailure: [{ matcher: "Bash", hooks: [hook(5)] }],
          Stop: [{ hooks: [hook(70)] }],
          SubagentStop: [{ hooks: [hook(70)] }],
          UserPromptSubmit: [{ hooks: [hook(5)] }],
          SessionStart: [
            { matcher: "startup|resume|compact", hooks: [hook(5)] },
            { matcher: "clear|fork", hooks: [hook(5)] },
          ],
        },
      },
      added: [
        "PreToolUse (Edit|Write)",
        "PostToolUse (Read)",
        "PostToolUse (Edit|Write)",
        "PreToolUse (Bash)",
        "PostToolUse (Bash)",
        "PostToolUseFailure (Bash)",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
        "SessionStart (clear|fork)",
      ],
      updated: [],
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
      { matcher: "Bash", hooks: [hook(5)] },
    ])
    expect(hooks.Stop).toEqual([existing.hooks.Stop[0], { hooks: [hook(30)] }])
  })

  test("is idempotent, and any command running rulecast hook claude-code counts as installed", () => {
    const once = mergeHooks({}, COMMAND, 60_000).settings
    expect(mergeHooks(once, COMMAND, 60_000)).toEqual({ settings: once, added: [], updated: [] })
    const local = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    expect(mergeHooks(once, local, 60_000).added).toEqual([])
  })

  test("an install from before the Bash hooks gains them, and only them", () => {
    const once = mergeHooks({}, COMMAND, 60_000).settings
    const hooks = once.hooks as Record<string, { matcher?: string }[]>
    const older = {
      hooks: {
        ...hooks,
        PreToolUse: hooks.PreToolUse!.filter((group) => group.matcher !== "Bash"),
        PostToolUse: hooks.PostToolUse!.filter((group) => group.matcher !== "Bash"),
        PostToolUseFailure: undefined,
      },
    }
    delete older.hooks.PostToolUseFailure
    const upgraded = mergeHooks(older, COMMAND, 60_000)
    expect(upgraded.added).toEqual(["PreToolUse (Bash)", "PostToolUse (Bash)", "PostToolUseFailure (Bash)"])
    expect(upgraded.updated).toEqual([])
    expect(upgraded.settings).toEqual(once)
  })

  test("the guard from before #29 is rewritten in place to the current one", () => {
    const previous =
      'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; ' +
      "grep -q '\"hook_event_name\": *\"SessionStart\"' && printf '%s' '{}'; exit 0"
    const older = mergeHooks({}, previous, 60_000).settings
    const upgraded = mergeHooks(older, LOCAL_COMMAND, 60_000, LOCAL_COMMAND)
    expect(upgraded.added).toEqual([])
    expect(upgraded.updated).toContain("Stop")
    expect(upgraded.settings).toEqual(mergeHooks({}, LOCAL_COMMAND, 60_000).settings)
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => removeHooks(bad)).toThrow(SettingsError)
  })
})
