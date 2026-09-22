import { afterEach, describe, expect, test } from "vitest"

import { endpoint } from "../../../../src/detectors/llm/providers/http"
import { openaiCompatibleProvider } from "../../../../src/detectors/llm/providers/openai"
import { type LlmRequest, LlmUnavailableError } from "../../../../src/detectors/llm/providers/types"
import { type FakeApi, fakeApi } from "../../../helpers/llm-server"

const PROMPT = "### r1\nDoes this file print?\n"
const ANSWER = '{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}'
const reply = (body: string) => ({ choices: [{ message: { role: "assistant", content: body } }] })

let api: FakeApi | null = null
afterEach(async () => {
  await api?.close()
  api = null
})

function request(baseUrl: string | null, env: NodeJS.ProcessEnv = { KEY: "sk-test" }): LlmRequest {
  return {
    model: "gpt-5-mini",
    prompt: PROMPT,
    settings: { provider: "openai-compatible", baseUrl, apiKeyEnv: "KEY", maxFilesPerVerify: 10 },
    env,
    cwd: "/project",
    signal: new AbortController().signal,
  }
}

describe("openai-compatible provider", () => {
  test("POSTs a chat completion with a bearer token", async () => {
    api = await fakeApi(() => [200, reply(ANSWER)])
    await openaiCompatibleProvider.ask(request(`${api.url}/v1`))

    const sent = api.requests[0]!
    expect(sent.path).toBe("/v1/chat/completions")
    expect(sent.headers.authorization).toBe("Bearer sk-test")
    expect(sent.body.model).toBe("gpt-5-mini")
    expect(sent.body.messages).toEqual([{ role: "user", content: PROMPT }])
  })

  test("sends no response_format: Ollama and the gateways this provider exists for reject it", async () => {
    api = await fakeApi(() => [200, reply(ANSWER)])
    await openaiCompatibleProvider.ask(request(`${api.url}/v1`))
    expect(api.requests[0]!.body).not.toHaveProperty("response_format")
  })

  test("reads the findings, in plain output and out of prose", async () => {
    api = await fakeApi(() => [200, reply(ANSWER)])
    expect(await openaiCompatibleProvider.ask(request(`${api.url}/v1`))).toEqual([
      { rule: "r1", line: 2, reason: "prints" },
    ])
    await api.close()

    api = await fakeApi(() => [200, reply(`Here:\n\`\`\`json\n${ANSWER}\n\`\`\`\n`)])
    expect(await openaiCompatibleProvider.ask(request(`${api.url}/v1`))).toEqual([
      { rule: "r1", line: 2, reason: "prints" },
    ])
  })

  test("a reply with no JSON fails only the call's rules", async () => {
    api = await fakeApi(() => [200, reply("All good.")])
    const error = await openaiCompatibleProvider.ask(request(`${api.url}/v1`)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
  })

  test("an unset key variable fails before any request is made", async () => {
    api = await fakeApi(() => [200, reply(ANSWER)])
    await expect(openaiCompatibleProvider.ask(request(`${api.url}/v1`, {}))).rejects.toBeInstanceOf(LlmUnavailableError)
    expect(api.requests).toEqual([])
  })

  test("401 is an unavailable backend; 429 fails only the call's rules", async () => {
    api = await fakeApi(() => [401, { error: "bad key" }])
    await expect(openaiCompatibleProvider.ask(request(`${api.url}/v1`))).rejects.toBeInstanceOf(LlmUnavailableError)
    await api.close()

    api = await fakeApi(() => [429, { error: "slow down" }])
    const error = await openaiCompatibleProvider.ask(request(`${api.url}/v1`)).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
    expect((error as Error).message).toContain("429")
  })

  test("base_url carries the version prefix, as the OpenAI SDKs define it", () => {
    // Ollama's own docs give http://localhost:11434/v1 as the base_url, and that is what someone
    // will paste in; appending /v1/chat/completions to it would 404. So rulecast appends only the
    // operation, and its default base carries the prefix.
    expect(endpoint(null, "https://api.openai.com/v1", "/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    )
    expect(endpoint("http://localhost:11434/v1", "https://api.openai.com/v1", "/chat/completions")).toBe(
      "http://localhost:11434/v1/chat/completions",
    )
  })
})
