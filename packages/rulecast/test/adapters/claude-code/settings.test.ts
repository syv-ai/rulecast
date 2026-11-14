import { describe, expect, test } from "vitest"

import { HOOK_COMMAND } from "../../../src/adapters/claude-code/hook-script"
import { mergeHooks, removeHooks, SettingsError } from "../../../src/adapters/claude-code/settings"

const COMMAND = "rulecast hook claude-code"
const hook = (timeout: number) => ({ type: "command", command: COMMAND, timeout })

/** The inline command 0.10 installed, pasted as it was released: settings committed then still run it. */
const V0_10_COMMAND =
  'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; P=$(cat); ' +
  "if command -v rulecast >/dev/null 2>&1; then printf '%s' \"$P\" | rulecast hook claude-code; R=$?; " +
  '[ "$R" -ne 126 ] && [ "$R" -ne 127 ] && exit "$R"; fi; ' +
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
  'L="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; ' +
  'if [ -x "$L" ]; then printf \'%s\' "$P" | "$L" hook claude-code; R=$?; ' +
  '[ "$R" -ne 126 ] && [ "$R" -ne 127 ] && exit "$R"; fi; ' +
  'U=; case "$CI" in ""|false|0) ;; *) U=1;; esac; case "$GITHUB_ACTIONS" in ""|false|0) ;; *) U=1;; esac; ' +
  'case "$RULECAST_MODE" in unattended) U=1;; attended|interactive) U=;; esac; ' +
  "if printf '%s' \"$P\" | grep -q '\"hook_event_name\": *\"SessionStart\"'; then printf '%s' " +
  '\'{"systemMessage":"rulecast is configured in this project but not installed. Install it ' +
  "(curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh) or add @syv-ai/rulecast to the project " +
  "(pnpm add -D), then run rulecast doctor.\"}'; " +
  'elif [ -n "$U" ] && printf \'%s\' "$P" | grep -qE \'"hook_event_name": *"(Subagent)?Stop"\'; then printf \'%s\' ' +
  '\'{"systemMessage":"rulecast is configured in this project but not installed: no rules ran this session. ' +
  "Install rulecast before starting the agent: npm ci (or pnpm install), or " +
  "curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh.\"}'; fi; exit 0"

