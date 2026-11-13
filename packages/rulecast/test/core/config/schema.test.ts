import { describe, expect, test } from "vitest"

import { configSchema, defaultConfig, overrideSchema, ruleSchema } from "../../../src/core/config/schema"

const DEFAULTS = {
  repos: [],
  minimumRulecastVersion: null,
  files: "",
  exclude: "^$",
  defaultStages: null,
  conventions: null,
  notChecked: [],
  notCheckedProblems: [],
  context: { mode: "inject", maxBytes: 32768 },
  maxMatchesPerRule: 10,
  maxFileBytes: 1048576,
  timeouts: { editDeadlineMs: 350, verifyMs: 60000 },
  subagentProjects: "include",
  stopGate: { maxBlocks: 1 },
  refuseGate: { maxRefusals: 1 },
  mode: null,
  unattended: { maxBlocks: 10, escalate: [] },
  llm: {
    provider: "claude-code",
    model: null,
    baseUrl: null,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    maxFilesPerVerify: 10,
  },
  stats: { weeklySummary: false },
}

describe("configSchema", () => {
  test("applies defaults", () => {
    expect(configSchema.parse({ repos: [] })).toEqual(DEFAULTS)
    expect(defaultConfig()).toEqual(DEFAULTS)
  })

  test("maps every snake_case key to the config shape", () => {
    const config = configSchema.parse({
      minimum_rulecast_version: "0.2.0",
      files: "^src/",
      exclude: "^vendor/",
      default_stages: ["edit", "verify"],
      context: { mode: "read", max_bytes: 1000 },
      max_matches_per_rule: 3,
      max_file_bytes: 2048,
      timeouts: { edit_deadline_ms: 200, verify_ms: 5000 },
      subagent_projects: "exclude",
      stop_gate: { max_blocks: 2 },
      mode: "unattended",
      unattended: { max_blocks: 4, escalate: ["a/rule"] },
      llm: {
        provider: "openai-compatible",
        model: "llama3",
        base_url: "http://localhost:11434/v1",
        api_key_env: "KEY",
        max_files_per_verify: 4,
      },
      stats: { weekly_summary: true },
      not_checked: [{ context: "@docs/a.md#reviews", reason: "process" }],
      repos: [
        { repo: "https://github.com/syv-ai/rulecast", rev: "v0.2.0", rules: [{ id: "generated-code" }] },
        { repo: "local", rules: [] },
      ],
    })
    expect(config).toEqual({
      repos: [
        { repo: "https://github.com/syv-ai/rulecast", rev: "v0.2.0", rules: [{ id: "generated-code" }] },
        { repo: "local", rules: [] },
      ],
      minimumRulecastVersion: "0.2.0",
      files: "^src/",
      exclude: "^vendor/",
      defaultStages: ["edit", "verify"],
      conventions: null,
      notChecked: [{ context: "@docs/a.md#reviews", reason: "process", index: 0 }],
      notCheckedProblems: [],
      context: { mode: "read", maxBytes: 1000 },
      maxMatchesPerRule: 3,
      maxFileBytes: 2048,
      timeouts: { editDeadlineMs: 200, verifyMs: 5000 },
      subagentProjects: "exclude",
      stopGate: { maxBlocks: 2 },
      refuseGate: { maxRefusals: 1 },
      mode: "unattended",
      unattended: { maxBlocks: 4, escalate: ["a/rule"] },
      llm: {
        provider: "openai-compatible",
        model: "llama3",
        baseUrl: "http://localhost:11434/v1",
        apiKeyEnv: "KEY",
        maxFilesPerVerify: 4,
      },
      stats: { weeklySummary: true },
    })
  })

  test("repos are required, keys are snake_case only, and unknown keys are rejected", () => {
    expect(configSchema.safeParse({}).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], maxMatchesPerRule: 5 }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], maxFileBytes: 1024 }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], max_file_bytes: 0 }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], timeouts: { editDeadlineMs: 1 } }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [{ repo: "local" }] }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [{ repo: "local", rules: [], hooks: [] }] }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], minimum_rulecast_version: "v1" }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], default_stages: ["commit"] }).success).toBe(false)
  })

  test("mode is attended or unattended, and unattended takes only its own keys", () => {
    expect(configSchema.safeParse({ repos: [], mode: "interactive" }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], unattended: { maxBlocks: 3 } }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], unattended: { escalate: ["Not An Id"] } }).success).toBe(false)
  })

  test("llm names the four providers, and llm.model is the default for rules that name none", () => {
    for (const provider of ["claude-code", "opencode", "anthropic", "openai-compatible"]) {
      expect(configSchema.parse({ repos: [], llm: { provider } }).llm.provider).toBe(provider)
    }
    expect(configSchema.safeParse({ repos: [], llm: { provider: "gemini" } }).success).toBe(false)
    // Plan 20: llm.model is the developer's consent to llm rules and the model they run on.
    expect(configSchema.parse({ repos: [], llm: { model: "haiku" } }).llm.model).toBe("haiku")
    expect(configSchema.parse({ repos: [] }).llm.model).toBeNull()
    expect(configSchema.safeParse({ repos: [], llm: { model: " " } }).success).toBe(false)
  })

  test("stats.weekly_summary defaults to off and rejects unknown keys", () => {
    expect(configSchema.parse({ repos: [] }).stats.weeklySummary).toBe(false)
    expect(configSchema.parse({ repos: [], stats: { weekly_summary: true } }).stats.weeklySummary).toBe(true)
    expect(configSchema.safeParse({ repos: [], stats: { weekly_summary: "yes" } }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], stats: { keep_weeks: 26 } }).success).toBe(false)
  })

  test("conventions names a file or a folder, relative to the config; absolute paths are rejected", () => {
    expect(configSchema.parse({ repos: [] }).conventions).toBeNull()
    expect(configSchema.parse({ repos: [], conventions: "docs/conventions/" }).conventions).toBe("docs/conventions/")
    expect(configSchema.parse({ repos: [], conventions: "../docs/a.md" }).conventions).toBe("../docs/a.md")
    expect(configSchema.safeParse({ repos: [], conventions: "/abs/docs" }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], conventions: "" }).success).toBe(false)
  })

  test("not_checked lists conventions considered and left without a rule, each with its section and reason", () => {
    expect(configSchema.parse({ repos: [] }).notChecked).toEqual([])
    const entry = { context: "@docs/a.md#reviews", reason: "about how to work, not about the code" }
    expect(configSchema.parse({ repos: [], not_checked: [entry] }).notChecked).toEqual([{ ...entry, index: 0 }])
  })

  test("a malformed not_checked entry is set aside with what is wrong, and the rest of the config loads", () => {
    // No rule depends on an entry, so a typo in one must not stop every rule: compile warns instead.
    const entry = { context: "@docs/a.md#reviews", reason: "process" }
    const parsed = (notChecked: unknown) => configSchema.parse({ repos: [], files: "^src/", not_checked: notChecked })
    const config = parsed([{ context: "@docs/a.md#tests", why: "process" }, entry, { ...entry, reason: " " }])
    expect(config.files).toBe("^src/")
    // Each entry keeps its place in the file, so a later warning about it names the right one.
    expect(config.notChecked).toEqual([{ ...entry, index: 1 }])
    expect(config.notCheckedProblems).toEqual([
      'not_checked[0]: unknown key "why" (did you mean "reason"?); not_checked[0].reason: required',
      expect.stringMatching(/^not_checked\[2\]\.reason: /),
    ])
    expect(parsed([{ ...entry, context: ["@docs/a.md"] }]).notCheckedProblems).toEqual([
      expect.stringMatching(/^not_checked\[0\]\.context: /),
    ])
    expect(parsed({ context: "@docs/a.md" })).toMatchObject({
      notChecked: [],
      notCheckedProblems: [expect.stringMatching(/^not_checked: /)],
    })
  })

  test("repo entries keep their rules unparsed; rev rules are left to compile", () => {
    const config = configSchema.parse({
      repos: [
        { repo: "local", rev: "v1", rules: [{ anything: 1 }] },
        { repo: "https://x.test/y", rules: [] },
      ],
    })
    expect(config.repos).toEqual([
      { repo: "local", rev: "v1", rules: [{ anything: 1 }] },
      { repo: "https://x.test/y", rules: [] },
    ])
  })
})

