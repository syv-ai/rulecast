import { readFile } from "node:fs/promises"
import path from "node:path"
import picomatch from "picomatch"

import { sectionRange } from "../anchors"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError, isNotFound } from "../errors"
import { parseReference, type ReferenceSpec, ReferenceSyntaxError } from "../references"
import { CORE_VARIABLES, templateVariables } from "../template"
import type { DetectorEvent, Severity, Trigger } from "../types"
import { CONFIG_PATH, type Config, defaultConfig, loadConfig } from "./config"
import { loadRuleFiles, type RuleData, ruleSchema } from "./rules"

export interface CompiledDetector {
  kind: string
  config: unknown
  captures: string[]
  events: DetectorEvent[]
}

export interface CompiledRule {
  id: string
  source: string
  severity: Severity
  on: Trigger[]
  matches(file: string): boolean
  detector: CompiledDetector | null
  message: string | null
  context: ReferenceSpec[]
}

export interface Diagnostic {
  source: string
  rule: string | null
  message: string
}

export interface CompiledProject {
  root: string
  config: Config
  rules: CompiledRule[]
  diagnostics: Diagnostic[]
}

/** Reads a repo-relative text file once per compile; null when missing. */
function createReader(root: string) {
  const texts = new Map<string, Promise<string | null>>()
  return (file: string) => {
    let text = texts.get(file)
    if (!text) {
      text = readFile(path.join(root, file), "utf8").catch((error: unknown) => {
        if (isNotFound(error)) return null
        throw error
      })
      texts.set(file, text)
    }
    return text
  }
}

async function compileRule(
  data: RuleData,
  source: string,
  config: Config,
  registry: DetectorRegistry,
  read: (file: string) => Promise<string | null>,
): Promise<CompiledRule | string> {
  const violation = data.on.includes("violation")
  if (violation && (!data.detect || data.message === undefined)) {
    return "rules with on: violation need detect and message"
  }
  if (!violation && (data.detect || data.message !== undefined || data.context.length === 0)) {
    return "rules with on: [touch] only need context"
  }

  let detector: CompiledDetector | null = null
  if (data.detect) {
    const [kind, rawConfig] = Object.entries(data.detect)[0]!
    const implementation = registry.get(kind)
    if (!implementation) return `unknown detector "${kind}"`
    const parsed = implementation.schema.safeParse(rawConfig ?? {})
    if (!parsed.success) return `detect.${kind}: ${formatZodError(parsed.error)}`
    detector = {
      kind,
      config: parsed.data,
      captures: implementation.captures(parsed.data),
      events: data.events ?? implementation.events(parsed.data),
    }
    const known = new Set<string>([...CORE_VARIABLES, ...detector.captures])
    const unknown = templateVariables(data.message ?? "").find((name) => !known.has(name))
    if (unknown) return `unknown template variable "${unknown}"`
  }

  const context: ReferenceSpec[] = []
  for (const input of data.context) {
    let spec: ReferenceSpec
    try {
      spec = parseReference(input, config.context.mode)
    } catch (error) {
      if (error instanceof ReferenceSyntaxError) return error.message
      throw error
    }
    const text = await read(spec.path)
    if (text === null) return `referenced file not found: ${spec.path}`
    if (spec.anchor !== null && !sectionRange(text, spec.anchor)) {
      return `anchor "#${spec.anchor}" not found in ${spec.path}`
    }
    context.push(spec)
  }

  const include = picomatch(data.files, { dot: true })
  const exclude = data.ignore.length ? picomatch(data.ignore, { dot: true }) : () => false
  return {
    id: data.id,
    source,
    severity: data.severity,
    on: data.on,
    matches: (file) => include(file) && !exclude(file),
    detector,
    message: data.message ?? null,
    context,
  }
}

export async function compile(root: string, registry: DetectorRegistry): Promise<CompiledProject> {
  const loaded = await loadConfig(root)
  if (!loaded.ok) {
    return {
      root,
      config: defaultConfig(),
      rules: [],
      diagnostics: [{ source: CONFIG_PATH, rule: null, message: loaded.message }],
    }
  }
  const config = loaded.config
  const read = createReader(root)
  const diagnostics: Diagnostic[] = []
  const compiled: CompiledRule[] = []

  for (const file of await loadRuleFiles(root, config.rules)) {
    if (!file.ok) {
      diagnostics.push({ source: file.source, rule: null, message: file.message })
      continue
    }
    const parsed = ruleSchema.safeParse(file.data)
    if (!parsed.success) {
      const id = (file.data as { id?: unknown } | null)?.id
      diagnostics.push({
        source: file.source,
        rule: typeof id === "string" ? id : null,
        message: formatZodError(parsed.error),
      })
      continue
    }
    const result = await compileRule(parsed.data, file.source, config, registry, read)
    if (typeof result === "string") {
      diagnostics.push({ source: file.source, rule: parsed.data.id, message: result })
    } else {
      compiled.push(result)
    }
  }

  const sourcesById = new Map<string, string[]>()
  for (const rule of compiled) sourcesById.set(rule.id, [...(sourcesById.get(rule.id) ?? []), rule.source])
  const rules = compiled.filter((rule) => {
    const sources = sourcesById.get(rule.id)!
    if (sources.length === 1) return true
    const others = sources.filter((source) => source !== rule.source).join(", ")
    diagnostics.push({
      source: rule.source,
      rule: rule.id,
      message: `duplicate rule id "${rule.id}" (also in ${others})`,
    })
    return false
  })

  // Code-point order, like loadRuleFiles: independent of the machine's locale.
  diagnostics.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
  return { root, config, rules, diagnostics }
}
