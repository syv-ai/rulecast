import { readFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_FILE, MANIFEST_FILE, parseConfig, readConfigData, readManifest } from "../config/load"
import { type ActiveMode, ATTENDED, resolveMode } from "../config/mode"
import { type Config, defaultConfig, overrideSchema, ruleSchema } from "../config/schema"
import { AGENT_DIR } from "../delivery/persist"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError, isNotFound } from "../errors"
import { compileFilter } from "../files"
import type { Env } from "../home"
import type { ReferenceRoot } from "../references"
import type { RepoProvider } from "../repos/provider"
import { isOlder, VERSION } from "../version"
import { type CompiledRule, compileRule, type RuleContext, type RuleInput, requiresNewer } from "./rule"

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
   * The rules this error keeps from running when it is not one rule's own: a `repos` entry that
   * could not be checked out or read. By id, or alias when set. Absent with `rule: null`: the config.
   */
  rules?: string[]
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
  /** What the rules were compiled for: escalated severities and `refuse_write: unattended` follow it. */
  mode: ActiveMode
}

export interface CompileOptions {
  root: string
  registry: DetectorRegistry
  repos: RepoProvider
  /** Config data to compile instead of the project's .rulecast-config.yaml (try-repo). */
  configData?: unknown
  /**
   * The environment the mode is resolved from (config/mode.ts): an agent hook's, or doctor's, which
   * reports it. Absent: attended, whatever the config says — the mode is about whether anyone
   * answers an agent, and a commit or a CI job run by `rulecast run` has no agent to answer.
   */
  env?: Env
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

/** What a configured rule is called once compiled: its alias when it has one. */
function nameOf(raw: unknown): string | null {
  const alias = (raw as { alias?: unknown } | null)?.alias
  return typeof alias === "string" ? alias : idOf(raw)
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
    mode: options.env === undefined ? ATTENDED : resolveMode(config.mode, options.env),
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

  const mode = options.env === undefined ? ATTENDED : resolveMode(config.mode, options.env)
  const diagnostics: Diagnostic[] = []
  const compiled: Compiled[] = []
  const context: RuleContext = { config, registry: options.registry, global, read: createReader(), mode: mode.mode }
  const project: ReferenceRoot = { dir: root, label: null }
  const error = (source: string, rule: string | null, message: string, hint?: string, rules?: string[]) =>
    diagnostics.push({
      source,
      rule,
      message,
      level: "error",
      ...(hint === undefined ? {} : { hint }),
      ...(rules === undefined ? {} : { rules }),
    })
  const add = async (input: RuleInput, source: string) => {
    const result = await compileRule(input, context)
    if (typeof result === "string") error(source, input.data.alias ?? input.data.id, result)
    else compiled.push({ rule: result, source })
  }

  for (const [index, entry] of config.repos.entries()) {
    // A whole entry that cannot be read disables every rule in it, and says how many (core/disabled.ts).
    const entryRules = entry.rules.map(nameOf).filter((name): name is string => name !== null)
    if (entry.repo === "local") {
      if (entry.rev !== undefined) {
        error(CONFIG_FILE, null, `repos[${index}]: local repos take no rev`, undefined, entryRules)
        continue
      }
      for (const raw of entry.rules) {
        const tooNew = requiresNewer(raw)
        if (tooNew !== null) {
          error(CONFIG_FILE, idOf(raw), tooNew)
          continue
        }
        const rule = ruleSchema.safeParse(raw)
        if (!rule.success) error(CONFIG_FILE, idOf(raw), formatZodError(rule.error, { schema: ruleSchema }))
        else await add({ data: rule.data, source: "local", contextRoot: project }, CONFIG_FILE)
      }
      continue
    }

    if (entry.rev === undefined) {
      error(CONFIG_FILE, null, `repos[${index}] ${entry.repo}: rev is required`, undefined, entryRules)
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
      error(source, null, checkout.message, checkout.missing ? "rulecast install" : undefined, entryRules)
      continue
    }
    const manifest = await readManifest(checkout.dir)
    if (!manifest.ok) {
      error(source, null, manifest.message, undefined, entryRules)
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
      const tooNew = requiresNewer(candidates[0])
      if (tooNew !== null) {
        error(source, id, tooNew)
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
  // Said in every mode, so `rulecast validate` catches a typo before the unattended run that needs it.
  for (const id of config.unattended.escalate) {
    if (rules.some((rule) => rule.id === id)) continue
    diagnostics.push({
      source: CONFIG_FILE,
      rule: id,
      message: "unattended.escalate names no configured rule",
      level: "warning",
    })
  }
  return { root, config, rules, diagnostics, mode }
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
    const tooNew = requiresNewer(raw)
    if (tooNew !== null) {
      diagnostics.push({ source, rule: idOf(raw), message: tooNew, level: "error" })
      continue
    }
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
    } else compiled.push({ rule: result, source })
  }
  const rules = uniqueRules(compiled, diagnostics, (id) => `rule "${id}" is defined more than once`)
  return { rules, diagnostics }
}
