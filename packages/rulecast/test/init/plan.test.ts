import { describe, expect, test } from "vitest"

import { adapterByName } from "../../src/adapters"
import { CONFIG_FILE } from "../../src/core/config/load"
import { newConfigText } from "../../src/init/config-text"
import { type PlanContext, PlanError, planInit, reviewText } from "../../src/init/plan"

const claude = adapterByName("claude-code")!
const install = claude.install!
const settings = { conventions: "docs/conventions/", llmModel: "haiku" }

/** Settings as install.merge would write them. */
const merged = (settings: unknown, local = false) =>
  `${JSON.stringify(install.merge(settings, install.command(local), 60000).settings, null, 2)}\n`

function context(files: Record<string, string>, overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    configText: files[CONFIG_FILE] ?? null,
    verifyMs: 60000,
    local: false,
    readText: async (file) => files[file] ?? null,
    ...overrides,
  }
}

describe("planInit", () => {
  test("a new project gets a config and shared hooks", async () => {
    const changes = await planInit({ hooks: [], settings, agents: [{ adapter: claude, scope: "shared" }] }, context({}))
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
    ])
  })

  test("personal scope merges into existing settings and is not for committing", async () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "dash stop" }] }] }, model: "opus" }
    const files = {
      [CONFIG_FILE]: newConfigText([], settings),
      ".claude/settings.local.json": JSON.stringify(existing),
    }
    const changes = await planInit(
      { hooks: [], settings, agents: [{ adapter: claude, scope: "personal" }] },
      context(files, { local: true }),
    )
    expect(changes).toEqual([
      {
        file: ".claude/settings.local.json",
        content: merged(existing, true),
        created: false,
        summary: "+11 hooks (Claude Code)",
        commit: false,
      },
    ])
    expect(changes[0]!.content).toContain("node_modules/.bin/rulecast; [ -x")
  })

  test("re-running changes nothing that is already there", async () => {
    const files = {
      [CONFIG_FILE]: newConfigText([], settings),
      ".claude/settings.local.json": merged({}),
    }
    const selections = { hooks: [], settings, agents: [{ adapter: claude, scope: "shared" as const }] }
    expect(await planInit(selections, context(files))).toEqual([])
  })

  test("settings are added to an existing config", async () => {
    const files = { [CONFIG_FILE]: newConfigText() }
    const [change] = await planInit({ hooks: [], settings: { llmModel: "haiku" }, agents: [] }, context(files))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: false, summary: "+llm.model haiku" })
    expect(change!.content).toContain("model: haiku")
  })

  test("the weekly summary is named for a new config, and as a change for an existing one", async () => {
    const created = await planInit({ hooks: [], settings: { weeklySummary: true }, agents: [] }, context({}))
    expect(created[0]).toMatchObject({ created: true, summary: "new, stats" })
    const files = { [CONFIG_FILE]: "stats:\n  weekly_summary: false\nrepos: []\n" }
    const [change] = await planInit({ hooks: [], settings: { weeklySummary: true }, agents: [] }, context(files))
    expect(change!.summary).toBe("stats.weekly_summary false → true")
  })

  test("a replaced setting is named with its old value; an unchanged one is not named", async () => {
    const files = { [CONFIG_FILE]: newConfigText([], { conventions: "docs/old/", llmModel: "haiku" }) }
    const [change] = await planInit(
      { hooks: [], settings: { conventions: "docs/new/", llmModel: "haiku" }, agents: [] },
      context(files),
    )
    expect(change!.summary).toBe("conventions docs/old/ → docs/new/")
  })

  test("with nothing chosen a new config has only the local repo", async () => {
    const [change] = await planInit({ hooks: [], settings: {}, agents: [] }, context({}))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: true, summary: "new, no rules yet" })
  })

  test("unreadable settings name their file", async () => {
    const files = { ".claude/settings.json": "{ nope" }
    const selections = { hooks: [], settings: {}, agents: [{ adapter: claude, scope: "shared" as const }] }
    await expect(planInit(selections, context(files))).rejects.toThrow(PlanError)
    await expect(planInit(selections, context(files))).rejects.toThrow(/^\.claude\/settings\.json: /)
  })
})

test("reviewText aligns one line per file", () => {
  expect(
    reviewText([
      { file: CONFIG_FILE, content: "", created: true, summary: "new, 2 rules", commit: true },
      { file: ".claude/settings.json", content: "", created: true, summary: "+7 hooks (Claude Code)", commit: true },
    ]),
  ).toBe(".rulecast-config.yaml  new, 2 rules\n.claude/settings.json  +7 hooks (Claude Code)")
})
