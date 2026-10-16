import { readFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_FILE, MANIFEST_FILE, parseConfig, readConfigData, readManifest } from "../config/load"
import { type Config, defaultConfig, overrideSchema, type RepoEntry, ruleSchema } from "../config/schema"
import { AGENT_DIR } from "../delivery/persist"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError, isNotFound } from "../errors"
import { compileFilter } from "../files"
import type { ReferenceRoot } from "../references"
import type { RepoProvider } from "../repos/provider"
import { isOlder, VERSION } from "../version"
import { type CompiledRule, compileRule, type RuleContext, type RuleInput } from "./rule"

export interface Diagnostic {
  /** ".rulecast-config.yaml", ".rulecast-rules.yaml", or "<repo url>@<rev>" for a rule repo. */
  source: string
  rule: string | null
  message: string
  level: "error" | "warning"
  /** What a hook tells the developer to run; default "rulecast validate". Missing repos: "rulecast install". */
  hint?: string
  /**
   * The config file itself did not load, so no rule was compiled. A hook still warns; `rulecast run`
   * exits 2 instead of reporting a run that checked nothing (adapters/cli/contract.ts).
   */
  fatal?: true
  /**
   * A diagnostic about a whole `repos` entry (a repo that could not be fetched, a missing rev): the
   * rules that entry configures, by id or alias. `rulecast run RULE_ID` counts it only when it
   * names that rule. Absent on a diagnostic with no rule: it could affect any rule.
   */
  affects?: string[]
}

/** A diagnostic as people read it: the source, the rule it belongs to, and what is wrong. */
export function diagnosticText(diagnostic: Diagnostic): string {
  const rule = diagnostic.rule ? ` (${diagnostic.rule})` : ""
  return `${diagnostic.source}${rule}: ${diagnostic.message}`
}

export interface CompiledProject {
  root: string
  config: Config
  rules: CompiledRule[]
  diagnostics: Diagnostic[]
}

export interface CompileOptions {
  root: string
  registry: DetectorRegistry
  repos: RepoProvider
  /** Config data to compile instead of the project's .rulecast-config.yaml (try-repo). */
  configData?: unknown
}

/** Reads each absolute path at most once per compile; null when missing. */
function createReader(): (file: string) => Promise<string | null> {
  const texts = new Map<string, Promise<string | null>>()
  return (file) => {
    let text = texts.get(file)
    if (!text) {
      text = readFile(file, "utf8").catch((error: unknown) => {
        if (isNotFound(error)) return null
        throw error
      })
      texts.set(file, text)
    }
    return text
  }
}

