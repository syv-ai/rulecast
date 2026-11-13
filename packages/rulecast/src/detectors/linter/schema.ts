import { z } from "zod"

export const TOOL_NAMES = ["biome", "eslint", "gitleaks", "oxlint", "ruff"] as const

export const linterSchema = z
  .object({
    tool: z.enum(TOOL_NAMES),
    /**
     * Linter rule ids to report, turned on for rulecast's run even where the project's config leaves
     * them off. Omitted: what the project's own config makes an error.
     */
    rules: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()

export type LinterConfig = z.infer<typeof linterSchema>
export type ToolName = (typeof TOOL_NAMES)[number]
