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
      others: [],
      allRun: true,
    })
    expect(write).toEqual({
      file: SHARED,
      settings: null,
      created: false,
      added: [],
      updated: [],
      files: [{ file: HOOK_SCRIPT_FILE, content: HOOK_SCRIPT, created: true }],
      others: [],
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
    expect(state).toEqual({ file: SHARED, stale: [], missing: [], files: [], others: [], allRun: true })
    expect(write).toBeNull()
  })

  test("hooks in the personal settings still have their script checked", async () => {
    const { state, write } = await plan({ [PERSONAL]: settingsText(HOOK_COMMAND) })
    expect(state).toEqual({
      file: PERSONAL,
      stale: [],
      missing: [],
      files: [{ file: HOOK_SCRIPT_FILE, problem: "missing" }],
      others: [],
      allRun: true,
    })
    expect(write?.file).toBe(PERSONAL)
    expect(write?.files.map((each) => each.file)).toEqual([HOOK_SCRIPT_FILE])
  })

  test("settings that are not JSON are named in the error", async () => {
    await expect(plan({ [SHARED]: "{" })).rejects.toThrow(/^\.claude\/settings\.json: /)
  })
})

describe("planHooks: rulecast's hooks in more than one settings file", () => {
  const current = settingsText(HOOK_COMMAND)
  const older = settingsText(OLDER)

  test("both on an older command: the file install reports upgrades, and so does the other", async () => {
    const { state, write } = await plan({ [SHARED]: older, [PERSONAL]: older })
    expect(state?.file).toBe(SHARED)
    expect(state?.stale).toHaveLength(11)
    expect(state?.others).toEqual([{ file: PERSONAL, stale: expect.arrayContaining(["Stop"]) }])
    expect(write?.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
    expect(write?.others).toHaveLength(1)
    expect(write?.others[0]?.file).toBe(PERSONAL)
    expect(write?.others[0]?.updated).toHaveLength(11)
    expect(write?.others[0]?.settings).toEqual(mergeHooks({}, HOOK_COMMAND, 60_000).settings)
  })

  test("the shared file current and the personal one older: only the personal one is written", async () => {
    const { state, write } = await plan({ [SHARED]: current, [PERSONAL]: older, [HOOK_SCRIPT_FILE]: HOOK_SCRIPT })
    expect(state?.stale).toEqual([])
    expect(state?.others.map((other) => other.file)).toEqual([PERSONAL])
    expect(write?.file).toBe(SHARED)
    expect(write?.settings).toBeNull()
    expect(write?.others.map((other) => other.file)).toEqual([PERSONAL])
  })

  test("a timeout too short in the other file is stale too", async () => {
    const short = settingsText(HOOK_COMMAND).replace(/"timeout": 70/g, '"timeout": 5')
    const { state, write } = await plan({ [SHARED]: current, [PERSONAL]: short, [HOOK_SCRIPT_FILE]: HOOK_SCRIPT })
    expect(state?.others).toEqual([{ file: PERSONAL, stale: ["Stop", "SubagentStop"] }])
    expect(write?.others[0]?.updated).toEqual(["Stop", "SubagentStop"])
  })

  test("both current is fine: Claude Code runs identical handlers once", async () => {
    const { state, write } = await plan({ [SHARED]: current, [PERSONAL]: current, [HOOK_SCRIPT_FILE]: HOOK_SCRIPT })
    expect(state?.others).toEqual([])
    expect(write).toBeNull()
  })

  test("a partial install in the other file is upgraded, not filled in, and other tools' hooks stay", async () => {
    const partial = {
      theme: "dark",
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: OLDER, timeout: 70 }] },
          { hooks: [{ type: "command", command: "dash-hook stop" }] },
        ],
      },
    }
    const { write } = await plan({
      [SHARED]: current,
      [PERSONAL]: JSON.stringify(partial),
      [HOOK_SCRIPT_FILE]: HOOK_SCRIPT,
    })
    expect(write?.others).toEqual([
      {
        file: PERSONAL,
        updated: ["Stop"],
        settings: {
          theme: "dark",
          hooks: {
            Stop: [
              { hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 70 }] },
              { hooks: [{ type: "command", command: "dash-hook stop" }] },
            ],
          },
        },
      },
    ])
  })

  test("a settings file with no rulecast hooks is left out", async () => {
    const theirs = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "dash-hook stop" }] }] } })
    const { state, write } = await plan({ [SHARED]: current, [PERSONAL]: theirs, [HOOK_SCRIPT_FILE]: HOOK_SCRIPT })
    expect(state?.others).toEqual([])
    expect(write).toBeNull()
  })

  test("allRun: whether every rulecast hook in every file runs the current command", async () => {
    expect((await plan({ [SHARED]: current, [PERSONAL]: current })).state?.allRun).toBe(true)
    expect((await plan({ [SHARED]: current, [PERSONAL]: older })).state?.allRun).toBe(false)
  })

  test("the script is the problem of any file whose hooks run it", async () => {
    // The shared file on an older command does not run the script; the personal one does.
    const { state } = await plan({ [SHARED]: older, [PERSONAL]: current })
    expect(state?.files).toEqual([{ file: HOOK_SCRIPT_FILE, problem: "missing" }])
  })
})
