import { describe, expect, test } from "vitest"

import { adapterByName } from "../../src/adapters"
import { CONFIG_FILE } from "../../src/core/config/load"
import { newConfigText, type RuleSelection } from "../../src/init/config-text"
import { type PlanContext, PlanError, planInit, reviewText } from "../../src/init/plan"

const claude = adapterByName("claude-code")!
const install = claude.install!
const catalog = { url: "https://github.com/syv-ai/rulecast", rev: "v0.2.0" }
const rules: RuleSelection[] = [
  { id: "python/layering", context: null },
  { id: "python/no-httpexception-in-services", context: ["@AGENTS.md#errors"] },
]

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
    const changes = await planInit({ catalog, rules, agents: [{ adapter: claude, scope: "shared" }] }, context({}))
    expect(changes).toEqual([
      {
        file: CONFIG_FILE,
        content: newConfigText(catalog, rules),
        created: true,
        summary: "new, 2 rules from syv-ai/rulecast@v0.2.0",
        commit: true,
      },
      {
        file: ".claude/settings.json",
        content: merged({}),
        created: true,
        summary: "+7 hooks (Claude Code)",
        commit: true,
      },
    ])
  })

  test("personal scope merges into existing settings and is not for committing", async () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "dash stop" }] }] }, model: "opus" }
    const files = {
      [CONFIG_FILE]: newConfigText(catalog, rules),
      ".claude/settings.local.json": JSON.stringify(existing),
    }
    const changes = await planInit(
      { catalog, rules: [], agents: [{ adapter: claude, scope: "personal" }] },
      context(files, { local: true }),
    )
    expect(changes).toEqual([
      {
        file: ".claude/settings.local.json",
        content: merged(existing, true),
        created: false,
        summary: "+7 hooks (Claude Code)",
        commit: false,
      },
    ])
    expect(changes[0]!.content).toContain("node_modules/.bin/rulecast hook claude-code")
  })

  test("re-running changes nothing that is already there", async () => {
    const files = {
      [CONFIG_FILE]: newConfigText(catalog, rules),
      ".claude/settings.local.json": merged({}),
    }
    const selections = { catalog, rules: [], agents: [{ adapter: claude, scope: "shared" as const }] }
    expect(await planInit(selections, context(files))).toEqual([])
  })

  test("new catalog rules are added to an existing config", async () => {
    const files = { [CONFIG_FILE]: newConfigText(catalog, [rules[0]!]) }
    const [change] = await planInit({ catalog, rules: [rules[1]!], agents: [] }, context(files))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: false, summary: "+1 rule from syv-ai/rulecast@v0.2.0" })
    expect(change!.content).toBe(newConfigText(catalog, rules))
  })

  test("without a catalog a new config has only the local repo", async () => {
    const [change] = await planInit({ catalog: null, rules: [], agents: [] }, context({}))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: true, summary: "new, no rules yet" })
  })

  test("unreadable settings name their file", async () => {
    const files = { ".claude/settings.json": "{ nope" }
    const selections = { catalog: null, rules: [], agents: [{ adapter: claude, scope: "shared" as const }] }
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
