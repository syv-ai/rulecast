import { readdir } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { defaultDetectorSettings, type LlmProviderName } from "../../../src/core/types"
import { llmDetector } from "../../../src/detectors/llm/detector"
import { stubAgentCli } from "../../helpers/llm"
import { createProject } from "../../helpers/project"

/** A machine with a real claude installed must not turn a "not installed" case green. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

interface Options {
  provider?: LlmProviderName
  baseUrl?: string | null
  apiKeyEnv?: string
  env?: Record<string, string | undefined>
}

function check(root: string, models: { id: string; model: string }[], options: Options = {}) {
  const defaults = defaultDetectorSettings()
  return llmDetector.check!({
    rules: models.map((rule) => ({
      id: rule.id,
      config: { model: rule.model, question: "is it?", grounding: true },
    })),
    settings: {
      llm: {
        ...defaults.llm,
        provider: options.provider ?? "claude-code",
        baseUrl: options.baseUrl ?? null,
        apiKeyEnv: options.apiKeyEnv ?? "ANTHROPIC_API_KEY",
      },
    },
    env: options.env ?? {},
    cwd: root,
    signal: AbortSignal.timeout(5000),
  })
}

/** How many times the stub agent was actually run. A check must never call a model. */
async function callCount(root: string, name: string): Promise<number> {
  return (await readdir(path.join(root, `${name}.calls`)).catch(() => [])).length
}

describe("llm detector check", () => {
  describe("the provider is reachable", () => {
    test("a CLI provider in the project's node_modules/.bin is ok, and is not called", async () => {
      const root = await createProject({})
      await stubAgentCli(root, "claude")
      const results = await check(root, [{ id: "a", model: "haiku" }])
      expect(results[0]).toEqual({
        what: "claude-code",
        level: "ok",
        detail: path.join(root, "node_modules", ".bin", "claude"),
        rules: [],
      })
      expect(await callCount(root, "claude")).toBe(0)
    })

    test("a CLI provider nothing provides is an error disabling every llm rule", async () => {
      const root = await createProject({})
      const results = await check(root, [
        { id: "a", model: "haiku" },
        { id: "b", model: "sonnet" },
      ])
      expect(results[0]).toEqual({
        what: "claude-code",
        level: "error",
        detail: "claude is not installed",
        rules: ["a", "b"],
      })
    })

    test("an HTTP provider with its key set is ok, and reports the endpoint it would call", async () => {
      const root = await createProject({})
      const results = await check(root, [{ id: "a", model: "haiku" }], {
        provider: "anthropic",
        env: { ANTHROPIC_API_KEY: "sk-test" },
      })
      expect(results[0]).toEqual({
        what: "anthropic",
        level: "ok",
        detail: "https://api.anthropic.com/v1/messages",
        rules: [],
      })
    })

    test("a base_url is visible in the endpoint, so a misconfigured one is findable", async () => {
      const root = await createProject({})
      const results = await check(root, [{ id: "a", model: "qwen3" }], {
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        apiKeyEnv: "OLLAMA_KEY",
        env: { OLLAMA_KEY: "x" },
      })
      expect(results[0]).toEqual({
        what: "openai-compatible",
        level: "ok",
        detail: "http://localhost:11434/v1/chat/completions",
        rules: [],
      })
    })

    test("an HTTP provider with no key names the variable that is missing", async () => {
      const root = await createProject({})
      const results = await check(root, [{ id: "a", model: "haiku" }], { provider: "anthropic", env: {} })
      expect(results[0]).toEqual({
        what: "anthropic",
        level: "error",
        detail: "$ANTHROPIC_API_KEY is not set",
        rules: ["a"],
      })
    })
  })

  describe("every rule's model resolves", () => {
    test("an alias that resolves to itself is still named as an alias", async () => {
      // Found by dogfooding: haiku is `haiku` for the claude-code provider, and reporting that as
      // "passed through" reads as "rulecast does not know this model".
      const root = await createProject({})
      await stubAgentCli(root, "claude")
      const results = await check(root, [{ id: "a", model: "haiku" }])
      expect(results[1]).toEqual({
        what: 'model "haiku"',
        level: "ok",
        detail: "claude-code calls it haiku",
        rules: [],
      })
    })

    test("an alias that maps reports the provider's own name for it", async () => {
      const root = await createProject({})
      await stubAgentCli(root, "claude")
      const results = await check(root, [{ id: "a", model: "haiku" }], {
        provider: "anthropic",
        env: { ANTHROPIC_API_KEY: "k" },
      })
      expect(results[1]).toEqual({
        what: 'model "haiku"',
        level: "ok",
        detail: "anthropic calls it claude-haiku-4-5-20251001",
        rules: [],
      })
      expect(await callCount(root, "claude")).toBe(0)
    })

    test("a name that is not an alias passes through", async () => {
      const root = await createProject({})
      const results = await check(root, [{ id: "a", model: "qwen3-coder:30b" }], {
        provider: "openai-compatible",
        apiKeyEnv: "K",
        env: { K: "x" },
      })
      expect(results[1]).toEqual({
        what: 'model "qwen3-coder:30b"',
        level: "ok",
        detail: "passed through",
        rules: [],
      })
    })

    test("an alias the provider cannot express is an error naming both, in runCall's words", async () => {
      const root = await createProject({})
      const results = await check(
        root,
        [
          { id: "a", model: "haiku" },
          { id: "b", model: "haiku" },
        ],
        {
          provider: "openai-compatible",
          apiKeyEnv: "K",
          env: { K: "x" },
        },
      )
      expect(results[1]).toEqual({
        what: 'model "haiku"',
        level: "error",
        detail: "no name for the openai-compatible provider; use that provider's own model name",
        rules: ["a", "b"],
      })
    })

    test("one result per distinct model, in first-use order", async () => {
      const root = await createProject({})
      await stubAgentCli(root, "claude")
      const results = await check(root, [
        { id: "a", model: "sonnet" },
        { id: "b", model: "haiku" },
        { id: "c", model: "sonnet" },
      ])
      expect(results.slice(1).map((result) => result.what)).toEqual(['model "sonnet"', 'model "haiku"'])
      expect(await callCount(root, "claude")).toBe(0)
    })
  })
})
