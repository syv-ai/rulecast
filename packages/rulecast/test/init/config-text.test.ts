import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import {
  addCatalogRules,
  ConfigTextError,
  newConfigText,
  type RuleSelection,
  setSettings,
} from "../../src/init/config-text"

const catalog = { url: "https://github.com/syv-ai/rulecast", rev: "v0.2.0" }
const rules: RuleSelection[] = [
  { id: "generated-code", context: null, files: null },
  { id: "python/layering", context: ["@AGENTS.md#services"], files: null },
]

const NEW_RULES = [
  "      - id: generated-code",
  "      - id: python/layering",
  "        context:",
  '          - "@AGENTS.md#services"',
]

describe("newConfigText", () => {
  test("with nothing chosen it writes an empty local repo", () => {
    expect(newConfigText()).toBe(
      [
        "# rulecast config: https://github.com/syv-ai/rulecast",
        "# Rules from rule repos are pinned by rev; add your own rules under repo: local.",
        "repos:",
        "  - repo: local",
        "    rules: []",
        "",
      ].join("\n"),
    )
  })

  test("the interview's settings go before repos", () => {
    const text = newConfigText([], { conventions: "docs/conventions/", llmModel: "haiku", llmProvider: "opencode" })
    expect(text).toContain("conventions: docs/conventions/\nllm:\n  provider: opencode\n  model: haiku\nrepos:\n")
    expect(parse(text)).toMatchObject({
      conventions: "docs/conventions/",
      llm: { model: "haiku", provider: "opencode" },
    })
  })

  test("a new config with the weekly summary on", () => {
    const text = newConfigText([], { llmModel: "haiku", weeklySummary: true })
    expect(text).toContain("llm:\n  model: haiku\nstats:\n  weekly_summary: true\nrepos:\n")
    expect(parse(text)).toMatchObject({ stats: { weekly_summary: true } })
    expect(newConfigText([], { weeklySummary: false })).not.toContain("stats")
  })
})

