import { writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { parse } from "yaml"

import { ADAPTERS } from "../adapters"
import { compile } from "../core/compile/project"
import { CONFIG_FILE, parseConfig } from "../core/config/load"
import type { ActiveMode } from "../core/config/mode"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { catalogEntry, loadCatalog, selectRules } from "../core/repos/catalog"
import { cachedRepos } from "../core/repos/provider"
import { addCatalogRules } from "../init/config-text"
import { guardMissing, installRemedy } from "./doctor-hooks"
import { hookConfigs, hookState, settingsDir } from "./install"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"
import { validationReport } from "./validate"

const idOf = (entry: unknown): string | null => {
  const id = (entry as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

/**
 * `rulecast add <id|pack>...`: adopts catalog rules into the nearest config, pinned to the catalog
 * rev the config already uses, else its latest tag. Naming a rule is the consent, metered or not:
 * agents run this only after the developer approved the rule (plan 20).
 */
export async function addCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  if (positionals.length === 0) throw new UsageError("name at least one catalog rule or pack (rulecast list --catalog)")
  if (!hasProject(root)) {
    throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents; set rulecast up first (agents/SETUP.md)`)
  }
  const text = (await readSourceFile(root, CONFIG_FILE)) ?? ""
  const parsed = parseConfig(parse(text) ?? {})
  if (!parsed.ok) throw new Error(`${parsed.message} (fix it, then run rulecast add again)`)

  const home = cacheHome(io.env)
  const { url, entry } = catalogEntry(parsed.value.repos, io.env)
  const catalog = await loadCatalog(url, entry?.rev, home, registry)
  if (typeof catalog === "string") throw new Error(`the catalog could not be loaded: ${catalog}`)

  const { rules, unknown } = selectRules(catalog, positionals)
  if (unknown.length > 0) {
    // The config's pin decides the catalog version; a pack newer than the pin reads as missing.
    const pinned =
      entry?.rev === undefined
        ? ""
        : ` (the config pins ${catalog.label}; rulecast autoupdate moves it to the latest tag)`
    throw new UsageError(`"${unknown[0]}" is not a rule or pack in ${catalog.label}${pinned}`)
  }
  const installed = new Set((entry?.rules ?? []).map(idOf).filter((id): id is string => id !== null))
  const added = rules.filter((rule) => !installed.has(rule.id))
  const already = rules.filter((rule) => installed.has(rule.id))

  const out: string[] = []
  if (already.length > 0) out.push(`Already configured: ${already.map((rule) => rule.id).join(", ")}`)
  if (added.length === 0) {
    io.stdout(`${[...out, "Nothing to add."].join("\n")}\n`)
    return 0
  }
  const updated = addCatalogRules(
    text,
    catalog,
    added.map((rule) => ({ id: rule.id, context: null, files: null })),
  )
  await writeFile(path.join(root, CONFIG_FILE), updated)
  out.push(`Added from ${catalog.label}:`, ...added.map((rule) => `  ${rule.id}  ${rule.name}`), "")
  const report = await validationReport(root, home, registry)
  out.push(...report.lines)
  const remedy = await guardRemedy(root, new Set(added.map((rule) => rule.id)), registry, io)
  if (remedy !== null) out.push(`Run ${remedy} so the write guard is registered.`)
  io.stdout(`${out.join("\n")}\n`)
  return report.errors > 0 ? 2 : 0
}

/**
 * The install command to run when an added rule refuses writes (in either mode) while the hooks
 * where sessions start here have no write guard to refuse them with; null otherwise.
 */
async function guardRemedy(
  root: string,
  ids: ReadonlySet<string>,
  registry: DetectorRegistry,
  io: CliIo,
): Promise<string | null> {
  const home = cacheHome(io.env)
  const unattended: ActiveMode = { mode: "unattended", source: "default", detail: "" }
  const project = await compile({ root, registry, repos: cachedRepos(home), mode: unattended }).catch(() => null)
  if (!project?.rules.some((rule) => ids.has(rule.id) && rule.enabled && rule.refuseWrite)) return null
  const dir = settingsDir(io.cwd)
  const { verifyMs } = await hookConfigs(dir, "add", undefined, () => {}).catch(() => ({ verifyMs: 60_000 }))
  for (const adapter of ADAPTERS) {
    if (adapter.install === null || !(await guardMissing(dir, adapter, verifyMs))) continue
    return installRemedy(dir, adapter, (await hookState(dir, adapter, verifyMs).catch(() => null))?.file ?? null)
  }
  return null
}
