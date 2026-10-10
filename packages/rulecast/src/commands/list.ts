import { parseArgs } from "node:util"
import { compile, diagnosticText } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver } from "../core/delivery/resolve"
import type { DetectorRegistry } from "../core/detection/registry"
import { allFiles } from "../core/git"
import { cacheHome } from "../core/home"
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
  /** With a RULE_ID only: the rule's message, and the text of each section it cites. */
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
    options: { format: { type: "string", default: "terminal" } },
  })
  if (positionals.length > 1) throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const ruleId = positionals[0] ?? null
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const compiled = project.rules.filter((rule) => ruleId === null || rule.id === ruleId)
  if (ruleId !== null && compiled.length === 0) throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)

  const files = await projectFiles(root)
  const rules = compiled.map((rule) => listed(rule, files))
  if (ruleId !== null) {
    const rule = compiled[0]!
    const resolver = createReferenceResolver(root)
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
  for (const rule of rules) {
    const what = rule.detector === null ? "touch" : `${rule.detector} · ${rule.stages.join(", ")} · ${rule.severity}`
    out.push(`${rule.id}${rule.enabled ? "" : "  (disabled)"}  ${what}  [${rule.source}]`)
    out.push(`  ${rule.name}`)
    const scope = `files ${rule.files === "" ? "(all)" : rule.files}${rule.exclude === "^$" ? "" : `, exclude ${rule.exclude}`}`
    out.push(`  ${scope}${matchingText(rule.matchingFiles)}`)
    if (rule.config !== null) out.push(`  detects ${JSON.stringify(rule.config)}`)
    if (rule.message !== undefined && rule.message !== null) out.push(`  message ${rule.message}`)
    if (rule.context.length > 0) out.push(`  cites ${rule.context.join(", ")}`)
    out.push("")
    for (const section of rule.sections ?? []) {
      if (section.content === null) out.push(`--- ${section.ref} --- not found`, "")
      else out.push(`--- ${section.ref} ---`, section.content, "")
    }
  }
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
