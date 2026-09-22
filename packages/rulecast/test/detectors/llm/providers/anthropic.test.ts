import { afterEach, describe, expect, test } from "vitest"

import { anthropicProvider } from "../../../../src/detectors/llm/providers/anthropic"
import { endpoint } from "../../../../src/detectors/llm/providers/http"
import { type LlmRequest, LlmUnavailableError } from "../../../../src/detectors/llm/providers/types"
import { type FakeApi, fakeApi } from "../../../helpers/llm-server"

const PROMPT = "### r1\nDoes this file print?\n"
const ANSWER = '{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}'
const text = (body: string) => ({ content: [{ type: "text", text: body }] })

let api: FakeApi | null = null
afterEach(async () => {
  await api?.close()
  api = null
})

function request(baseUrl: string | null, env: NodeJS.ProcessEnv = { KEY: "sk-test" }): LlmRequest {
  return {
    model: "claude-haiku-4-5-20251001",
    prompt: PROMPT,
    settings: { provider: "anthropic", baseUrl, apiKeyEnv: "KEY", maxFilesPerVerify: 10 },
    env,
    cwd: "/project",
    signal: new AbortController().signal,
  }
}

describe("anthropic provider", () => {
  test("POSTs the prompt as one user message, with the key from the configured variable", async () => {
    api = await fakeApi(() => [200, text(ANSWER)])
    await anthropicProvider.ask(request(api.url))

    const sent = api.requests[0]!
    expect(sent.path).toBe("/v1/messages")
    expect(sent.headers["x-api-key"]).toBe("sk-test")
    expect(sent.headers["anthropic-version"]).toBeTruthy()
    expect(sent.body.model).toBe("claude-haiku-4-5-20251001")
    expect(sent.body.messages).toEqual([{ role: "user", content: PROMPT }])
  })

  test("reads the findings out of the reply's text", async () => {
    api = await fakeApi(() => [200, text(ANSWER)])
    expect(await anthropicProvider.ask(request(api.url))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("reads them out of prose around the JSON", async () => {
    api = await fakeApi(() => [200, text(`Sure.\n\n\`\`\`json\n${ANSWER}\n\`\`\`\n`)])
    expect(await anthropicProvider.ask(request(api.url))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("a reply with no JSON fails only the call's rules", async () => {
    api = await fakeApi(() => [200, text("Nothing wrong here.")])
    const error = await anthropicProvider.ask(request(api.url)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
  })

  test("an unset key variable fails before any request is made", async () => {
    api = await fakeApi(() => [200, text(ANSWER)])
    const error = await anthropicProvider.ask(request(api.url, {})).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmUnavailableError)
    expect((error as Error).message).toContain("KEY")
    expect(api.requests).toEqual([])
  })

  test("401 is an unavailable backend; 500 fails only the call's rules", async () => {
    api = await fakeApi(() => [401, { error: "invalid key" }])
    await expect(anthropicProvider.ask(request(api.url))).rejects.toBeInstanceOf(LlmUnavailableError)
    await api.close()

    api = await fakeApi(() => [500, { error: "upstream exploded" }])
    const error = await anthropicProvider.ask(request(api.url)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
    expect((error as Error).message).toContain("500")
  })

  test("without base_url it talks to the real API", () => {
    expect(endpoint(null, "https://api.anthropic.com", "/v1/messages")).toBe("https://api.anthropic.com/v1/messages")
    expect(endpoint("http://x.test/", "https://api.anthropic.com", "/v1/messages")).toBe("http://x.test/v1/messages")
  })

  test("an aborted signal rejects", async () => {
    api = await fakeApi(() => [200, text(ANSWER)])
    const controller = new AbortController()
    controller.abort()
    await expect(anthropicProvider.ask({ ...request(api.url), signal: controller.signal })).rejects.toThrow()
  })
})
