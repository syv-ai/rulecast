import { z } from "zod"

import { CORE_VARIABLES } from "../../core/template"

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export const commandSchema = z
  .object({
    /** argv. The element exactly "{{files}}" is replaced by the rule's files; otherwise they are appended. */
    run: z.array(z.string().min(1)).min(1),
    output: z.enum(["json", "sarif"]).default("json"),
    captures: z
      .array(z.string().regex(VARIABLE_NAME, "a capture must be a template variable name"))
      .default([])
      .superRefine((captures, ctx) => {
        for (const name of captures) {
          if ((CORE_VARIABLES as readonly string[]).includes(name)) {
            ctx.addIssue({ code: "custom", message: `"${name}" is a core template variable` })
          }
        }
      }),
  })
  .strict()

export type CommandConfig = z.infer<typeof commandSchema>
