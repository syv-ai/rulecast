import { realpathSync } from "node:fs"
import path from "node:path"

import { CONFIG_FILE } from "../core/config/load"
import { errorMessage } from "../core/errors"
import { planHooks } from "../core/hook-plan"
import type { Adapter, InstallScope } from "../core/types"
import {
  addCatalogRules,
  addLocalRules,
  type CatalogRef,
  type ConfigSettings,
  newConfigText,
  type RuleSelection,
  type SettingChange,
  setSettings,
} from "./config-text"
import type { LocalRule } from "./hooks"

export interface AgentChoice {
  adapter: Adapter
  scope: InstallScope
}

export interface InitSelections {
  /** Adapters with an install, and where their hooks go. */
  agents: AgentChoice[]
  /** The project's own pre-commit or lefthook hooks, as local rules. */
  hooks: LocalRule[]
  /** The project's own linters, as `linter` rules (init/linters.ts). Default: none. */
  linters?: LocalRule[]
  /** Catalog rules to adopt, pinned at `ref`: only those to add, or whose `files` change. */
  catalog: { ref: CatalogRef; rules: RuleSelection[] } | null
  /** Top-level settings from the interview: conventions, llm.model, llm.provider. */
  settings: ConfigSettings
}

export interface PlannedChange {
  /** Repo-relative. */
  file: string
  content: string
  created: boolean
  /** "new, 3 rules from syv-ai/rulecast@v0.2.0", "+2 rules from …", "+6 hooks (Claude Code)". */
  summary: string
  /** Shared files the developer should commit; personal settings are not. */
  commit: boolean
}

export interface PlanContext {
  /** The current .rulecast-config.yaml; null when the project has none. */
  configText: string | null
  verifyMs: number
  /** The directory the settings go in, for a command that names it (a personal file's absolute path). */
  dir: string
  /**
   * A config the hooks serve, this one as init will write it, has a refuse_write rule: the hook
   * before every edit is wanted (install's refuseWriteRoots).
   */
  guard: boolean
  /** Where the adapter's personal settings file is read for sessions in `dir` (install's scopeRoot). Absent: `dir`. */
  personalDirOf?: (adapter: Adapter) => string
  /** Why installing this scope would make sessions run rulecast twice (install's scopeConflict), or null. */
  conflict?: (adapter: Adapter, scope: InstallScope) => Promise<string | null>
  /** Reads a repo-relative file; null when missing. */
  readText(file: string): Promise<string | null>
}

export class PlanError extends Error {}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** "+llm.model haiku", or "llm.model sonnet → haiku" when an existing value is replaced. */
function settingText(change: SettingChange): string {
  return change.from === null ? `+${change.key} ${change.to}` : `${change.key} ${change.from} → ${change.to}`
}

export function planConfig(selections: InitSelections, configText: string | null): PlannedChange | null {
  const { hooks, settings, catalog } = selections
  const linters = selections.linters ?? []
  const local = [...linters, ...hooks]
  const adopted = catalog?.rules ?? []
  const withCatalog = (text: string) => (catalog === null ? text : addCatalogRules(text, catalog.ref, catalog.rules))
  const localRules = [
    ...(linters.length === 0 ? [] : [plural(linters.length, "linter rule")]),
    ...(hooks.length === 0 ? [] : [plural(hooks.length, "hook rule")]),
  ]
  const catalogRules = plural(adopted.length, "catalog rule")
  if (configText === null) {
    const named = [
      ...localRules,
      ...(adopted.length === 0 ? [] : [catalogRules]),
      ...(settings.conventions ? ["conventions"] : []),
      ...(settings.llmModel || settings.llmProvider ? ["llm"] : []),
      ...(settings.weeklySummary ? ["stats"] : []),
    ]
    const summary = named.length === 0 ? "new, no rules yet" : `new, ${named.join(", ")}`
    // A new config's catalog entry is written as an existing one's is, by addCatalogRules.
    const content = withCatalog(newConfigText(local, settings))
    return { file: CONFIG_FILE, content, created: true, summary, commit: true }
  }
  const withLocal = local.length > 0 ? addLocalRules(configText, local) : configText
  const withRules = withCatalog(withLocal)
  const set = setSettings(withRules, settings)
  const content = set.text
  if (content === configText) return null
  const added = [
    ...(withLocal === configText ? [] : localRules.map((part) => `+${part}`)),
    ...(withRules === withLocal ? [] : [`+${catalogRules}`]),
  ]
  const summary = [...added, ...set.changes.map(settingText)].join(", ")
  return { file: CONFIG_FILE, content, created: false, summary, commit: true }
}

