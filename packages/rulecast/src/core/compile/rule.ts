import path from "node:path"

import { sectionRange } from "../anchors"
import type { Config, RuleEntry, Stage } from "../config/schema"
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
  severity: Severity
  stages: Stage[]
  matches(file: string): boolean
  detector: CompiledDetector | null
  message: string | null
  context: ReferenceSpec[]
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
}

/** A reference's ref without its anchor, for messages. */
function fileOf(spec: ReferenceSpec): string {
  return spec.anchor === null ? spec.ref : spec.ref.slice(0, spec.ref.length - spec.anchor.length - 1)
}

/** A ready rule, or the diagnostic message that disables it. */
export async function compileRule(input: RuleInput, context: RuleContext): Promise<CompiledRule | string> {
  const { data } = input
  const minimum = data.minimum_rulecast_version
  if (minimum !== undefined && isOlder(VERSION, minimum)) {
    return `requires rulecast ${minimum} or newer (running ${VERSION})`
  }

  let detector: CompiledDetector | null = null
  let defaultStages: Stage[] = ["touch"]
  if (data.detect) {
    const [kind, rawConfig] = Object.entries(data.detect)[0]!
    const implementation = context.registry.get(kind)
    if (!implementation) return `unknown detector "${kind}"`
    // Detector schemas may refine asynchronously: ast-grep compiles the rule object against the
    // real parser, which it loads on demand (plan 5a). A synchronous schema is unaffected.
    const parsed = await implementation.schema.safeParseAsync(rawConfig ?? {})
    if (!parsed.success) return `detect.${kind}: ${formatZodError(parsed.error)}`
    detector = { kind, config: parsed.data, captures: implementation.captures(parsed.data) }
    defaultStages = implementation.events(parsed.data)
  }
  const stages: Stage[] = data.stages ?? context.config.defaultStages ?? defaultStages

  if (detector) {
    if (data.message === undefined) return "rules with detect need a message"
    if (!stages.includes("edit") && !stages.includes("verify")) {
      return "stages [touch] never run the detector: add edit or verify, or remove detect"
    }
    const known = new Set<string>([...CORE_VARIABLES, ...detector.captures])
    const unknown = templateVariables(data.message).find((name) => !known.has(name))
    if (unknown) return `unknown template variable "${unknown}"`
  } else {
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

  const { global } = context
  return {
    id: data.alias ?? data.id,
    name: data.name,
    description: data.description ?? null,
    source: input.source,
    severity: data.severity ?? "error",
    stages,
    matches: (file) => global(file) && filter(file),
    detector,
    message: data.message ?? null,
    context: references,
  }
}
