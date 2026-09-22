import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import type { LlmSettings } from "../../../src/core/types"
import { askCached, type CallKeyInput, callKey } from "../../../src/detectors/llm/call"
import type { LlmFinding, LlmProvider, LlmRequest } from "../../../src/detectors/llm/providers/types"

const SETTINGS: LlmSettings = {
  provider: "claude-code",
  baseUrl: null,
  apiKeyEnv: "ANTHROPIC_API_KEY",
  maxFilesPerVerify: 10,
}

const FINDINGS: LlmFinding[] = [{ rule: "r1", line: 2, reason: "prints" }]

function counting(answer: () => LlmFinding[] = () => FINDINGS): LlmProvider & { calls: number } {
  const provider = {
    name: "fake",
    calls: 0,
    async ask() {
      provider.calls++
      return answer()
    },
    // The cache is what these tests are about; the backend is always reachable.
    async available() {
      return { ok: true, detail: "fake" }
    },
  }
  return provider
}

function request(): LlmRequest {
  return {
    model: "haiku",
    prompt: "p",
    settings: SETTINGS,
    env: {},
    cwd: "/project",
    signal: new AbortController().signal,
  }
}

const base: CallKeyInput = {
  file: "app/a.py",
  source: "print('x')\n",
  changedLines: [[1, 1]],
  provider: "claude-code",
  baseUrl: null,
  model: "haiku",
  rules: [{ id: "r1", config: { model: "haiku", question: "q", grounding: true }, grounding: [] }],
}

describe("askCached", () => {
  test("asks once, then reads the cache", async () => {
    const provider = counting()
    const cache = memoryCache()
    const key = callKey(base)
    expect(await askCached(provider, cache, key, request())).toEqual(FINDINGS)
    expect(await askCached(provider, cache, key, request())).toEqual(FINDINGS)
    expect(provider.calls).toBe(1)
  })

  test("a provider failure is not cached", async () => {
    let fail = true
    const provider = counting(() => {
      if (fail) throw new Error("rate limited")
      return FINDINGS
    })
    const cache = memoryCache()
    const key = callKey(base)
    await expect(askCached(provider, cache, key, request())).rejects.toThrow("rate limited")
    fail = false
    expect(await askCached(provider, cache, key, request())).toEqual(FINDINGS)
    expect(provider.calls).toBe(2)
  })
})

describe("callKey", () => {
  const changes: [string, CallKeyInput][] = [
    ["the file content", { ...base, source: "print('y')\n" }],
    ["the file name", { ...base, file: "app/b.py" }],
    ["the change set", { ...base, changedLines: [[1, 2]] }],
    ["no change set at all", { ...base, changedLines: null }],
    ["the model", { ...base, model: "sonnet" }],
    // The same alias resolves differently per provider, so switching provider must not read old answers.
    ["the provider", { ...base, provider: "anthropic" }],
    // base_url picks a backend within one provider just as much: a local Ollama and a hosted
    // gateway can serve different models under the same name.
    ["the base url", { ...base, baseUrl: "http://localhost:11434/v1" }],
    ["the base url changing again", { ...base, baseUrl: "https://gateway.test/v1" }],
    ["a rule id", { ...base, rules: [{ ...base.rules[0]!, id: "r2" }] }],
    [
      "a rule's question",
      {
        ...base,
        rules: [{ ...base.rules[0]!, config: { model: "haiku", question: "different", grounding: true } }],
      },
    ],
    [
      "grounding content",
      {
        ...base,
        rules: [{ ...base.rules[0]!, grounding: [{ ref: "docs/a.md", content: "new text" }] }],
      },
    ],
  ]

  for (const [what, input] of changes) {
    test(`changes when ${what} changes`, () => {
      expect(callKey(input)).not.toBe(callKey(base))
    })
  }

  test("rule order does not change the key: {a,b} and {b,a} are one call", () => {
    const a = { id: "a", config: { model: "haiku", question: "qa", grounding: true }, grounding: [] }
    const b = { id: "b", config: { model: "haiku", question: "qb", grounding: true }, grounding: [] }
    expect(callKey({ ...base, rules: [a, b] })).toBe(callKey({ ...base, rules: [b, a] }))
  })

  test("is a hex digest, not the payload", () => {
    expect(callKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })
})
