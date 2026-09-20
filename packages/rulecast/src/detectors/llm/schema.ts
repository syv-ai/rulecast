import { z } from "zod"

export const llmSchema = z
  .object({
    /**
     * An alias from ./models.ts — haiku, sonnet, opus, fable — or the exact name the configured
     * provider uses. Required: there is no project-wide default, so the cost of a rule is always
     * chosen by whoever wrote it (plan 6a, Decision 1).
     */
    model: z.string().trim().min(1),
    question: z.string().trim().min(1),
    /** Send the rule's resolved context references with the question, whatever their delivery mode. */
    grounding: z.boolean().default(true),
  })
  .strict()

export type LlmConfig = z.infer<typeof llmSchema>
