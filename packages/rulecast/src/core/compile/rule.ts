import path from "node:path"

import { sectionRange } from "../anchors"
import type { Config, Mode, RuleEntry, RuleExamples, RuleScope, Stage } from "../config/schema"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError } from "../errors"
import { compileFilter, type FileFilter } from "../files"
import { parseReference, type ReferenceRoot, type ReferenceSpec, ReferenceSyntaxError } from "../references"
import { CORE_VARIABLES, templateVariables } from "../template"
import type { Severity } from "../types"
import { isOlder, VERSION } from "../version"

export interface CompiledDetector {
  kind: string
  config: unknown
  captures: string[]
}

export interface CompiledRule {
  /** alias when set, else id: the name findings, dedupe and session state use. */
  id: string
  name: string
  description: string | null
  /** "local", or the rule repo label ("syv-ai/rulecast@v0.2.0"). */
  source: string
  /** In unattended mode, `error` for a rule with `escalate: true` or one the config's `unattended.escalate` names. */
  severity: Severity
  /**
   * How a finding of this rule is classified against the baseline (spec §8). `instance` — the
   * default, and every rule before 0.2 — is new when the match touches a changed line. `container`
   * is new when the node the match spans was not already violating the rule at the baseline.
   */
  scope: RuleScope
  /**
   * Refuse the agent's write when this rule fires on what it is writing (spec §9, Guard). A rule
   * with `refuse_write: unattended` has it only when compiled for unattended mode.
   */
  refuseWrite: boolean
  /** false: switched off with `enabled: false`; never selected for an event (spec §4). */
  enabled: boolean
  stages: Stage[]
  /** The rule's own `files` and `exclude`, as written, for `rulecast list`; `matches` is what decides. */
  patterns: { files: string; exclude: string }
  matches(file: string): boolean
  detector: CompiledDetector | null
  message: string | null
  context: ReferenceSpec[]
  /**
   * `rulecast fix` may apply this rule's fix: its detector says the config carries one, and the rule
   * has a `bad` example to prove it on. Hooks never apply one, whatever this says.
   */
  fixable: boolean
  /**
   * Inline good/bad examples, run by `rulecast test`. `null` when the rule declared none, which
   * `validate` and `test` report differently from a rule that declared an empty set.
   */
  examples: RuleExamples | null
}

/**
 * A rule that runs a detector. compileRule enforces the split — a rule with `detect` must also
 * have a `message` and an edit or verify stage; one without must have neither and must have
 * `context` — so selection can narrow to this and consumers stop asserting what it already knows.
 */
export type DetectorRule = CompiledRule & { detector: CompiledDetector; message: string }

/** A rule with no detector: it delivers its `context` when a matching file is touched. */
export type TouchRule = CompiledRule & { detector: null }

/** Whether this rule runs a detector, as a type guard so the narrowing survives a filter. */
export function isDetectorRule(rule: CompiledRule): rule is DetectorRule {
  return rule.detector !== null
}

export interface RuleInput {
  /** A local rule, or a manifest rule with the config's override merged over it. */
  data: RuleEntry & { name: string }
  source: string
  /** Where `context` resolves: the project, unless the context came from a manifest. */
  contextRoot: ReferenceRoot
}

export interface RuleContext {
  config: Config
  registry: DetectorRegistry
  /** The config's global files/exclude, applied before every rule's own. */
  global: FileFilter
  /** Reads an absolute path once per compile; null when missing. */
  read(file: string): Promise<string | null>
  /** Default: attended. */
  mode?: Mode
}

/** A reference's ref without its anchor, for messages. */
function fileOf(spec: ReferenceSpec): string {
  return spec.anchor === null ? spec.ref : spec.ref.slice(0, spec.ref.length - spec.anchor.length - 1)
}

/**
 * The diagnostic for a rule that needs a newer rulecast, read from the raw rule before the strict
 * parse: a rule using a key added after this version must say "upgrade", not "unrecognized key".
 */
export function requiresNewer(raw: unknown): string | null {
  const minimum = (raw as { minimum_rulecast_version?: unknown } | null)?.minimum_rulecast_version
  if (typeof minimum !== "string" || !isOlder(VERSION, minimum)) return null
  return `requires rulecast ${minimum} or newer (running ${VERSION})`
}

/** What `fix` on a rule with no `bad` example becomes: the fix is dropped, the rule still runs. */
export const FIX_WITHOUT_EXAMPLE =
  "fix ignored: a rule with fix needs at least one bad example for rulecast test to apply it to"

