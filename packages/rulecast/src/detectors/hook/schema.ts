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
    /** `<hook>/<step>` in the project's hk.pkl: `pre-commit/eslint`. Run in check mode, never fix. */
    hk: z
      .string()
      .regex(/^[^/\s]+\/.+$/, "hk names a hook and a step: pre-commit/eslint")
      .optional(),
    /** Most hooks print gcc-style lines; a hook that prints nothing a format reads still reports its failure. */
    output: outputSchema.default({ lines: "gcc" }),
    rules: ruleIdsSchema.optional(),
    exit_codes: exitCodesSchema.optional(),
    captures: capturesSchema,
  })
  .strict()
  .refine((config) => [config["pre-commit"], config.lefthook, config.hk].filter((v) => v !== undefined).length === 1, {
    message: "a hook rule names exactly one of pre-commit, lefthook and hk",
  })

export type HookConfig = z.infer<typeof hookSchema>

/** The hook as people name it: its pre-commit id, lefthook's `<hook>/<job>` or hk's `<hook>/<step>`. */
export const hookName = (config: HookConfig): string => config["pre-commit"] ?? config.lefthook ?? config.hk!

/** The hook manager a rule runs its hook with. */
export type HookManager = "pre-commit" | "lefthook" | "hk"
export const managerOf = (config: HookConfig): HookManager =>
  config["pre-commit"] !== undefined ? "pre-commit" : config.lefthook !== undefined ? "lefthook" : "hk"
