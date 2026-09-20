import { z } from "zod"

export const TOOL_NAMES = ["eslint", "oxlint", "ruff"] as const

export const linterSchema = z
  .object({
    tool: z.enum(TOOL_NAMES),
    /** Linter rule ids to report. Omitted: every finding the tool reports. */
    rules: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()

export type LinterConfig = z.infer<typeof linterSchema>
export type ToolName = (typeof TOOL_NAMES)[number]