/** A ready rule with what `validate` should warn about it, or the diagnostic message that disables it. */
export async function compileRule(
  input: RuleInput,
  context: RuleContext,
): Promise<{ rule: CompiledRule; warnings: string[] } | string> {
  const { data } = input
  const tooNew = requiresNewer(data)
  if (tooNew !== null) return tooNew

  const warnings: string[] = []
  let detector: CompiledDetector | null = null
  let hasFix = false
  let defaultStages: Stage[] = ["touch"]
  if (data.detect) {
    const [kind, rawConfig] = Object.entries(data.detect)[0]!
    const implementation = context.registry.get(kind)
    if (!implementation) return `unknown detector "${kind}"`
    // Asked of the detector, not of its kind name: a plugin that can fix needs no edit here.
    if (
      implementation.fixable === undefined &&
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      "fix" in rawConfig
    ) {
      const kinds = context.registry.kinds().filter((name) => context.registry.get(name)?.fixable !== undefined)
      return `fix is supported by ${kinds.join(" and ")} rules only; ${kind} cannot apply one`
    }
    // Detector schemas may refine asynchronously: ast-grep compiles the rule object against the
    // real parser, which it loads on demand (plan 5a). A synchronous schema is unaffected.
    const parsed = await implementation.schema.safeParseAsync(rawConfig ?? {})
    if (!parsed.success)
      return formatZodError(parsed.error, { prefix: `detect.${kind}`, schema: implementation.schema })
    detector = { kind, config: parsed.data, captures: implementation.captures(parsed.data) }
    defaultStages = implementation.events(parsed.data)
    hasFix = implementation.fixable?.(parsed.data) === true
  }
  const stages: Stage[] = data.stages ?? context.config.defaultStages ?? defaultStages

  if (detector) {
    if (data.message === undefined) return "rules with detect need a message"
    if (!stages.includes("edit") && !stages.includes("verify")) {
      return "stages [touch] never run the detector: add edit or verify, or remove detect"
    }
    if (data.refuse_write) {
      // Refusing happens before the write, so the detector must judge content it is handed rather
      // than a path it reads: a linter, a command or a model would judge the file as it still is.
      if (context.registry.get(detector.kind)?.guards !== true) {
        return `refuse_write needs a detector that can judge a file before it is written; ${detector.kind} cannot`
      }
      if (!stages.includes("edit")) return "refuse_write needs edit among the rule's stages"
    }
    const known = new Set<string>([...CORE_VARIABLES, ...detector.captures])
    const unknown = templateVariables(data.message).find((name) => !known.has(name))
    if (unknown) return `unknown template variable "${unknown}"`
  } else {
    if (data.refuse_write) return "refuse_write needs detect: there is nothing to refuse a write for"
    if (data.scope) return "scope needs detect: there is nothing to classify"
    if (data.examples) return "examples need detect: there is nothing to run them against"
    if (stages.some((stage) => stage !== "touch")) return "rules without detect need stages: [touch]"
    if (data.message !== undefined) return "message needs detect"
    if (!data.context?.length) return "rules without detect need context"
  }

  const filter = compileFilter({
    files: data.files ?? "",
    exclude: data.exclude ?? "^$",
    types: data.types ?? ["file"],
    typesOr: data.types_or ?? [],
    excludeTypes: data.exclude_types ?? [],
  })
  if (typeof filter === "string") return filter

  // An example the rule would never be given is an example that passes for the wrong reason. This
  // checks the rule's own filter, not the project's global one: the example documents the rule.
  const examples = data.examples
  for (const example of [...(examples?.good ?? []), ...(examples?.bad ?? []), ...(examples?.baseline ?? [])]) {
    if (!filter(example.path)) return `example path "${example.path}" does not match this rule's files`
  }
  // A line past the end can never be found, so the example could only ever fail — and the author
  // would read the failure as the rule's.
  for (const [index, example] of (examples?.bad ?? []).entries()) {
    const past = beyondEnd(example.expect?.lines ?? [], example.code)
    if (past !== null)
      return `example bad[${index}] expects line ${past}; its code has ${lineCount(example.code)} lines`
  }
  for (const [index, example] of (examples?.baseline ?? []).entries()) {
    const past = beyondEnd([...example.expect.new, ...example.expect.preexisting], example.after)
    if (past !== null) {
      return `example baseline[${index}] expects line ${past}; its after has ${lines(example.after)}`
    }
  }

  const references: ReferenceSpec[] = []
  for (const reference of data.context ?? []) {
    let spec: ReferenceSpec
    try {
      spec = parseReference(reference, context.config.context.mode, input.contextRoot)
    } catch (error) {
      if (error instanceof ReferenceSyntaxError) return error.message
      throw error
    }
    const text = await context.read(path.resolve(input.contextRoot.dir, spec.path))
    if (text === null) return `referenced file not found: ${fileOf(spec)}`
    if (spec.anchor !== null && !sectionRange(text, spec.anchor)) {
      return `anchor "#${spec.anchor}" not found in ${fileOf(spec)}`
    }
    references.push(spec)
  }

  // A fix is applied without anyone reading it first, so it has to have been seen to work: a rule
  // with no bad example keeps running, but `rulecast fix` leaves its findings alone. An error would
  // switch the rule off in every hook over a check only `rulecast fix` needs.
  const bad = data.examples?.bad ?? []
  if (hasFix && bad.length === 0) warnings.push(FIX_WITHOUT_EXAMPLE)
  if (!hasFix && bad.some((example) => example.fixed !== undefined)) {
    warnings.push("fixed is only checked for rules with fix")
  }

  const { global } = context
  const id = data.alias ?? data.id
  const unattended = context.mode === "unattended"
  const escalated = data.escalate === true || context.config.unattended.escalate.includes(id)
  const rule: CompiledRule = {
    id,
    name: data.name,
    description: data.description ?? null,
    source: input.source,
    severity: unattended && escalated ? "error" : (data.severity ?? "error"),
    scope: data.scope ?? "instance",
    refuseWrite: data.refuse_write === true || (unattended && data.refuse_write === "unattended"),
    enabled: data.enabled !== false,
    stages,
    patterns: { files: data.files ?? "", exclude: data.exclude ?? "^$" },
    matches: (file) => global(file) && filter(file),
    detector,
    message: data.message ?? null,
    context: references,
    fixable: hasFix && bad.length > 0,
    examples: data.examples ?? null,
  }
  return { rule, warnings }
}

/** Lines in an example's code, not counting the empty one after a final newline. */
function lineCount(code: string): number {
  const lines = code.split(/\r?\n/)
  return lines.at(-1) === "" ? lines.length - 1 : lines.length
}

function lines(code: string): string {
  const count = lineCount(code)
  return `${count} ${count === 1 ? "line" : "lines"}`
}

function beyondEnd(lines: readonly number[], code: string): number | null {
  const count = lineCount(code)
  return lines.find((line) => line > count) ?? null
}
