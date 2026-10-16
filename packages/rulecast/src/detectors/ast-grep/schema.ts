import type { NapiConfig } from "@ast-grep/napi"
import { z } from "zod"

import { errorMessage } from "../../core/errors"
import { LANGUAGE_NAMES } from "./languages"
import { parserFor } from "./load"
import { METAVARIABLE, metavariables } from "./metavars"

const ruleObject = z.record(z.unknown()).refine((rule) => Object.keys(rule).length > 0, "rule must not be empty")

export const astGrepSchema = z
  .object({
    language: z.enum(LANGUAGE_NAMES),
    rule: ruleObject,
    constraints: z.record(ruleObject).optional(),
    utils: z.record(ruleObject).optional(),
    /**
     * The match's replacement, in ast-grep's own syntax: `$NAME` and `$$$NAMES` are what they
     * matched. Only the string form: ast-grep's FixConfig object (`expandStart`, `expandEnd`),
     * `transform` and `rewriters` are not supported, and the strict schema refuses them.
     */
    fix: z
      .string({
        invalid_type_error: "fix must be a string: the FixConfig object (expandStart, expandEnd) is not supported",
      })
      .optional(),
  })
  .strict()
  .superRefine(async (config, ctx) => {
    if (config.fix !== undefined) {
      const known = new Set(metavariables(matcher(config)).map((variable) => variable.name))
      for (const found of config.fix.matchAll(METAVARIABLE)) {
        const name = found[1] ?? found[2]!
        if (!known.has(name)) {
          ctx.addIssue({ code: "custom", path: ["fix"], message: `fix uses $${name}, which the rule does not capture` })
        }
      }
    }
    try {
      // Compiling the matcher is the only way to find out whether ast-grep accepts the rule.
      // An empty source parses in microseconds and makes findAll do the compiling.
      const parser = await parserFor(config.language)
      parser.parse("").root().findAll(matcher(config))
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["rule"], message: oneLine(errorMessage(error)) })
    }
  })

export type AstGrepConfig = z.infer<typeof astGrepSchema>

/** ast-grep spreads its complaints over several lines; compile diagnostics are one line each. */
function oneLine(message: string): string {
  return message
    .split("\n")
    .map((line) => line.replace(/^\s*\|->\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
}

/**
 * The NapiConfig handed to findAll. The rule object is arbitrary YAML until ast-grep compiles it,
 * which the schema's refinement does, so this is the one cast at the boundary.
 */
export function matcher(config: AstGrepConfig): NapiConfig {
  // `fix` is applied by rulecast (fix.ts), not by findAll, and its metavariables capture nothing.
  const { language: _language, fix: _fix, ...rest } = config
  return rest as NapiConfig
}

export function captureNames(config: AstGrepConfig): string[] {
  return metavariables(matcher(config)).map((variable) => variable.name)
}