describe("setSettings", () => {
  const LONG = `    rules: []  # ${"a long comment that runs well past eighty columns, ".repeat(2)}\n`

  test("adds settings above repos and changes no other byte", () => {
    const text = `# ours\nfiles: x   # spaced comment\nrepos:\n  - repo: local\n${LONG}`
    const { text: updated, changes } = setSettings(text, { llmModel: "haiku", conventions: "docs/c.md" })
    expect(updated).toBe(
      `# ours\nfiles: x   # spaced comment\nconventions: docs/c.md\nllm:\n  model: haiku\nrepos:\n  - repo: local\n${LONG}`,
    )
    expect(changes).toEqual([
      { key: "conventions", from: null, to: "docs/c.md" },
      { key: "llm.model", from: null, to: "haiku" },
    ])
  })

  test("adds model to an existing llm block, keeping its provider and comment", () => {
    const text = "llm:\n  provider: opencode   # keep\nrepos: []\n"
    const { text: updated } = setSettings(text, { llmModel: "haiku" })
    expect(updated).toBe("llm:\n  model: haiku\n  provider: opencode   # keep\nrepos: []\n")
  })

  test("replaces a different value in place and says what it was", () => {
    const text = "conventions: docs/old/   # where they go\nllm:\n  model: sonnet\nrepos: []\n"
    const { text: updated, changes } = setSettings(text, { conventions: "docs/new/", llmModel: "haiku" })
    expect(updated).toBe("conventions: docs/new/   # where they go\nllm:\n  model: haiku\nrepos: []\n")
    expect(changes).toEqual([
      { key: "conventions", from: "docs/old/", to: "docs/new/" },
      { key: "llm.model", from: "sonnet", to: "haiku" },
    ])
  })

  test("fills an empty value, with or without a comment after it", () => {
    expect(setSettings("conventions:\nrepos: []\n", { conventions: "docs/x/" }).text).toBe(
      "conventions: docs/x/\nrepos: []\n",
    )
    const commented = setSettings("conventions: # later\nllm:\n  model: # pick\nrepos: []\n", {
      conventions: "docs/x/",
      llmModel: "haiku",
    })
    expect(commented.text).toBe("conventions: docs/x/ # later\nllm:\n  model: haiku # pick\nrepos: []\n")
    expect(parse(commented.text)).toMatchObject({ conventions: "docs/x/", llm: { model: "haiku" } })
    // An empty or null value was never set: it is reported as added, not replaced.
    expect(commented.changes.map((change) => change.from)).toEqual([null, null])
    expect(setSettings("conventions: ~\nrepos: []\n", { conventions: "docs/x/" }).changes).toEqual([
      { key: "conventions", from: null, to: "docs/x/" },
    ])
  })

  test("replaces a block scalar, keeping the line break after it", () => {
    const { text } = setSettings("conventions: |\n  docs/a/\nrepos: []\n", { conventions: "docs/b/" })
    expect(text).toBe("conventions: docs/b/\nrepos: []\n")
  })

  test("new lines follow a CRLF file's line endings", () => {
    const text = "# mine\r\nconventions: docs/old/\r\nrepos: []\r\n"
    const updated = setSettings(text, { llmModel: "haiku", llmProvider: "anthropic" }).text
    expect(updated).toBe(
      "# mine\r\nconventions: docs/old/\r\nllm:\r\n  provider: anthropic\r\n  model: haiku\r\nrepos: []\r\n",
    )
  })

  test("leaves the text alone when nothing changes", () => {
    const text = "conventions: docs/old.md\nrepos: [] # flow is fine here\n"
    expect(setSettings(text, { conventions: "docs/old.md" })).toEqual({ text, changes: [] })
    expect(setSettings(text, {})).toEqual({ text, changes: [] })
  })

  test("refuses an llm block it cannot add to without rewriting it", () => {
    expect(() => setSettings("llm: { provider: opencode }\nrepos: []\n", { llmModel: "haiku" })).toThrow(
      ConfigTextError,
    )
    expect(() => setSettings("stats: { weekly_summary: false }\nrepos: []\n", { weeklySummary: true })).toThrow(
      ConfigTextError,
    )
  })

  test("setSettings adds stats.weekly_summary to a config without stats, replaces false, and leaves true alone", () => {
    const added = setSettings("# mine\nrepos: []\n", { weeklySummary: true })
    expect(added.text).toBe("# mine\nstats:\n  weekly_summary: true\nrepos: []\n")
    expect(added.changes).toEqual([{ key: "stats.weekly_summary", from: null, to: "true" }])

    const replaced = setSettings("stats:\n  weekly_summary: false   # later\nrepos: []\n", { weeklySummary: true })
    expect(replaced.text).toBe("stats:\n  weekly_summary: true   # later\nrepos: []\n")
    expect(replaced.changes).toEqual([{ key: "stats.weekly_summary", from: "false", to: "true" }])

    expect(setSettings(replaced.text, { weeklySummary: true })).toEqual({ text: replaced.text, changes: [] })
    // Without the flag init never writes or removes the key.
    expect(setSettings(replaced.text, { weeklySummary: false })).toEqual({ text: replaced.text, changes: [] })
  })
})

