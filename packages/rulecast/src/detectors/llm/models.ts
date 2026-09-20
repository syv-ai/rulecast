import type { LlmProviderName } from "../../core/types"

/**
 * Short names so one rule's `model` works whichever provider a project configured (plan 6a,
 * Decision 2). The three backends disagree about what a model is called: the Claude Code CLI takes
 * aliases, the Anthropic API takes dated ids, and OpenCode takes `provider/model`.
 *
 * `openai-compatible` deliberately has no mappings — there is no sensible OpenAI equivalent of
 * "haiku", and the projects that reach for it (Azure, Ollama, a gateway) name their models
 * themselves. Those names pass through verbatim; see resolveModel.
 */
const ALIASES: Record<string, Partial<Record<LlmProviderName, string>>> = {
  haiku: {
    "claude-code": "haiku",
    anthropic: "claude-haiku-4-5-20251001",
    opencode: "anthropic/claude-haiku-4-5-20251001",
  },
  sonnet: { "claude-code": "sonnet", anthropic: "claude-sonnet-5", opencode: "anthropic/claude-sonnet-5" },
  opus: { "claude-code": "opus", anthropic: "claude-opus-5", opencode: "anthropic/claude-opus-5" },
  fable: { "claude-code": "fable", anthropic: "claude-fable-5-1", opencode: "anthropic/claude-fable-5-1" },
}

export const MODEL_ALIASES: readonly string[] = Object.keys(ALIASES)

/**
 * The provider's own name for a model. A name that is not an alias is passed through unchanged, so
 * a new model or a local Ollama tag needs no rulecast release. null: a known alias this provider
 * cannot express, which the detector turns into a per-rule error naming both.
 */
export function resolveModel(model: string, provider: LlmProviderName): string | null {
  const alias = ALIASES[model]
  if (alias === undefined) return model
  return alias[provider] ?? null
}
