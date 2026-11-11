import path from "node:path"
import { z } from "zod"

import { parseReported } from "../errors"
import { referenceInputSchema } from "../references"
import { LLM_PROVIDERS } from "../types"

export const STAGES = ["touch", "edit", "verify"] as const
export type Stage = (typeof STAGES)[number]

export const RULE_ID = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

/**
 * Whether a person answers the agent (`attended`) or nobody does: a goal loop, `claude -p`, a
 * scheduled task, CI (`unattended`). Resolved in core/config/mode.ts; only agent hooks act on it.
 */
export const MODES = ["attended", "unattended"] as const
export type Mode = (typeof MODES)[number]

export const RULE_SCOPES = ["instance", "container", "removed"] as const
export type RuleScope = (typeof RULE_SCOPES)[number]

const idSchema = z.string().regex(RULE_ID, "must be lowercase segments separated by /")
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version like 0.2.0")
const stagesSchema = z.array(z.enum(STAGES)).nonempty()

/**
 * One inline example: a file the rule would see, and what is in it.
 *
 * `path` is required and has no useful default — `files`, `exclude`, the type tags and `ast-grep`'s
 * language selection are all functions of it, so an example without one would be testing a
 * different rule than the one that will run.
 */
const exampleSchema = z.object({ path: z.string().min(1), code: z.string() }).strict()

const linesSchema = z.array(z.number().int().positive())

/**
 * A `bad` example, optionally pinning what the rule finds in it. Without `expect` it passes on at
 * least one finding, as it always has. It may also say what the rule's `fix` must turn it into,
 * exactly.
 */
const badExampleSchema = exampleSchema
  .extend({
    expect: z
      .object({
        /** The exact number of matches. */
        count: z.number().int().positive().optional(),
        /** The line each match starts on, as a set: each has one, and no match starts on another. */
        lines: linesSchema.nonempty().optional(),
      })
      .strict()
      .refine((expect) => expect.count !== undefined || expect.lines !== undefined, "expect needs count or lines")
      .optional(),
    fixed: z.string().optional(),
  })
  .strict()

/**
 * A file before and after an edit, and which of the rule's findings in `after` are the edit's.
 * Its own list rather than a `before` on a `bad` example: a baseline case can rightly expect no new
 * finding, and a `bad` example that expects none is a contradiction.
 */
const baselineExampleSchema = z
  .object({
    path: z.string().min(1),
    before: z.string(),
    after: z.string(),
    /** Lines of findings by status, as sets. A status not listed must have no findings. */
    expect: z.object({ new: linesSchema.default([]), preexisting: linesSchema.default([]) }).strict(),
  })
  .strict()

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
  /** true: `error` in unattended mode, as if `unattended.escalate` named the rule. A catalog default an override can turn off. */
  escalate: z.boolean().optional(),
  /**
   * What the convention belongs to (§8). `instance`: the token the detector matched, classified by
   * whether the agent's edit touched it. `container`: the node the match spans, classified by
   * whether that node already violated the rule at the baseline. `removed`: a match is something
   * the rule keeps, and the finding is a file with fewer matches than at its baseline.
   */
  scope: z.enum(RULE_SCOPES).optional(),
  /** `unattended`: refuse only when no one is in the loop (core/config/mode.ts); `true`: always. */
  refuse_write: z.union([z.boolean(), z.literal("unattended")]).optional(),
  /** false: compiled and listed, selected for nothing. The way to switch a catalog rule off without deleting it. */
  enabled: z.boolean().optional(),
  detect: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length === 1, "must name exactly one detector")
    .optional(),
  message: z.string().optional(),
  context: z.array(referenceInputSchema).optional(),
  /**
   * Sections delivered with the findings of one lint rule only, keyed by the rule id exactly as
   * `{{ruleId}}` shows it. For detectors that report rule ids (linter, command, hook).
   */
  context_by_rule: z
    .record(z.string(), z.union([referenceInputSchema, z.array(referenceInputSchema).nonempty()]))
    .optional(),
  /**
   * Code the rule must flag (`bad`) and must not (`good`), and edits whose findings it must sort
   * into new and pre-existing (`baseline`), run by `rulecast test`.
   */
  examples: z
    .object({
      good: z.array(exampleSchema).default([]),
      bad: z.array(badExampleSchema).default([]),
      baseline: z.array(baselineExampleSchema).default([]),
    })
    .strict()
    .optional(),
}

export type RuleExample = z.infer<typeof exampleSchema>
export type BadRuleExample = z.infer<typeof badExampleSchema>
export type BaselineRuleExample = z.infer<typeof baselineExampleSchema>
export type RuleExamples = { good: RuleExample[]; bad: BadRuleExample[]; baseline: BaselineRuleExample[] }

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

const notCheckedEntrySchema = z.object({ context: z.string(), reason: z.string().trim().min(1) }).strict()

/**
 * The `not_checked` entries that parse, and what is wrong with each one that does not. No rule
 * depends on an entry, so a typo in one (`why:` for `reason:`) must not stop the config loading and
 * with it every rule: compile reports the problems as warnings, and the entry is left out.
 */
/** A `not_checked` entry that parsed, with its place in the file's list, which every warning names. */
export type NotCheckedEntry = z.output<typeof notCheckedEntrySchema> & { index: number }

