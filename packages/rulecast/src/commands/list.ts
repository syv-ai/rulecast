import { parseArgs } from "node:util"
import { compile, diagnosticText } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
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
  severity: string
  files: string
  exclude: string
  context: string[]
}

function listed(rule: CompiledRule): ListedRule {
  return {
    id: rule.id,
    name: rule.name,
    source: rule.source,
    enabled: rule.enabled,
    stages: [...rule.stages],
    detector: rule.detector?.kind ?? null,
    severity: rule.severity,
    files: rule.patterns.files,
    exclude: rule.patterns.exclude,
    context: rule.context.map((spec) => spec.ref),
  }
}

/**
 * `rulecast list`: every configured rule, catalog ones included, with what it matches and cites.
 *
 * The config names a catalog rule by id alone, so without this an agent asked not to draft a
 * duplicate had to guess the URL of the rule repo's manifest (plan 10, R3).
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
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const rules = project.rules.map(listed)
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
    out.push(`  ${scope}`)
    if (rule.context.length > 0) out.push(`  cites ${rule.context.join(", ")}`)
    out.push("")
  }
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  for (const diagnostic of errors) out.push(`not compiled: ${diagnosticText(diagnostic)}`)
  out.push(
    `${rules.length} ${rules.length === 1 ? "rule" : "rules"}${errors.length > 0 ? `, ${errors.length} not compiled (rulecast validate)` : ""}`,
  )
  io.stdout(`${out.join("\n")}\n`)
  return 0
}
