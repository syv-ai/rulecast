import { z } from "zod"

import { outputSchema } from "../../core/detection/outputs"
import { CORE_VARIABLES } from "../../core/template"

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Which of the tool's streams holds its findings. */
export const streamSchema = z.enum(["stdout", "stderr", "both"])

/** Exit codes that mean the tool failed, not "no findings": ty's 2 (bad config) and 101 (internal error). */
export const exitCodesSchema = z.object({ error: z.array(z.number().int()).min(1) }).strict()

/** Only findings with these rule ids; several rules can share one run and split its findings. */
export const ruleIdsSchema = z.array(z.string().min(1)).min(1)

/** Fields a rule's message can use beyond the core ones, which the tool must emit on every finding. */
export const capturesSchema = z
  .array(z.string().regex(VARIABLE_NAME, "a capture must be a template variable name"))
  .default([])
  .superRefine((captures, ctx) => {
    for (const name of captures) {
      if ((CORE_VARIABLES as readonly string[]).includes(name)) {
        ctx.addIssue({ code: "custom", message: `"${name}" is a core template variable` })
      }
    }
  })

export const commandSchema = z
  .object({
    /** argv. The element exactly "{{files}}" is replaced by the rule's files; otherwise they are appended. */
    run: z.array(z.string().min(1)).min(1),
    output: outputSchema.default("json"),
    stream: streamSchema.optional(),
    rules: ruleIdsSchema.optional(),
    exit_codes: exitCodesSchema.optional(),
    /**
     * `files` (the default): the tool is given the rule's files. `project`: it runs on the whole
     * project with no files, and only findings in the rule's files are kept — a type checker or a
     * dead-code tool, whose answer about one file depends on the rest.
     */
    scope: z.enum(["files", "project"]).optional(),
    captures: capturesSchema,
  })
  .strict()

export type CommandConfig = z.infer<typeof commandSchema>