function notCheckedOf(value: unknown): {
  notChecked: NotCheckedEntry[]
  notCheckedProblems: string[]
} {
  if (value === undefined || value === null) return { notChecked: [], notCheckedProblems: [] }
  if (!Array.isArray(value)) {
    return { notChecked: [], notCheckedProblems: ["not_checked: must be a list of { context, reason }"] }
  }
  const notChecked: NotCheckedEntry[] = []
  const notCheckedProblems: string[] = []
  for (const [index, entry] of value.entries()) {
    const parsed = parseReported(notCheckedEntrySchema, entry, `not_checked[${index}]`)
    if (parsed.success) notChecked.push({ ...parsed.data, index })
    else notCheckedProblems.push(parsed.message)
  }
  return { notChecked, notCheckedProblems }
}

export const configSchema = z
  .object({
    repos: z.array(repoSchema),
    minimum_rulecast_version: versionSchema.optional(),
    files: z.string().default(""),
    exclude: z.string().default("^$"),
    default_stages: stagesSchema.optional(),
    /**
     * Where new conventions are written: a file, or a folder of files by area (plan 20). Relative to
     * this config's directory. A config without one uses the nearest config above that names one
     * (core/config/conventions.ts), the one key that is inherited.
     */
    conventions: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !path.isAbsolute(value), "must be relative to the config's directory")
      .nullable()
      .default(null),
    /**
     * Conventions considered and given no rule, each with the section that states it and why. Kept
     * here rather than as a note in the project's docs, which stay free of rulecast's terms; `rulecast
     * list` shows them so a later session does not propose the rule again. Parsed on its own in the
     * transform (notCheckedOf), so a malformed entry is set aside rather than failing the config.
     */
    not_checked: z.unknown().optional(),
    context: z
      .object({
        mode: z.enum(["inject", "read"]).default("inject"),
        max_bytes: z.number().int().positive().default(32768),
      })
      .strict()
      .prefault({}),
    max_matches_per_rule: z.number().int().positive().default(10),
    /**
     * Files above this many bytes are skipped by the in-process detectors on edit and guard, where
     * an agent is waiting. `ast-grep` parses in native code, which the vm timeout that bounds
     * `regex` cannot interrupt: a 2.6 MB TypeScript file measured 762 ms, and the cost is linear,
     * so 26 MB would be 7.6 s of a blocked write. verify has seconds to spend and always runs.
     */
    max_file_bytes: z.number().int().positive().default(1048576),
    timeouts: z
      .object({
        edit_deadline_ms: z.number().int().positive().default(350),
        verify_ms: z.number().int().positive().default(60000),
      })
      .strict()
      .prefault({}),
    stop_gate: z
      .object({ max_blocks: z.number().int().nonnegative().default(1) })
      .strict()
      .prefault({}),
    refuse_gate: z
      .object({ max_refusals: z.number().int().nonnegative().default(1) })
      .strict()
      .prefault({}),
    /** Overrides detection from CI / GITHUB_ACTIONS; RULECAST_MODE overrides this. */
    mode: z.enum(MODES).optional(),
    unattended: z
      .object({
        /**
         * Stops blocked per agent per prompt when nobody is in the loop, in place of
         * stop_gate.max_blocks. A goal-driven or headless run sends one prompt, so the attended
         * default of 1 would give the whole run one block; a finding that blocks twice stops
         * blocking whatever this says (session/decide.ts), so a false positive cannot use it all.
         */
        max_blocks: z.number().int().nonnegative().default(10),
        /** Warning rules, by the id findings show, that are errors when nobody is in the loop. */
        escalate: z.array(idSchema).default([]),
      })
      .strict()
      .prefault({}),
    llm: z
      .object({
        /**
         * The model llm rules run on when they name none (plan 20). Set only when the developer
         * agreed to llm rules: without it, agents never propose one.
         */
        model: z.string().trim().min(1).nullable().default(null),
        provider: z.enum(LLM_PROVIDERS).default("claude-code"),
        base_url: z.string().nullable().default(null),
        api_key_env: z.string().default("ANTHROPIC_API_KEY"),
        max_files_per_verify: z.number().int().positive().default(10),
      })
      .strict()
      .prefault({}),
    stats: z
      .object({
        /**
         * Keep 26 weeks of per-week counts for `rulecast stats` beside this config's own findings log
         * (core/stats/log.ts). Per config and never inherited: each config governs its own log.
         */
        weekly_summary: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .transform((input) => ({
    repos: input.repos,
    minimumRulecastVersion: input.minimum_rulecast_version ?? null,
    files: input.files,
    exclude: input.exclude,
    defaultStages: input.default_stages ?? null,
    conventions: input.conventions,
    ...notCheckedOf(input.not_checked),
    context: { mode: input.context.mode, maxBytes: input.context.max_bytes },
    maxMatchesPerRule: input.max_matches_per_rule,
    maxFileBytes: input.max_file_bytes,
    timeouts: { editDeadlineMs: input.timeouts.edit_deadline_ms, verifyMs: input.timeouts.verify_ms },
    stopGate: { maxBlocks: input.stop_gate.max_blocks },
    refuseGate: { maxRefusals: input.refuse_gate.max_refusals },
    mode: input.mode ?? null,
    unattended: { maxBlocks: input.unattended.max_blocks, escalate: input.unattended.escalate },
    llm: {
      provider: input.llm.provider,
      model: input.llm.model,
      baseUrl: input.llm.base_url,
      apiKeyEnv: input.llm.api_key_env,
      maxFilesPerVerify: input.llm.max_files_per_verify,
    },
    stats: { weeklySummary: input.stats.weekly_summary },
  }))

export type Config = z.output<typeof configSchema>
export type RepoEntry = Config["repos"][number]

export function defaultConfig(): Config {
  return configSchema.parse({ repos: [] })
}
