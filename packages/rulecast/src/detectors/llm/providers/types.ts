import { z } from "zod"

import type { LlmSettings } from "../../../core/types"

/** What the model is asked to answer with (spec §6). */
export const responseSchema = z.object({
  findings: z.array(
    z.object({
      rule: z.string(),
      line: z.number().int().positive(),
      /** The model's quote of the line. Asked for because quoting sharpens the line number; never rendered. */
      text: z.string().optional(),
      reason: z.string(),
    }),
  ),
})

export type LlmFinding = z.infer<typeof responseSchema>["findings"][number]

/** The same shape as JSON Schema, for providers that can enforce it (claude-code's --json-schema). */
export const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          line: { type: "integer" },
          text: { type: "string" },
          reason: { type: "string" },
        },
        required: ["rule", "line", "reason"],
      },
    },
  },
  required: ["findings"],
} as const

export interface LlmRequest {
  /** The provider's own model name, already resolved from the rule's alias. */
  model: string
  /** The whole prompt: rules, grounding and the marked-up file. */
  prompt: string
  settings: LlmSettings
  env: NodeJS.ProcessEnv
  cwd: string
  signal: AbortSignal
}

/**
 * The backend itself is unusable — no binary, no credentials. Spec §14 makes this a failure of the
 * whole run (every llm rule disabled, one warning), not of one rule. Every other throw is §14's
 * "malformed LLM output": an error for the rules in that call only.
 */
export class LlmUnavailableError extends Error {}

export interface LlmProvider {
  name: string
  ask(request: LlmRequest): Promise<LlmFinding[]>
}
