import { createHash } from "node:crypto"

import type { Cache, LlmProviderName } from "../../core/types"
import type { LlmFinding, LlmProvider, LlmRequest } from "./providers/types"
import type { LlmConfig } from "./schema"

export interface CallKeyInput {
  file: string
  source: string
  changedLines: [number, number][] | null
  provider: LlmProviderName
  model: string
  rules: { id: string; config: LlmConfig; grounding: { ref: string; content: string }[] }[]
}

/**
 * Spec §6: "hash of file content, change set, model, and the ids, configs and grounding content of
 * the rules in the call", plus the provider — the same alias resolves to a different model for a
 * different provider, so switching backends must not read the old answers.
 *
 * Rules are sorted by id, so the same set of rules is one call however they were grouped.
 */
export function callKey(input: CallKeyInput): string {
  const payload = {
    file: input.file,
    source: input.source,
    changedLines: input.changedLines,
    provider: input.provider,
    model: input.model,
    rules: [...input.rules]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((rule) => ({ id: rule.id, config: rule.config, grounding: rule.grounding })),
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

/**
 * The provider's answer, asked for once per key. Only successes are cached: a rate limit or a
 * dropped connection must not stick until someone runs `rulecast clean`.
 */
export async function askCached(
  provider: LlmProvider,
  cache: Cache,
  key: string,
  request: LlmRequest,
): Promise<LlmFinding[]> {
  const cached = await cache.get<LlmFinding[]>(key)
  if (cached !== undefined) return cached
  const findings = await provider.ask(request)
  await cache.set(key, findings)
  return findings
}
