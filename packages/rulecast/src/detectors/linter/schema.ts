import { z } from "zod"

export const TOOL_NAMES = ["eslint", "gitleaks", "oxlint", "ruff"] as const

export const linterSchema = z
  .object({
    tool: z.enum(TOOL_NAMES),
    /**
     * Linter rule ids to report, turned on for rulecast's run even where the project's config leaves
     * them off. Omitted: every finding the tool reports under the project's own config.
     */
    rules: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()

export type LinterConfig = z.infer<typeof linterSchema>
export type ToolName = (typeof TOOL_NAMES)[number]
