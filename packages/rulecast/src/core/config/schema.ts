import { z } from "zod"

import { referenceInputSchema } from "../references"
import { LLM_PROVIDERS } from "../types"

export const STAGES = ["touch", "edit", "verify"] as const
export type Stage = (typeof STAGES)[number]

export const RULE_ID = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

const idSchema = z.string().regex(RULE_ID, "must be lowercase segments separated by /")
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version like 0.2.0")
const stagesSchema = z.array(z.enum(STAGES)).nonempty()

/** Every rule key except id. No defaults: compileRule applies them after overrides are merged. */
const ruleKeys = {
  alias: idSchema.optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  files: z.string().optional(),
  exclude: z.string().optional(),
  types: z.array(z.string()).optional(),
  types_or: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  stages: stagesSchema.optional(),
  minimum_rulecast_version: versionSchema.optional(),
  severity: z.enum(["error", "warning"]).optional(),
  detect: z
    .record(z.unknown())
    .refine((value) => Object.keys(value).length === 1, "must name exactly one detector")
    .optional(),
  message: z.string().optional(),
  context: z.array(referenceInputSchema).optional(),
}

/** A config entry selecting a rule from a rule repo; every key but id overrides the manifest rule's. */
export const overrideSchema = z.object({ id: idSchema, ...ruleKeys }).strict()

/** A complete rule: an entry of a `repo: local` repo, or a manifest rule. */
export const ruleSchema = overrideSchema.extend({ name: z.string().min(1) })

export type RuleEntry = z.infer<typeof overrideSchema>

const repoSchema = z
  .object({
    repo: z.string().min(1),
    rev: z.string().min(1).optional(),
    /** Parsed rule by rule in compile, so one bad rule does not reject the config. */
    rules: z.array(z.unknown()),
  })
  .strict()

export const configSchema = z
  .object({
    repos: z.array(repoSchema),
    minimum_rulecast_version: versionSchema.optional(),
    files: z.string().default(""),
    exclude: z.string().default("^$"),
    default_stages: stagesSchema.optional(),
    context: z
      .object({
        mode: z.enum(["inject", "read"]).default("inject"),
        max_bytes: z.number().int().positive().default(32768),
      })
      .strict()
      .default({}),
    max_matches_per_rule: z.number().int().positive().default(10),
    timeouts: z
      .object({
        edit_deadline_ms: z.number().int().positive().default(350),
        verify_ms: z.number().int().positive().default(60000),
      })
      .strict()
      .default({}),
    stop_gate: z
      .object({ max_blocks: z.number().int().nonnegative().default(1) })
      .strict()
      .default({}),
    llm: z
      .object({
        // No `model`: every llm rule names its own (plan 6a, Decision 1).
        provider: z.enum(LLM_PROVIDERS).default("claude-code"),
        base_url: z.string().nullable().default(null),
        api_key_env: z.string().default("ANTHROPIC_API_KEY"),
        max_files_per_verify: z.number().int().positive().default(10),
      })
      .strict()
      .default({}),
  })
  .strict()
  .transform((input) => ({
    repos: input.repos,
    minimumRulecastVersion: input.minimum_rulecast_version ?? null,
    files: input.files,
    exclude: input.exclude,
    defaultStages: input.default_stages ?? null,
    context: { mode: input.context.mode, maxBytes: input.context.max_bytes },
    maxMatchesPerRule: input.max_matches_per_rule,
    timeouts: { editDeadlineMs: input.timeouts.edit_deadline_ms, verifyMs: input.timeouts.verify_ms },
    stopGate: { maxBlocks: input.stop_gate.max_blocks },
    llm: {
      provider: input.llm.provider,
      baseUrl: input.llm.base_url,
      apiKeyEnv: input.llm.api_key_env,
      maxFilesPerVerify: input.llm.max_files_per_verify,
    },
  }))

export type Config = z.output<typeof configSchema>
export type RepoEntry = Config["repos"][number]

export function defaultConfig(): Config {
  return configSchema.parse({ repos: [] })
}
