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
  { id: "generated-code", context: null },
  { id: "python/layering", context: ["@AGENTS.md#services"] },
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
})

describe("setSettings", () => {
  test("adds the settings, keeping comments and the keys already there", () => {
    const text = "# ours\nllm:\n  provider: opencode # keep\nrepos: []\n"
    const updated = setSettings(text, { llmModel: "haiku", conventions: "docs/c.md" })
    expect(updated).toContain("# ours")
    expect(updated).toContain("provider: opencode # keep")
    expect(parse(updated)).toEqual({
      llm: { provider: "opencode", model: "haiku" },
      repos: [],
      conventions: "docs/c.md",
    })
  })

  test("replaces a different value, and leaves the text alone when nothing changes", () => {
    const text = "conventions: docs/old.md\nrepos: []\n"
    expect(parse(setSettings(text, { conventions: "docs/new/" })).conventions).toBe("docs/new/")
    expect(setSettings(text, { conventions: "docs/old.md" })).toBe(text)
    expect(setSettings(text, {})).toBe(text)
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

  test("refuses shapes it cannot extend without rewriting the file", () => {
    expect(() => addCatalogRules("repos: [{ repo: local, rules: [] }]\n", catalog, rules)).toThrow(ConfigTextError)
    expect(() => addCatalogRules("files: x\n", catalog, rules)).toThrow("the config has no repos list")
  })
})
