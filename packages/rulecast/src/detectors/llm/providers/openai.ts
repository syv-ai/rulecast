import { extractFindingsJson } from "./extract"
import { apiKey, endpoint, postJson } from "./http"
import { type LlmFinding, type LlmProvider, type LlmRequest, responseSchema } from "./types"

const API = "https://api.openai.com"

/**
 * Any OpenAI-shaped chat completions API: OpenAI, Azure OpenAI, Ollama, a gateway — whatever
 * `base_url` points at.
 *
 * Deliberately no `response_format: { type: "json_object" }` (plan 6c, Decision 2). It is an
 * OpenAI extension that several of the servers this provider exists to reach either reject or
 * interpret differently, and the prompt plus extractFindingsJson already give us what it would.
 */
export const openaiCompatibleProvider: LlmProvider = {
  name: "openai-compatible",
  async ask(request: LlmRequest): Promise<LlmFinding[]> {
    const key = apiKey(request)
    const reply = await postJson(
      endpoint(request.settings.baseUrl, API, "/v1/chat/completions"),
      { authorization: `Bearer ${key}` },
      { model: request.model, messages: [{ role: "user", content: request.prompt }] },
      request.signal,
    )

    const content = (reply as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
    const text = typeof content === "string" ? content : ""
    const scanned = responseSchema.safeParse(extractFindingsJson(text))
    if (scanned.success) return scanned.data.findings
    throw new Error(`the ${request.settings.provider} API returned no usable JSON: ${text.trim().slice(0, 200)}`)
  },
}
