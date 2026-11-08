import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import { HOOK_COMMAND, HOOK_SCRIPT, HOOK_SCRIPT_FILE } from "../../src/adapters/claude-code/hook-script"
import { mergeHooks } from "../../src/adapters/claude-code/settings"
import { type FileReader, planHooks } from "../../src/core/hook-plan"

const SHARED = ".claude/settings.json"
const PERSONAL = ".claude/settings.local.json"

/** 0.10's inline command, shortened: any older form counts as rulecast's and is upgraded the same way. */
const OLDER = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'

const settingsText = (command: string) => `${JSON.stringify(mergeHooks({}, command, 60_000).settings, null, 2)}\n`

/** A reader over an in-memory project: repo-relative path → text. */
const reader =
  (files: Record<string, string>): FileReader =>
  async (file) =>
    file in files ? { text: files[file]! } : null

const plan = (files: Record<string, string>, scope: "shared" | "personal" = "shared") =>
  planHooks(reader(files), claudeCodeAdapter, scope, 60_000)

describe("planHooks: the hook script", () => {
  test("a fresh install plans the settings and the script", async () => {
    const { state, write } = await plan({})
    expect(state).toBeNull()
    expect(write?.file).toBe(SHARED)
    expect(write?.created).toBe(true)
    expect(write?.added).toHaveLength(11)
    expect(write?.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
    expect(write?.files).toEqual([{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: true }])
  })

  test("older settings and no script: stale alone, and the write rewrites the commands and adds the script", async () => {
    const { state, write } = await plan({ [SHARED]: settingsText(OLDER) })
    expect(state?.stale).toHaveLength(11)
    expect(state?.missing).toEqual([])
    // Hooks still on an older command do not run the script: its absence is not their problem yet.
    expect(state?.files).toEqual([])
    expect(write?.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
    expect(write?.updated).toHaveLength(11)
    expect(write?.files).toEqual([{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: true }])
  })

  test("current settings and the script missing: the script alone is written", async () => {
    const { state, write } = await plan({ [SHARED]: settingsText(HOOK_COMMAND) })
    expect(state).toEqual({
      file: SHARED,
      stale: [],
      missing: [],
      files: [{ file: HOOK_SCRIPT_FILE, problem: "missing" }],
    })
    expect(write).toEqual({
      file: SHARED,
      settings: null,
      created: false,
      added: [],
      updated: [],
      files: [{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: true }],
    })
  })

  test("hooks on the script command with only their timeouts stale still have a missing script reported", async () => {
    // Sized for a 60 s verify, planned for 300 s: Stop and SubagentStop are stale on timeout alone.
    const { state, write } = await planHooks(
      reader({ [SHARED]: settingsText(HOOK_COMMAND) }),
      claudeCodeAdapter,
      "shared",
      300_000,
    )
    expect(state?.stale.length).toBeGreaterThan(0)
    // Every hook already runs the script, so without it every one of them fails.
    expect(state?.files).toEqual([{ file: HOOK_SCRIPT_FILE, problem: "missing" }])
    expect(write?.files).toEqual([{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: true }])
  })

  test("a script that differs, by a byte, is reported and rewritten", async () => {
    const { state, write } = await plan({
      [SHARED]: settingsText(HOOK_COMMAND),
      [HOOK_SCRIPT_FILE]: `${HOOK_SCRIPT}\n`,
    })
    expect(state?.files).toEqual([{ file: HOOK_SCRIPT_FILE, problem: "differs" }])
    expect(write?.settings).toBeNull()
    expect(write?.files).toEqual([{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: false }])
  })

  test("everything current: nothing to write", async () => {
    const { state, write } = await plan({ [SHARED]: settingsText(HOOK_COMMAND), [HOOK_SCRIPT_FILE]: HOOK_SCRIPT })
    expect(state).toEqual({ file: SHARED, stale: [], missing: [], files: [] })
    expect(write).toBeNull()
  })

  test("hooks in the personal settings still have their script checked", async () => {
    const { state, write } = await plan({ [PERSONAL]: settingsText(HOOK_COMMAND) })
    expect(state).toEqual({
      file: PERSONAL,
      stale: [],
      missing: [],
      files: [{ file: HOOK_SCRIPT_FILE, problem: "missing" }],
    })
    expect(write?.file).toBe(PERSONAL)
    expect(write?.files.map((each) => each.file)).toEqual([HOOK_SCRIPT_FILE])
  })

  test("settings that are not JSON are named in the error", async () => {
    await expect(plan({ [SHARED]: "{" })).rejects.toThrow(/^\.claude\/settings\.json: /)
  })
})
