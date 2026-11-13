import { z } from "zod"

export const llmSchema = z
  .object({
    /**
     * An alias from ./models.ts — haiku, sonnet, opus, fable — or the exact name the configured
     * provider uses. Optional: without it the rule runs on the config's `llm.model` (plan 20).
     */
    model: z.string().trim().min(1).optional(),
    question: z.string().trim().min(1),
    /** Send the rule's resolved context references with the question, whatever their delivery mode. */
    grounding: z.boolean().default(true),
    /**
     * Also show the model the definitions the change removed from its other files (#72): a class
     * moved into this file from one the change cut it out of reads as moved, not new.
     */
    removed_definitions: z.boolean().optional(),
  })
  .strict()

export type LlmConfig = z.infer<typeof llmSchema>
