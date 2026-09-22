import type { LlmProviderName } from "../../../core/types"
import { anthropicProvider } from "./anthropic"
import { claudeCodeProvider } from "./claude-code"
import { openaiCompatibleProvider } from "./openai"
import { opencodeProvider } from "./opencode"
import { type LlmProvider, LlmUnavailableError } from "./types"

const PROVIDERS: Record<LlmProviderName, LlmProvider> = {
  "claude-code": claudeCodeProvider,
  opencode: opencodeProvider,
  anthropic: anthropicProvider,
  "openai-compatible": openaiCompatibleProvider,
}

/**
 * The provider for a configured name. Throws LlmUnavailableError, which spec §14 turns into one
 * warning disabling every llm rule — the guard survives because a config can name a provider a
 * future build has dropped.
 */
export function providerByName(name: LlmProviderName): LlmProvider {
  const provider = PROVIDERS[name]
  if (!provider) throw new LlmUnavailableError(`the ${name} provider is not available in this build`)
  return provider
}
