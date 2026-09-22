import { extractFindingsJson } from "./extract"
import { apiKey, endpoint, postJson } from "./http"
import { type LlmFinding, type LlmProvider, type LlmRequest, responseSchema } from "./types"

/** The origin, without a version prefix, as the Anthropic SDKs define `base_url`. */
const API = "https://api.anthropic.com"
const VERSION = "2023-06-01"

/**
 * The Anthropic Messages API.
 *
 * No forced tool call for structured output: the prompt already demands JSON and
 * extractFindingsJson already survives a model that wraps it in prose, so one code path serves
 * this provider, openai-compatible and opencode alike.
 */
export const anthropicProvider: LlmProvider = {
  name: "anthropic",
  async ask(request: LlmRequest): Promise<LlmFinding[]> {
    const key = apiKey(request)
    const reply = await postJson(
      endpoint(request.settings.baseUrl, API, "/v1/messages"),
      { "x-api-key": key, "anthropic-version": VERSION },
      {
        model: request.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: request.prompt }],
      },
      request.signal,
    )

    const parts = (reply as { content?: { type?: string; text?: string }[] }).content ?? []
    const text = parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    const scanned = responseSchema.safeParse(extractFindingsJson(text))
    if (scanned.success) return scanned.data.findings
    throw new Error(`the anthropic API returned no usable JSON: ${text.trim().slice(0, 200)}`)
  },
}
