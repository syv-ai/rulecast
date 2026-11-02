import { parseArgs } from "node:util"
import { stringify } from "yaml"

import { compile, diagnosticText } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { conventionsFor } from "../core/config/conventions"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver } from "../core/delivery/resolve"
import type { DetectorRegistry } from "../core/detection/registry"
import { allFiles } from "../core/git"
import { cacheHome } from "../core/home"
import { catalogEntry, groupOf, loadCatalog, PACKS } from "../core/repos/catalog"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** What `rulecast list --format json` publishes for one rule. */
export interface ListedRule {
  id: string
  name: string
  /** "local", or the rule repo label ("syv-ai/rulecast@v0.3.0"). */
  source: string
  enabled: boolean
  stages: string[]
  /** The detector kind; null for a touch rule. */
  detector: string | null
  /** The detector's config as compiled (a regex's pattern, an llm rule's question); null for a touch rule. */
  config: unknown
  severity: string
  files: string
  exclude: string
  /** How many of the project's files the rule matches; null outside a git repository. */
  matchingFiles: number | null
  context: string[]
  /** With a RULE_ID only: the files it matches, its message, and the text of each section it cites. */
  matching?: string[]
  message?: string | null
  sections?: { ref: string; content: string | null }[]
}

function listed(rule: CompiledRule, files: readonly string[] | null): ListedRule {
  return {
    id: rule.id,
    name: rule.name,
    source: rule.source,
    enabled: rule.enabled,
    stages: [...rule.stages],
    detector: rule.detector?.kind ?? null,
    config: rule.detector?.config ?? null,
    severity: rule.severity,
    files: rule.patterns.files,
    exclude: rule.patterns.exclude,
    matchingFiles: files === null ? null : files.filter((file) => rule.matches(file)).length,
    context: rule.context.map((spec) => spec.ref),
  }
}

/** The files a rule could match, or null where git cannot say (the counts are then left out). */
async function projectFiles(root: string): Promise<string[] | null> {
  try {
    return await allFiles(root)
  } catch {
    return null
  }
}

/** Files named in one rule's view; the count already says how many there are. */
const MATCHING_SHOWN = 20

function matchingText(count: number | null): string {
  if (count === null) return ""
  if (count === 0) return " — matches no file in this project"
  return ` — matches ${count} ${count === 1 ? "file" : "files"}`
}

/**
 * `rulecast list [RULE_ID]`: every configured rule, catalog ones included, with what it matches,
 * what it looks for and what it cites; with a RULE_ID, that rule alone, with its message and the
 * text of the sections it cites.
 *
 * Everything here answers a question a drafting agent could not answer from the config, which
 * names a catalog rule by id alone: whether a new rule would duplicate it (the pattern), whether
 * it fits this project (how many files it matches, a catalog layout this project does not have
 * shows as none), and whether it contradicts the project's doc (the cited text, which lives in the
 * rule repo's cache, not in the project). Each was a guess in a drafting trial (plan 10).
 */
export async function listCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { format: { type: "string", default: "terminal" }, catalog: { type: "boolean", default: false } },
  })
  if (positionals.length > 1) throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const ruleId = positionals[0] ?? null
  if (values.catalog) return listCatalog(root, ruleId, values.format, registry, io)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const compiled = project.rules.filter((rule) => ruleId === null || rule.id === ruleId)
  if (ruleId !== null && compiled.length === 0) throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)

  const files = await projectFiles(root)
  const rules = compiled.map((rule) => listed(rule, files))
  if (ruleId !== null) {
    const rule = compiled[0]!
    const resolver = createReferenceResolver(root)
    rules[0]!.matching = (files ?? []).filter((file) => rule.matches(file))
    rules[0]!.message = rule.message
    rules[0]!.sections = await Promise.all(
      rule.context.map(async (spec) => {
        const resolved = await resolver.resolve(spec)
        return { ref: spec.ref, content: resolved.found ? resolved.content : null }
      }),
    )
  }
  if (values.format === "json") {
    io.stdout(`${JSON.stringify(rules, null, 2)}\n`)
    return 0
  }

  const out: string[] = []
  // Where a new convention's section goes (plan 20): add-rule and DRAFT-RULES.md read it here.
  if (ruleId === null) {
    const target = await conventionsFor(root)
    out.push(target === null ? "Conventions: not set" : `Conventions: ${target.path} (from ${target.from})`)
    // The developer's consent to llm rules (plan 20): agents draft an llm rule only when this says allowed.
    const model = project.config.llm.model
    out.push(
      model === null ? "llm rules: not allowed (no llm.model)" : `llm rules: allowed, on ${model} (llm.model)`,
      "",
    )
  }
  for (const rule of rules) out.push(...ruleLines(rule))
  if (ruleId === null) {
    const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
    for (const diagnostic of errors) out.push(`not compiled: ${diagnosticText(diagnostic)}`)
    out.push(
      `${rules.length} ${rules.length === 1 ? "rule" : "rules"}${errors.length > 0 ? `, ${errors.length} not compiled (rulecast validate)` : ""}`,
      "",
    )
    out.push("rulecast list <rule-id> shows one rule with the text of the sections it cites.")
  }
  io.stdout(`${out.join("\n").trimEnd()}\n`)
  return 0
}