function idOf(raw: unknown): string | null {
  const id = (raw as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

/** pre-commit's heuristic: a rev with no "." that is not hex is probably a branch. */
function isBranchLike(rev: string): boolean {
  return !rev.includes(".") && !/^[0-9a-f]+$/i.test(rev)
}

type Compiled = { rule: CompiledRule; source: string }

/** Drops every rule whose identity occurs more than once, with a diagnostic for each. */
function uniqueRules(compiled: Compiled[], diagnostics: Diagnostic[], message: (id: string) => string): CompiledRule[] {
  const counts = new Map<string, number>()
  for (const { rule } of compiled) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
  const rules: CompiledRule[] = []
  for (const { rule, source } of compiled) {
    if (counts.get(rule.id) === 1) rules.push(rule)
    else diagnostics.push({ source, rule: rule.id, message: message(rule.id), level: "error" })
  }
  return rules
}

/** The project config and the manifests of its pinned repos → ready rules plus diagnostics (spec §5). */
export async function compile(options: CompileOptions): Promise<CompiledProject> {
  const { root } = options
  const configFailure = (message: string, config = defaultConfig()): CompiledProject => ({
    root,
    config,
    rules: [],
    diagnostics: [{ source: CONFIG_FILE, rule: null, message, level: "error", fatal: true }],
  })

  const data =
    options.configData !== undefined ? { ok: true as const, value: options.configData } : await readConfigData(root)
  if (!data.ok) return configFailure(data.message)
  const parsed = parseConfig(data.value)
  if (!parsed.ok) return configFailure(parsed.message)
  const config = parsed.value
  if (config.minimumRulecastVersion !== null && isOlder(VERSION, config.minimumRulecastVersion)) {
    return configFailure(`requires rulecast ${config.minimumRulecastVersion} or newer (running ${VERSION})`, config)
  }
  const filter = compileFilter({
    files: config.files,
    exclude: config.exclude,
    types: [],
    typesOr: [],
    excludeTypes: [],
  })
  if (typeof filter === "string") return configFailure(filter, config)
  // rulecast's own directory is never checked: a committed baseline is a JSON file of hex ids, which
  // a secrets scanner or a `\.json$` rule would otherwise read, and the rest is rulecast's output.
  const global = (file: string) => !file.startsWith(`${AGENT_DIR}/`) && filter(file)

  const diagnostics: Diagnostic[] = []
  const compiled: Compiled[] = []
  const context: RuleContext = { config, registry: options.registry, global, read: createReader() }
  const project: ReferenceRoot = { dir: root, label: null }
  const error = (source: string, rule: string | null, message: string, hint?: string) =>
    diagnostics.push({ source, rule, message, level: "error", ...(hint === undefined ? {} : { hint }) })
  /** An error about a whole entry: none of the rules it configures compiled. */
  const entryError = (entry: RepoEntry, source: string, message: string, hint?: string) =>
    diagnostics.push({
      source,
      rule: null,
      message,
      level: "error",
      ...(hint === undefined ? {} : { hint }),
      affects: entry.rules.flatMap((raw) => {
        const alias = (raw as { alias?: unknown } | null)?.alias
        const id = typeof alias === "string" ? alias : idOf(raw)
        return id === null ? [] : [id]
      }),
    })
  const add = async (input: RuleInput, source: string) => {
    const result = await compileRule(input, context)
    if (typeof result === "string") {
      error(source, input.data.alias ?? input.data.id, result)
      return
    }
    compiled.push({ rule: result.rule, source })
    for (const message of result.warnings) diagnostics.push({ source, rule: result.rule.id, message, level: "warning" })
  }

  for (const [index, entry] of config.repos.entries()) {
    if (entry.repo === "local") {
      if (entry.rev !== undefined) {
        entryError(entry, CONFIG_FILE, `repos[${index}]: local repos take no rev`)
        continue
      }
      for (const raw of entry.rules) {
        const rule = ruleSchema.safeParse(raw)
        if (!rule.success) error(CONFIG_FILE, idOf(raw), formatZodError(rule.error, { schema: ruleSchema }))
        else await add({ data: rule.data, source: "local", contextRoot: project }, CONFIG_FILE)
      }
      continue
    }

    if (entry.rev === undefined) {
      entryError(entry, CONFIG_FILE, `repos[${index}] ${entry.repo}: rev is required`)
      continue
    }
    const source = `${entry.repo}@${entry.rev}`
    if (isBranchLike(entry.rev)) {
      diagnostics.push({
        source,
        rule: null,
        message: `rev "${entry.rev}" looks like a branch: pin a tag or a full commit SHA`,
        level: "warning",
      })
    }
    const checkout = await options.repos.checkout(entry.repo, entry.rev)
    if (!checkout.ok) {
      entryError(entry, source, checkout.message, checkout.missing ? "rulecast install" : undefined)
      continue
    }
    const manifest = await readManifest(checkout.dir)
    if (!manifest.ok) {
      entryError(entry, source, manifest.message)
      continue
    }
    const byId = new Map<string, unknown[]>()
    for (const raw of manifest.value) {
      const id = idOf(raw)
      if (id === null) continue
      const group = byId.get(id)
      if (group) group.push(raw)
      else byId.set(id, [raw])
    }
    const repoRoot: ReferenceRoot = { dir: checkout.dir, label: checkout.label }
    for (const raw of entry.rules) {
      const override = overrideSchema.safeParse(raw)
      if (!override.success) {
        error(CONFIG_FILE, idOf(raw), formatZodError(override.error, { schema: overrideSchema }))
        continue
      }
      const { id } = override.data
      const candidates = byId.get(id) ?? []
      if (candidates.length !== 1) {
        error(source, id, candidates.length === 0 ? "not in the manifest" : "defined more than once in the manifest")
        continue
      }
      const base = ruleSchema.safeParse(candidates[0])
      if (!base.success) {
        error(source, id, formatZodError(base.error, { prefix: "manifest", schema: ruleSchema }))
        continue
      }
      // Shallow merge (spec §4); an overridden context is written in the project, so it resolves there.
      const data = { ...base.data, ...override.data }
      const contextRoot = "context" in override.data ? project : repoRoot
      await add({ data, source: checkout.label, contextRoot }, source)
    }
  }

  const rules = uniqueRules(
    compiled,
    diagnostics,
    (id) => `rule "${id}" is configured more than once: give one an alias`,
  )
  return { root, config, rules, diagnostics }
}

/** A manifest on its own (validate, the init catalog): references resolve against `dir`. */
export async function compileManifest(
  dir: string,
  registry: DetectorRegistry,
  file = path.join(dir, MANIFEST_FILE),
): Promise<{ rules: CompiledRule[]; diagnostics: Diagnostic[] }> {
  const source = path.basename(file)
  const manifest = await readManifest(dir, file)
  if (!manifest.ok) {
    return {
      rules: [],
      diagnostics: [{ source, rule: null, message: manifest.message, level: "error" }],
    }
  }
  const diagnostics: Diagnostic[] = []
  const compiled: Compiled[] = []
  const context: RuleContext = { config: defaultConfig(), registry, global: () => true, read: createReader() }
  for (const raw of manifest.value) {
    const rule = ruleSchema.safeParse(raw)
    if (!rule.success) {
      diagnostics.push({
        source,
        rule: idOf(raw),
        message: formatZodError(rule.error, { schema: ruleSchema }),
        level: "error",
      })
      continue
    }
    const result = await compileRule({ data: rule.data, source: "local", contextRoot: { dir, label: null } }, context)
    if (typeof result === "string") {
      diagnostics.push({
        source,
        rule: rule.data.alias ?? rule.data.id,
        message: result,
        level: "error",
      })
      continue
    }
    compiled.push({ rule: result.rule, source })
    for (const message of result.warnings) diagnostics.push({ source, rule: result.rule.id, message, level: "warning" })
  }
  const rules = uniqueRules(compiled, diagnostics, (id) => `rule "${id}" is defined more than once`)
  return { rules, diagnostics }
}