describe("addCatalogRules", () => {
  test("appends a catalog repo entry, keeping everything else byte for byte", () => {
    const text = "# my config\nrepos:\n  - repo: local   # mine\n    rules: []  # none\n"
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "# my config",
        "repos:",
        "  - repo: local   # mine",
        "    rules: []  # none",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.2.0",
        "    rules:",
        ...NEW_RULES,
        "",
      ].join("\n"),
    )
  })

  test("adds to the catalog entry's block list after its last rule", () => {
    const text = [
      "repos:",
      "  - repo: https://github.com/syv-ai/rulecast",
      "    rev: v0.2.0",
      "    rules:",
      "      - id: react/data-fetching # keep",
      "        files: ^web/",
      "      # trailing",
      "  - repo: local",
      "    rules:",
      "      - { id: mine, name: Mine, stages: [touch], context: ['@a.md'] }",
      "",
    ].join("\n")
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "repos:",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.2.0",
        "    rules:",
        "      - id: react/data-fetching # keep",
        "        files: ^web/",
        ...NEW_RULES,
        "      # trailing",
        "  - repo: local",
        "    rules:",
        "      - { id: mine, name: Mine, stages: [touch], context: ['@a.md'] }",
        "",
      ].join("\n"),
    )
  })

  test("replaces an empty flow list, keeping its comment", () => {
    const text =
      "repos:\n  - repo: https://github.com/syv-ai/rulecast\n    rev: v0.1.0  # pinned\n    rules: []  # nothing\n"
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "repos:",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.1.0  # pinned",
        "    rules: # nothing",
        ...NEW_RULES,
        "",
      ].join("\n"),
    )
  })

  test("fills an empty repos list and handles a missing final newline", () => {
    expect(parse(addCatalogRules("repos: []", catalog, rules))).toEqual({
      repos: [
        {
          repo: catalog.url,
          rev: "v0.2.0",
          rules: [{ id: "generated-code" }, { id: "python/layering", context: ["@AGENTS.md#services"] }],
        },
      ],
    })
    const text = "repos:\n  - repo: local\n    rules: [] # c"
    expect(parse(addCatalogRules(text, catalog, rules)).repos).toHaveLength(2)
  })

  test("re-running only adds: listed rules are skipped and nothing new leaves the text unchanged", () => {
    const once = addCatalogRules(addCatalogRules(newConfigText(), catalog, [rules[0]!]), catalog, rules)
    expect(parse(once).repos[1].rules.map((rule: { id: string }) => rule.id)).toEqual([
      "generated-code",
      "python/layering",
    ])
    expect(addCatalogRules(once, catalog, rules)).toBe(once)
    expect(addCatalogRules(once, catalog, [])).toBe(once)
  })

  test("ruleLines writes files when the selection overrides it", () => {
    const files = "\\.gen\\.[cm]?[jt]sx?$|^frontend/src/client/"
    expect(addCatalogRules("repos: []\n", catalog, [{ id: "generated-code", context: null, files }])).toBe(
      [
        "repos:",
        `  - repo: ${catalog.url}`,
        "    rev: v0.2.0",
        "    rules:",
        "      - id: generated-code",
        `        files: ${JSON.stringify(files)}`,
        "",
      ].join("\n"),
    )
  })

  test("a listed rule gets the files a selection gives it, and keeps them on a re-run", () => {
    const text = [
      "repos:",
      `  - repo: ${catalog.url}`,
      "    rev: v0.2.0",
      "    rules:",
      "      - id: generated-code # ours",
      "      - id: vendored-code",
      "        files: old # keep the comment",
      "",
    ].join("\n")
    const selections: RuleSelection[] = [
      { id: "generated-code", context: null, files: "a|^b/" },
      { id: "vendored-code", context: null, files: "new" },
    ]
    const once = addCatalogRules(text, catalog, selections)
    expect(once).toBe(
      [
        "repos:",
        `  - repo: ${catalog.url}`,
        "    rev: v0.2.0",
        "    rules:",
        "      - id: generated-code # ours",
        '        files: "a|^b/"',
        "      - id: vendored-code",
        '        files: "new" # keep the comment',
        "",
      ].join("\n"),
    )
    expect(addCatalogRules(once, catalog, selections)).toBe(once)
  })

  test("refuses shapes it cannot extend without rewriting the file", () => {
    expect(() => addCatalogRules("repos: [{ repo: local, rules: [] }]\n", catalog, rules)).toThrow(ConfigTextError)
    expect(() => addCatalogRules("files: x\n", catalog, rules)).toThrow("the config has no repos list")
  })
})