describe("rule schemas", () => {
  const complete = {
    id: "api/no-client",
    name: "Components never call the API client",
    files: "^src/components/",
    types: ["tsx"],
    detect: { regex: { pattern: "x" } },
    message: "{{file}}",
  }

  test("a complete rule needs id and name; an override needs only id", () => {
    expect(ruleSchema.safeParse(complete).success).toBe(true)
    expect(ruleSchema.safeParse({ id: "a" }).success).toBe(false)
    expect(overrideSchema.safeParse({ id: "a" }).success).toBe(true)
    expect(overrideSchema.safeParse({ id: "a", files: "^app/", context: ["@AGENTS.md#errors"] }).success).toBe(true)
    expect(overrideSchema.safeParse({ files: "^app/" }).success).toBe(false)
  })

  test("refuse_write is a boolean or unattended", () => {
    expect(ruleSchema.safeParse({ ...complete, refuse_write: "unattended" }).success).toBe(true)
    expect(ruleSchema.safeParse({ ...complete, refuse_write: "always" }).success).toBe(false)
  })

  test("escalate is a boolean, and an override may set it", () => {
    expect(ruleSchema.safeParse({ ...complete, escalate: true }).success).toBe(true)
    expect(overrideSchema.safeParse({ id: "a", escalate: false }).success).toBe(true)
    expect(ruleSchema.safeParse({ ...complete, escalate: "unattended" }).success).toBe(false)
  })

  test("applies no defaults, so overrides can merge over manifest rules", () => {
    expect(ruleSchema.parse({ id: "a", name: "A" })).toEqual({ id: "a", name: "A" })
  })

  test("reads every rule key", () => {
    const rule = ruleSchema.parse({
      id: "generated-code",
      alias: "generated-client",
      name: "Generated code",
      description: "Never edit generated files.",
      files: "^frontend/src/client/",
      exclude: "\\.test\\.ts$",
      types: ["ts"],
      types_or: ["ts", "tsx"],
      exclude_types: ["markdown"],
      stages: ["edit", "verify"],
      minimum_rulecast_version: "0.2.0",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
      context: ["@docs/generated.md", { path: "@docs/client.md#regenerating", mode: "read" }],
    })
    expect(rule.alias).toBe("generated-client")
    expect(rule.stages).toEqual(["edit", "verify"])
    expect(rule.context).toHaveLength(2)
  })

  test("rejects bad ids and aliases, bad stages, several detectors and unknown keys", () => {
    expect(ruleSchema.safeParse({ ...complete, id: "Api" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, alias: "Generated Client" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, stages: [] }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, stages: ["commit"] }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, detect: { path: {}, regex: {} } }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, entry: "ruff" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, typesOr: ["ts"] }).success).toBe(false)
    expect(overrideSchema.safeParse({ id: "a", on: ["touch"] }).success).toBe(false)
  })
})
