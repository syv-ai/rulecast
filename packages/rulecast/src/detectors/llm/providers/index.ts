import type { LlmProviderName } from "../../../core/types"
import { claudeCodeProvider } from "./claude-code"
import { opencodeProvider } from "./opencode"
import { type LlmProvider, LlmUnavailableError } from "./types"

const PROVIDERS: Partial<Record<LlmProviderName, LlmProvider>> = {
  "claude-code": claudeCodeProvider,
  opencode: opencodeProvider,
}

/** Throws LlmUnavailableError, which spec §14 turns into one warning disabling every llm rule. */
export function providerByName(name: LlmProviderName): LlmProvider {
  const provider = PROVIDERS[name]
  if (!provider) throw new LlmUnavailableError(`the ${name} provider is not available in this build`)
  return provider
}
