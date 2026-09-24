import { describe, expect, test } from "vitest"

import { configSchema, defaultConfig, overrideSchema, ruleSchema } from "../../../src/core/config/schema"

const DEFAULTS = {
  repos: [],
  minimumRulecastVersion: null,
  files: "",
  exclude: "^$",
  defaultStages: null,
  context: { mode: "inject", maxBytes: 32768 },
  maxMatchesPerRule: 10,
  maxFileBytes: 1048576,
  timeouts: { editDeadlineMs: 350, verifyMs: 60000 },
  stopGate: { maxBlocks: 1 },
  refuseGate: { maxRefusals: 1 },
  llm: {
    provider: "claude-code",
    baseUrl: null,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    maxFilesPerVerify: 10,
  },
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
      stop_gate: { max_blocks: 2 },
      llm: {
        provider: "openai-compatible",
        base_url: "http://localhost:11434/v1",
        api_key_env: "KEY",
        max_files_per_verify: 4,
      },
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
      context: { mode: "read", maxBytes: 1000 },
      maxMatchesPerRule: 3,
      maxFileBytes: 2048,
      timeouts: { editDeadlineMs: 200, verifyMs: 5000 },
      stopGate: { maxBlocks: 2 },
      refuseGate: { maxRefusals: 1 },
      llm: {
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        apiKeyEnv: "KEY",
        maxFilesPerVerify: 4,
      },
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

  test("llm names the four providers and has no project-wide model", () => {
    for (const provider of ["claude-code", "opencode", "anthropic", "openai-compatible"]) {
      expect(configSchema.parse({ repos: [], llm: { provider } }).llm.provider).toBe(provider)
    }
    expect(configSchema.safeParse({ repos: [], llm: { provider: "gemini" } }).success).toBe(false)
    // Every llm rule names its own model (plan 6a, Decision 1); a project-wide default is gone.
    expect(configSchema.safeParse({ repos: [], llm: { model: "haiku" } }).success).toBe(false)
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