/** One rule as `rulecast list` prints it, ending in a blank line. */
function ruleLines(rule: ListedRule): string[] {
  const out: string[] = []
  const what = rule.detector === null ? "touch" : `${rule.detector} · ${rule.stages.join(", ")} · ${rule.severity}`
  out.push(`${rule.id}${rule.enabled ? "" : "  (disabled)"}  ${what}  [${rule.source}]`)
  out.push(`  ${rule.name}`)
  const scope = `files ${rule.files === "" ? "(all)" : rule.files}${rule.exclude === "^$" ? "" : `, exclude ${rule.exclude}`}`
  out.push(`  ${scope}${matchingText(rule.matchingFiles)}`)
  // YAML, as rules are written: JSON doubled every backslash in a pattern.
  if (rule.config !== null) {
    out.push(
      "  detects:",
      ...stringify(rule.config)
        .trimEnd()
        .split("\n")
        .map((line) => `    ${line}`),
    )
  }
  if (rule.matching !== undefined && rule.matching.length > 0) {
    const shown = rule.matching.slice(0, MATCHING_SHOWN)
    const more = rule.matching.length - shown.length
    out.push(`  matching ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`)
  }
  if (rule.message !== undefined && rule.message !== null) out.push(`  message ${rule.message}`)
  if (rule.context.length > 0) out.push(`  cites ${rule.context.join(", ")}`)
  out.push("")
  for (const section of rule.sections ?? []) {
    if (section.content === null) out.push(`--- ${section.ref} --- not found`, "")
    else out.push(`--- ${section.ref} ---`, section.content, "")
  }
  return out
}

/** What `rulecast list --catalog --format json` publishes for one catalog rule. */
export interface CatalogEntry extends ListedRule {
  description: string | null
  /** The pack it belongs to, when it is in one: `rulecast add <pack>` adopts the whole of it. */
  pack: string | null
  /** Already in this project's config. */
  installed: boolean
  /** For a metered rule, what it costs and where the file goes; null otherwise. */
  cost: string | null
  /** With a RULE_ID only: the rule's own good and bad examples, which show what it catches. */
  examples?: { good: { path: string; code: string }[]; bad: { path: string; code: string }[] }
}

/**
 * `rulecast list --catalog [RULE_ID]`: the catalog's rules, for an agent deciding whether a convention
 * is already a catalog rule before drafting one (plan 20), and `rulecast add` adopts it.
 */
async function listCatalog(
  root: string,
  ruleId: string | null,
  format: string | undefined,
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const config = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const { url, entry } = catalogEntry(config.config.repos, io.env)
  const catalog = await loadCatalog(url, entry?.rev, cacheHome(io.env), registry)
  if (typeof catalog === "string") throw new Error(`the catalog could not be loaded: ${catalog}`)
  const compiled = catalog.rules.filter((rule) => ruleId === null || rule.id === ruleId)
  if (ruleId !== null && compiled.length === 0) throw new UsageError(`no rule "${ruleId}" in ${catalog.label}`)
  const installed = new Set(config.rules.filter((rule) => rule.source === catalog.label).map((rule) => rule.id))
  const files = await projectFiles(root)
  const entries: CatalogEntry[] = compiled.map((rule) => {
    const kind = rule.detector === null ? undefined : registry.get(rule.detector.kind)
    const group = groupOf(rule.id)
    return {
      ...listed(rule, files),
      description: rule.description,
      pack: group in PACKS ? group : null,
      installed: installed.has(rule.id),
      cost: kind?.metered && rule.detector !== null ? (kind.cost?.(rule.detector.config) ?? null) : null,
    }
  })
  if (ruleId !== null) {
    const rule = compiled[0]!
    // A catalog rule cites docs in the catalog, not in this project.
    const resolver = createReferenceResolver(catalog.dir)
    const pick = ({ path, code }: { path: string; code: string }) => ({ path, code })
    entries[0]!.examples = { good: (rule.examples?.good ?? []).map(pick), bad: (rule.examples?.bad ?? []).map(pick) }
    entries[0]!.matching = (files ?? []).filter((file) => rule.matches(file))
    entries[0]!.message = rule.message
    entries[0]!.sections = await Promise.all(
      rule.context.map(async (spec) => {
        const resolved = await resolver.resolve(spec)
        return { ref: spec.ref, content: resolved.found ? resolved.content : null }
      }),
    )
  }
  if (format === "json") {
    io.stdout(`${JSON.stringify(entries, null, 2)}\n`)
    return 0
  }
  const out: string[] = [`Catalog: ${catalog.label}`, ""]
  for (const entry of entries) {
    const lines = ruleLines(entry)
    lines[0] = `${lines[0]}${entry.installed ? "  (configured)" : ""}`
    if (entry.description !== null) lines.splice(2, 0, `  ${entry.description}`)
    if (entry.cost !== null) lines.splice(2, 0, `  ${entry.cost}`)
    out.push(...lines)
    for (const kind of ["bad", "good"] as const) {
      for (const example of entry.examples?.[kind] ?? []) {
        out.push(`${kind} example: ${example.path}`, example.code.trimEnd(), "")
      }
    }
  }
  if (ruleId === null) {
    for (const [name, pack] of Object.entries(PACKS)) {
      if (!entries.some((entry) => entry.pack === name)) continue
      out.push(`Pack ${name}: ${pack.note}`, "")
    }
    out.push(
      "rulecast add <id|pack> adds rules to this project's config; rulecast list --catalog <id> shows one in full.",
    )
  }
  io.stdout(`${out.join("\n").trimEnd()}\n`)
  return 0
}