describe("Claude Code settings: mergeHooks", () => {
  test("installs every rulecast hook into empty settings", () => {
    expect(mergeHooks({}, COMMAND, 60_000)).toEqual({
      settings: {
        hooks: {
          PreToolUse: [
            { matcher: "Edit|Write", hooks: [hook(5)] },
            { matcher: "Bash", hooks: [hook(5)] },
            { matcher: "SubagentHandback", hooks: [hook(70)] },
          ],
          PostToolUse: [
            { matcher: "Read", hooks: [hook(5)] },
            { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [hook(5)] },
            { matcher: "Bash", hooks: [hook(5)] },
            { matcher: "EnterWorktree|ExitWorktree", hooks: [hook(5)] },
          ],
          PostToolUseFailure: [
            { matcher: "Read", hooks: [hook(5)] },
            { matcher: "Bash", hooks: [hook(5)] },
          ],
          Stop: [{ hooks: [hook(70)] }],
          SubagentStop: [{ hooks: [hook(70)] }],
          SubagentStart: [{ hooks: [hook(5)] }],
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
        "PostToolUseFailure (Read)",
        "PostToolUse (Edit|Write|MultiEdit|NotebookEdit)",
        "PreToolUse (Bash)",
        "PostToolUse (Bash)",
        "PostToolUseFailure (Bash)",
        "PreToolUse (SubagentHandback)",
        "PostToolUse (EnterWorktree|ExitWorktree)",
        "Stop",
        "SubagentStop",
        "SubagentStart",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
        "SessionStart (clear|fork)",
      ],
      updated: [],
    })
  })

  test("an install whose edit hook has the older Edit|Write matcher has it widened in place, not doubled", () => {
    const once = mergeHooks({}, COMMAND, 60_000).settings
    const hooks = structuredClone(once.hooks) as Record<string, { matcher?: string }[]>
    const edits = hooks.PostToolUse!.find((group) => group.matcher === "Edit|Write|MultiEdit|NotebookEdit")!
    edits.matcher = "Edit|Write"
    const upgraded = mergeHooks({ hooks }, COMMAND, 60_000)
    expect(upgraded.added).toEqual([])
    expect(upgraded.updated).toEqual(["PostToolUse (Edit|Write|MultiEdit|NotebookEdit)"])
    expect(upgraded.settings).toEqual(once)
  })

  test("an older Edit|Write group the user shares is left as it is; rulecast's hook moves to its own group", () => {
    const own = { type: "command", command: "my-format" }
    const once = mergeHooks({}, COMMAND, 60_000).settings
    const hooks = structuredClone(once.hooks) as Record<string, { matcher?: string; hooks: unknown[] }[]>
    const edits = hooks.PostToolUse!.find((group) => group.matcher === "Edit|Write|MultiEdit|NotebookEdit")!
    edits.matcher = "Edit|Write"
    edits.hooks.unshift(own)
    const upgraded = mergeHooks({ hooks }, COMMAND, 60_000)
    expect(upgraded.added).toEqual([])
    expect(upgraded.updated).toEqual(["PostToolUse (Edit|Write|MultiEdit|NotebookEdit)"])
    const post = (upgraded.settings.hooks as Record<string, unknown[]>).PostToolUse
    expect(post).toContainEqual({ matcher: "Edit|Write", hooks: [own] })
    expect(post).toContainEqual({ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [hook(5)] })
    expect(mergeHooks(upgraded.settings, COMMAND, 60_000).updated).toEqual([])
  })

  describe("the write guard (refuse_write)", () => {
    test("without a refuse_write rule to serve, there is no PreToolUse Edit|Write hook", () => {
      const { settings, added } = mergeHooks({}, COMMAND, 60_000, { guard: false })
      expect(added).not.toContain("PreToolUse (Edit|Write)")
      const pre = (settings.hooks as Record<string, { matcher?: string }[]>).PreToolUse!
      expect(pre.map((group) => group.matcher)).toEqual(["Bash", "SubagentHandback"])
    })

    test("an installed guard no longer needed is removed, and a user's own hook in its group kept", () => {
      const own = { type: "command", command: "my-edit-check" }
      const installed = mergeHooks({}, COMMAND, 60_000).settings
      const hooks = structuredClone(installed.hooks) as Record<string, { matcher?: string; hooks: unknown[] }[]>
      hooks.PreToolUse!.find((group) => group.matcher === "Edit|Write")!.hooks.push(own)
      const upgraded = mergeHooks({ hooks }, COMMAND, 60_000, { guard: false })
      expect(upgraded.added).toEqual([])
      expect(upgraded.updated).toEqual(["PreToolUse (Edit|Write) removed"])
      const pre = (upgraded.settings.hooks as Record<string, unknown>).PreToolUse
      expect(pre).toContainEqual({ matcher: "Edit|Write", hooks: [own] })
      // Gone with its group when it was alone there.
      const alone = mergeHooks(installed, COMMAND, 60_000, { guard: false }).settings
      const groups = (alone.hooks as Record<string, { matcher?: string }[]>).PreToolUse!
      expect(groups.map((group) => group.matcher)).toEqual(["Bash", "SubagentHandback"])
      expect(mergeHooks(alone, COMMAND, 60_000, { guard: false }).updated).toEqual([])
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
      { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [hook(5)] },
      { matcher: "Bash", hooks: [hook(5)] },
      { matcher: "EnterWorktree|ExitWorktree", hooks: [hook(5)] },
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
        PostToolUseFailure: hooks.PostToolUseFailure!.filter((group) => group.matcher !== "Bash"),
      },
    }
    const upgraded = mergeHooks(older, COMMAND, 60_000)
    expect(upgraded.added).toEqual(["PreToolUse (Bash)", "PostToolUse (Bash)", "PostToolUseFailure (Bash)"])
    expect(upgraded.updated).toEqual([])
    // The same groups as a fresh install, the added ones after the groups already there.
    const byMatcher = (settings: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(settings.hooks as Record<string, { matcher?: string }[]>).map(([event, groups]) => [
          event,
          [...groups].sort((a, b) => String(a.matcher).localeCompare(String(b.matcher))),
        ]),
      )
    expect(byMatcher(upgraded.settings)).toEqual(byMatcher(once))
  })

  test("the guard from before #29 is rewritten in place to HOOK_COMMAND", () => {
    const previous =
      'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; ' +
      "grep -q '\"hook_event_name\": *\"SessionStart\"' && printf '%s' '{}'; exit 0"
    const older = mergeHooks({}, previous, 60_000).settings
    const upgraded = mergeHooks(older, HOOK_COMMAND, 60_000)
    expect(upgraded.added).toEqual([])
    expect(upgraded.updated).toContain("Stop")
    expect(upgraded.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
  })

  test("a released guard and a bare node_modules command are rewritten to HOOK_COMMAND", () => {
    // v0.4 and v0.5 committed the first; the second is from before any guard.
    const released =
      'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; ' +
      `grep -q '"hook_event_name": *"SessionStart"' && printf '%s' '{"systemMessage":"not installed"}'; exit 0`
    const unguarded = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    for (const older of [released, unguarded, COMMAND]) {
      const upgraded = mergeHooks(mergeHooks({}, older, 60_000).settings, HOOK_COMMAND, 60_000)
      expect(upgraded.added).toEqual([])
      expect(upgraded.updated).toContain("Stop")
      expect(upgraded.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
    }
  })

  test("0.10's inline command is rewritten to the script command in every group", () => {
    const older = mergeHooks({}, V0_10_COMMAND, 60_000).settings
    const upgraded = mergeHooks(older, HOOK_COMMAND, 60_000)
    expect(upgraded.added).toEqual([])
    expect(upgraded.updated).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).added)
    expect(upgraded.updated).toHaveLength(15)
    expect(upgraded.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
    expect(JSON.stringify(upgraded.settings)).not.toContain("P=$(cat)")
    expect(mergeHooks(upgraded.settings, HOOK_COMMAND, 60_000)).toEqual({
      settings: upgraded.settings,
      added: [],
      updated: [],
    })
  })

  test("a user's own hook in the same group is kept when rulecast's is rewritten", () => {
    const own = { type: "command", command: "dash-hook stop" }
    const older = {
      hooks: {
        ...(mergeHooks({}, V0_10_COMMAND, 60_000).settings.hooks as Record<string, unknown>),
        Stop: [{ hooks: [own, { type: "command", command: V0_10_COMMAND, timeout: 70 }] }],
      },
    }
    const upgraded = mergeHooks(older, HOOK_COMMAND, 60_000)
    expect(upgraded.added).toEqual([])
    expect((upgraded.settings.hooks as Record<string, unknown>).Stop).toEqual([
      { hooks: [own, { type: "command", command: HOOK_COMMAND, timeout: 70 }] },
    ])
  })

  test("the script command counts as rulecast's, and removeHooks takes it out", () => {
    const once = mergeHooks({}, HOOK_COMMAND, 60_000).settings
    expect(mergeHooks(once, COMMAND, 60_000).added).toEqual([])
    expect(removeHooks(once).settings).toEqual({})
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => mergeHooks(bad, COMMAND, 60_000)).toThrow(SettingsError)
  })
})

describe("Claude Code settings: hook timeouts", () => {
  const stopTimeouts = (settings: unknown) => {
    const hooks = (settings as { hooks: Record<string, { hooks: { timeout: number }[] }[]> }).hooks
    return [hooks.Stop?.[0]?.hooks[0]?.timeout, hooks.SubagentStop?.[0]?.hooks[0]?.timeout]
  }

  test("a raised verify_ms raises the stop hooks' timeout, reported as updated (plan 21, #2)", () => {
    // Claude Code kills a hook at its timeout: a stop check budgeted 300 s and killed at 70 s
    // is silently skipped.
    const installed = mergeHooks({}, HOOK_COMMAND, 60_000).settings
    expect(stopTimeouts(installed)).toEqual([70, 70])
    const raised = mergeHooks(installed, HOOK_COMMAND, 300_000)
    expect(stopTimeouts(raised.settings)).toEqual([310, 310])
    expect(raised.added).toEqual([])
    expect(raised.updated).toEqual(["PreToolUse (SubagentHandback)", "Stop", "SubagentStop"])
  })

  test("a stop hook with no timeout, or one that is not a number, gets the one it needs", () => {
    // Without a timeout Claude Code applies its own default, which knows nothing of verify_ms.
    const installed = mergeHooks({}, HOOK_COMMAND, 300_000).settings as {
      hooks: Record<string, { hooks: Record<string, unknown>[] }[]>
    }
    delete installed.hooks.Stop?.[0]?.hooks[0]?.timeout
    const subagent = installed.hooks.SubagentStop?.[0]?.hooks[0]
    if (subagent) subagent.timeout = "70"
    const merged = mergeHooks(installed, HOOK_COMMAND, 300_000)
    expect(stopTimeouts(merged.settings)).toEqual([310, 310])
    expect(merged.updated).toEqual(["Stop", "SubagentStop"])
  })

  test("a timeout above what is needed is kept: install sizes it for the largest verify_ms of every config", () => {
    const installed = mergeHooks({}, HOOK_COMMAND, 300_000).settings
    const lowered = mergeHooks(installed, HOOK_COMMAND, 60_000)
    expect(lowered.updated).toEqual([])
    expect(lowered.settings).toEqual(installed)
  })
})

describe("Claude Code settings: removeHooks", () => {
  const dash = { type: "command", command: "dash-hook stop" }

  test("removes everything mergeHooks added", () => {
    expect(removeHooks(mergeHooks({}, COMMAND, 60_000).settings)).toEqual({
      settings: {},
      removed: [
        "PreToolUse (Edit|Write)",
        "PreToolUse (Bash)",
        "PreToolUse (SubagentHandback)",
        "PostToolUse (Read)",
        "PostToolUse (Edit|Write|MultiEdit|NotebookEdit)",
        "PostToolUse (Bash)",
        "PostToolUse (EnterWorktree|ExitWorktree)",
        "PostToolUseFailure (Read)",
        "PostToolUseFailure (Bash)",
        "Stop",
        "SubagentStop",
        "SubagentStart",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
        "SessionStart (clear|fork)",
      ],
    })
  })

  test("keeps every other setting, group and hook, and does not mutate its input", () => {
    const existing = {
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: {
        PostToolUse: [{ matcher: "Read", hooks: [dash, hook(5)] }],
        Stop: [{ hooks: [dash] }],
        Notification: [],
      },
    }
    const merged = mergeHooks(existing, COMMAND, 60_000).settings
    const input = structuredClone(merged)
    const { settings, removed } = removeHooks(input)
    expect(input).toEqual(merged)
    expect(settings).toEqual({
      permissions: existing.permissions,
      hooks: { PostToolUse: [{ matcher: "Read", hooks: [dash] }], Stop: [{ hooks: [dash] }], Notification: [] },
    })
    expect(removed).toContain("PostToolUse (Read)")
  })

  test("settings without rulecast hooks come back unchanged", () => {
    const settings = { hooks: { Stop: [{ hooks: [dash] }] } }
    expect(removeHooks(settings)).toEqual({ settings, removed: [] })
    expect(removeHooks({})).toEqual({ settings: {}, removed: [] })
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => removeHooks(bad)).toThrow(SettingsError)
  })
})