/**
 * The agent's hooks, planned exactly as `rulecast install` plans them (core/hook-plan.ts): hooks
 * already anywhere count, and are upgraded where they are, a partial install included. The settings
 * change, then one per other settings file upgraded, each committed by its own scope; then one per
 * file the hooks need, for committing when a shared settings file will run them.
 */
async function planAgent(choice: AgentChoice, context: PlanContext): Promise<PlannedChange[]> {
  const install = choice.adapter.install
  if (install === null) return []
  // Where the agent reads the personal file for sessions here (install's scopeRoot): maybe above.
  const personalDir = context.personalDirOf?.(choice.adapter) ?? context.dir
  const up = path.relative(realOr(context.dir), realOr(personalDir)).split(path.sep).join("/")
  const at = (base: string, file: string) => (base === "" ? file : `${base}/${file}`)
  // Never both scopes for one session, and never by removing hooks from a file nobody named.
  const conflict = await context.conflict?.(choice.adapter, choice.scope)
  if (conflict !== undefined && conflict !== null) throw new PlanError(conflict)
  const base = choice.scope === "shared" ? "" : up
  const read = async (file: string) => {
    const text = await context.readText(at(base, file))
    return text === null ? null : { text }
  }
  let plan: Awaited<ReturnType<typeof planHooks>>
  try {
    plan = await planHooks(read, choice.adapter, choice.scope, context.verifyMs, {
      guard: context.guard,
      dir: base === "" ? context.dir : personalDir,
      only: choice.scope,
    })
  } catch (error) {
    throw new PlanError(errorMessage(error))
  }
  const write = plan.write
  const label = choice.adapter.label
  const commitOf = (file: string) => install.scopes.find((entry) => entry.file === file)?.scope === "shared"
  const changes: PlannedChange[] = []
  if (write !== null && write.settings !== null) {
    const parts = [
      ...(write.added.length > 0 ? [`+${plural(write.added.length, "hook")}`] : []),
      ...(write.updated.length > 0 ? [`~${plural(write.updated.length, "hook")} updated`] : []),
    ]
    changes.push({
      file: at(base, write.file),
      content: `${JSON.stringify(write.settings, null, 2)}\n`,
      created: write.created,
      summary: `${parts.join(", ")} (${label})`,
      commit: commitOf(write.file),
    })
  }
  for (const { file, settings, updated } of write?.others ?? []) {
    changes.push({
      file: at(base, file),
      content: `${JSON.stringify(settings, null, 2)}\n`,
      created: false,
      summary: `~${plural(updated.length, "hook")} updated (${label})`,
      commit: commitOf(file),
    })
  }
  for (const { file, content, created } of write?.files ?? []) {
    changes.push({ file: at(base, file), content, created, summary: `hook script (${label})`, commit: plan.sharedRuns })
  }
  return changes
}

/**
 * The files the agents' hooks need that are there already, unchanged, and not committed, while a
 * shared settings file runs them: a teammate who pulls the settings gets hooks that fail.
 */
export async function uncommittedHookFiles(
  agents: readonly AgentChoice[],
  context: PlanContext,
  isTracked: (file: string) => Promise<boolean>,
): Promise<string[]> {
  const found: string[] = []
  for (const choice of agents) {
    const install = choice.adapter.install
    if (install === null) continue
    const read = async (file: string) => {
      const text = await context.readText(file)
      return text === null ? null : { text }
    }
    const plan = await planHooks(read, choice.adapter, choice.scope, context.verifyMs, {
      guard: context.guard,
      dir: context.dir,
      only: choice.scope,
    }).catch(() => null)
    if (plan === null || !plan.sharedRuns) continue
    const written = new Set((plan.write?.files ?? []).map((each) => each.file))
    for (const { file } of install.files) {
      if (written.has(file) || found.includes(file)) continue
      if ((await context.readText(file)) !== null && !(await isTracked(file))) found.push(file)
    }
  }
  return found
}

/** Every file init would create or change, with its full new content. Nothing is written here. */
export async function planInit(selections: InitSelections, context: PlanContext): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = []
  const config = planConfig(selections, context.configText)
  if (config !== null) changes.push(config)
  for (const choice of selections.agents) {
    changes.push(...(await planAgent(choice, context)))
  }
  return changes
}

function realOr(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** The Review step: one line per file. */
export function reviewText(changes: readonly PlannedChange[]): string {
  const width = Math.max(...changes.map((change) => change.file.length))
  return changes.map((change) => `${change.file.padEnd(width)}  ${change.summary}`).join("\n")
}
