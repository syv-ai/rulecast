import { describe, expect, test } from "vitest"

import type { LlmProviderName } from "../../../src/core/types"
import { MODEL_ALIASES, resolveModel } from "../../../src/detectors/llm/models"

describe("resolveModel", () => {
  const table: [string, LlmProviderName, string | null][] = [
    ["haiku", "claude-code", "haiku"],
    ["haiku", "anthropic", "claude-haiku-4-5-20251001"],
    ["haiku", "opencode", "anthropic/claude-haiku-4-5-20251001"],
    ["haiku", "openai-compatible", null],
    ["sonnet", "claude-code", "sonnet"],
    ["sonnet", "anthropic", "claude-sonnet-5"],
    ["sonnet", "opencode", "anthropic/claude-sonnet-5"],
    ["opus", "claude-code", "opus"],
    ["opus", "anthropic", "claude-opus-5"],
    ["opus", "opencode", "anthropic/claude-opus-5"],
    ["fable", "claude-code", "fable"],
    ["fable", "anthropic", "claude-fable-5-1"],
    ["fable", "opencode", "anthropic/claude-fable-5-1"],
  ]

  for (const [alias, provider, expected] of table) {
    test(`${alias} on ${provider} is ${expected}`, () => {
      expect(resolveModel(alias, provider)).toBe(expected)
    })
  }

  test("a name that is not an alias reaches the provider verbatim", () => {
    expect(resolveModel("gpt-5-mini", "openai-compatible")).toBe("gpt-5-mini")
    expect(resolveModel("qwen3-coder:30b", "openai-compatible")).toBe("qwen3-coder:30b")
    // A full Anthropic id is not an alias either: it is already what the API wants.
    expect(resolveModel("claude-haiku-4-5-20251001", "anthropic")).toBe("claude-haiku-4-5-20251001")
    expect(resolveModel("anthropic/claude-sonnet-5", "opencode")).toBe("anthropic/claude-sonnet-5")
  })

  test("MODEL_ALIASES lists exactly the aliases resolveModel knows", () => {
    expect([...MODEL_ALIASES].sort()).toEqual(["fable", "haiku", "opus", "sonnet"])
    for (const alias of MODEL_ALIASES) expect(resolveModel(alias, "claude-code")).toBe(alias)
  })
})
