import { z } from "zod"

import { outputSchema } from "../../core/detection/outputs"
import { capturesSchema, exitCodesSchema, ruleIdsSchema } from "../command/schema"

export const hookSchema = z
  .object({
    /** A hook id (or alias) in the project's .pre-commit-config.yaml, run by prek or pre-commit. */
    "pre-commit": z.string().min(1).optional(),
    /** `<hook>/<job>` in lefthook's merged config: `pre-commit/typecheck`. */
    lefthook: z
      .string()
      .regex(/^[^/\s]+\/.+$/, "lefthook names a hook and a job: pre-commit/typecheck")
      .optional(),
    /** Most hooks print gcc-style lines; a hook that prints nothing a format reads still reports its failure. */
    output: outputSchema.default({ lines: "gcc" }),
    rules: ruleIdsSchema.optional(),
    exit_codes: exitCodesSchema.optional(),
    captures: capturesSchema,
  })
  .strict()
  .refine((config) => (config["pre-commit"] === undefined) !== (config.lefthook === undefined), {
    message: "a hook rule names exactly one of pre-commit and lefthook",
  })

export type HookConfig = z.infer<typeof hookSchema>

/** The hook as people name it: its pre-commit id, or lefthook's `<hook>/<job>`. */
export const hookName = (config: HookConfig): string => config["pre-commit"] ?? config.lefthook!
