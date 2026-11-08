import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { adapterByName } from "../../src/adapters"
import { HOOK_COMMAND, HOOK_SCRIPT, HOOK_SCRIPT_FILE } from "../../src/adapters/claude-code/hook-script"
import { CONFIG_FILE } from "../../src/core/config/load"
import { addCatalogRules, newConfigText, setSettings } from "../../src/init/config-text"
import { type PlanContext, PlanError, planInit, reviewText } from "../../src/init/plan"

const claude = adapterByName("claude-code")!
const install = claude.install!
const settings = { conventions: "docs/conventions/", llmModel: "haiku" }

/** Settings as install.merge would write them. */
const merged = (settings: unknown) =>
  `${JSON.stringify(install.merge(settings, install.command, 60000).settings, null, 2)}\n`

/** The hook script, as init plans it beside the settings. */
const script = (commit: boolean) => ({
  file: HOOK_SCRIPT_FILE,
  content: HOOK_SCRIPT,
  created: true,
  summary: "hook script (Claude Code)",
  commit,
})

function context(files: Record<string, string>, overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    configText: files[CONFIG_FILE] ?? null,
    verifyMs: 60000,
    readText: async (file) => files[file] ?? null,
    ...overrides,
  }
}

describe("planInit", () => {
  test("a new project gets a config and shared hooks", async () => {
    const changes = await planInit(
      { hooks: [], catalog: null, settings, agents: [{ adapter: claude, scope: "shared" }] },
      context({}),
    )
    expect(changes).toEqual([
      {
        file: CONFIG_FILE,
        content: newConfigText([], settings),
        created: true,
        summary: "new, conventions, llm",
        commit: true,
      },
      {
        file: ".claude/settings.json",
        content: merged({}),
        created: true,
        summary: "+11 hooks (Claude Code)",
        commit: true,
      },
      script(true),
    ])
  })

  test("personal scope merges into existing settings and is not for committing", async () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "dash stop" }] }] }, model: "opus" }
    const files = {
      [CONFIG_FILE]: newConfigText([], settings),
      ".claude/settings.local.json": JSON.stringify(existing),
    }
    const changes = await planInit(
      { hooks: [], catalog: null, settings, agents: [{ adapter: claude, scope: "personal" }] },
      context(files),
    )
    expect(changes).toEqual([
      {
        file: ".claude/settings.local.json",
        content: merged(existing),
        created: false,
        summary: "+11 hooks (Claude Code)",
        commit: false,
      },
      script(false),
    ])
    expect(changes[0]!.content).toContain(JSON.stringify(HOOK_COMMAND))
  })

  test("settings current and the script missing: only the script is planned", async () => {
    const files = { [CONFIG_FILE]: newConfigText([], settings), ".claude/settings.json": merged({}) }
    const selections = { hooks: [], catalog: null, settings, agents: [{ adapter: claude, scope: "shared" as const }] }
    expect(await planInit(selections, context(files))).toEqual([script(true)])
    const edited = await planInit(selections, context({ ...files, [HOOK_SCRIPT_FILE]: "echo edited\n" }))
    expect(edited).toEqual([{ ...script(true), created: false }])
  })

  test("re-running changes nothing that is already there", async () => {
    const files = {
      [CONFIG_FILE]: newConfigText([], settings),
      ".claude/settings.local.json": merged({}),
      [HOOK_SCRIPT_FILE]: HOOK_SCRIPT,
    }
    const selections = { hooks: [], catalog: null, settings, agents: [{ adapter: claude, scope: "shared" as const }] }
    expect(await planInit(selections, context(files))).toEqual([])
  })

  test("settings are added to an existing config", async () => {
    const files = { [CONFIG_FILE]: newConfigText() }
    const [change] = await planInit(
      { hooks: [], catalog: null, settings: { llmModel: "haiku" }, agents: [] },
      context(files),
    )
    expect(change).toMatchObject({ file: CONFIG_FILE, created: false, summary: "+llm.model haiku" })
    expect(change!.content).toContain("model: haiku")
  })

  test("the weekly summary is named for a new config, and as a change for an existing one", async () => {
    const created = await planInit(
      { hooks: [], catalog: null, settings: { weeklySummary: true }, agents: [] },
      context({}),
    )
    expect(created[0]).toMatchObject({ created: true, summary: "new, stats" })
    const files = { [CONFIG_FILE]: "stats:\n  weekly_summary: false\nrepos: []\n" }
    const [change] = await planInit(
      { hooks: [], catalog: null, settings: { weeklySummary: true }, agents: [] },
      context(files),
    )
    expect(change!.summary).toBe("stats.weekly_summary false → true")
  })

  test("a replaced setting is named with its old value; an unchanged one is not named", async () => {
    const files = { [CONFIG_FILE]: newConfigText([], { conventions: "docs/old/", llmModel: "haiku" }) }
    const [change] = await planInit(
      { hooks: [], catalog: null, settings: { conventions: "docs/new/", llmModel: "haiku" }, agents: [] },
      context(files),
    )
    expect(change!.summary).toBe("conventions docs/old/ → docs/new/")
  })

  test("with nothing chosen a new config has only the local repo", async () => {
    const [change] = await planInit({ hooks: [], catalog: null, settings: {}, agents: [] }, context({}))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: true, summary: "new, no rules yet" })
  })

  test("catalog rules go into a new config and an existing one", async () => {
    const ref = { url: "https://github.com/syv-ai/rulecast", rev: "v0.9.0" }
    const catalog = {
      ref,
      rules: [
        { id: "python/no-silent-except", context: null, files: null },
        { id: "generated-code", context: null, files: "x|^web/client/" },
      ],
    }
    const [created] = await planInit({ hooks: [], catalog, settings: {}, agents: [] }, context({}))
    expect(created).toMatchObject({ created: true, summary: "new, 2 catalog rules" })
    expect(parse(created!.content).repos).toEqual([
      { repo: "local", rules: [] },
      {
        repo: ref.url,
        rev: "v0.9.0",
        rules: [{ id: "python/no-silent-except" }, { id: "generated-code", files: "x|^web/client/" }],
      },
    ])

    const [changed] = await planInit(
      { hooks: [], catalog, settings: { llmModel: "haiku" }, agents: [] },
      context({ [CONFIG_FILE]: newConfigText() }),
    )
    expect(changed).toMatchObject({ created: false, summary: "+2 catalog rules, +llm.model haiku" })
    expect(changed!.content).toBe(
      addCatalogRules(setSettings(newConfigText(), { llmModel: "haiku" }).text, ref, catalog.rules),
    )
    // Planned again on what it wrote, nothing changes.
    const again = await planInit(
      { hooks: [], catalog, settings: {}, agents: [] },
      context({ [CONFIG_FILE]: created!.content }),
    )
    expect(again).toEqual([])
  })

  test("unreadable settings name their file", async () => {
    const files = { ".claude/settings.json": "{ nope" }
    const selections = {
      hooks: [],
      catalog: null,
      settings: {},
      agents: [{ adapter: claude, scope: "shared" as const }],
    }
    await expect(planInit(selections, context(files))).rejects.toThrow(PlanError)
    await expect(planInit(selections, context(files))).rejects.toThrow(/^\.claude\/settings\.json: /)
  })
})

test("reviewText aligns one line per file", () => {
  expect(
    reviewText([
      { file: CONFIG_FILE, content: "", created: true, summary: "new, 2 rules", commit: true },
      { file: ".claude/settings.json", content: "", created: true, summary: "+7 hooks (Claude Code)", commit: true },
      script(true),
    ]),
  ).toBe(
    ".rulecast-config.yaml      new, 2 rules\n" +
      ".claude/settings.json      +7 hooks (Claude Code)\n" +
      ".claude/hooks/rulecast.sh  hook script (Claude Code)",
  )
})
