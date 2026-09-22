import type { LlmSettings } from "../../../core/types"
import { type LlmAvailability, type LlmRequest, LlmUnavailableError } from "./types"

/** The configured base_url, or the provider's own API. Spec §6, widened to both HTTP providers. */
export function endpoint(baseUrl: string | null, fallback: string, path: string): string {
  return `${(baseUrl ?? fallback).replace(/\/+$/, "")}${path}`
}

/** The API key, or an unavailable backend: spec §14 disables every llm rule with one warning. */
export function apiKey(request: LlmRequest): string {
  const key = request.env[request.settings.apiKeyEnv]
  if (!key) {
    throw new LlmUnavailableError(
      `${request.settings.apiKeyEnv} is not set; set it, or use the claude-code provider, which needs no API key`,
    )
  }
  return key
}

/**
 * A JSON POST.
 *
 * 401 and 403 are LlmUnavailableError: a rejected key is the same situation as an absent one, the
 * fix is the same, and repeating it once per rule is noise. Everything else is per-call and might
 * affect only some rules, so it stays a plain Error (plan 6c, Decision 5).
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200)
    const message = `${url} returned ${response.status}: ${detail}`
    if (response.status === 401 || response.status === 403) throw new LlmUnavailableError(message)
    throw new Error(message)
  }
  return response.json()
}

/** The key is set, and where the call would go. Never opens a socket: `rulecast doctor` (spec §5). */
export function keyAvailability(
  settings: LlmSettings,
  env: NodeJS.ProcessEnv,
  fallback: string,
  path: string,
): LlmAvailability {
  return env[settings.apiKeyEnv]
    ? { ok: true, detail: endpoint(settings.baseUrl, fallback, path) }
    : { ok: false, detail: `$${settings.apiKeyEnv} is not set` }
}
