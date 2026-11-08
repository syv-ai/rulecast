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
  /** rulecast is installed in the project's node_modules. */
  local: boolean
  /** Reads a repo-relative file; null when missing. */
  readText(file: string): Promise<string | null>
}

export class PlanError extends Error {}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function parseSettings(text: string, file: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new PlanError(`${file}: ${errorMessage(error)}`)
  }
}

/** "+llm.model haiku", or "llm.model sonnet → haiku" when an existing value is replaced. */
function settingText(change: SettingChange): string {
  return change.from === null ? `+${change.key} ${change.to}` : `${change.key} ${change.from} → ${change.to}`
}

function planConfig(selections: InitSelections, configText: string | null): PlannedChange | null {
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
 * already anywhere count, and are upgraded where they are, a partial install included.
 */
async function planAgent(choice: AgentChoice, context: PlanContext): Promise<PlannedChange | null> {
  const install = choice.adapter.install
  if (install === null) return null
  const read = async (file: string) => {
    const text = await context.readText(file)
    return text === null ? null : { value: parseSettings(text, file) }
  }
  let plan: Awaited<ReturnType<typeof planHooks>>
  try {
    plan = await planHooks(read, choice.adapter, choice.scope, context.verifyMs, context.local)
  } catch (error) {
    throw error instanceof PlanError ? error : new PlanError(errorMessage(error))
  }
  const write = plan.write
  if (write === null) return null
  const label = choice.adapter.label
  const parts = [
    ...(write.added.length > 0 ? [`+${plural(write.added.length, "hook")}`] : []),
    ...(write.updated.length > 0 ? [`~${plural(write.updated.length, "hook")} updated`] : []),
  ]
  return {
    file: write.file,
    content: `${JSON.stringify(write.settings, null, 2)}\n`,
    created: write.created,
    summary: `${parts.join(", ")} (${label})`,
    commit: install.scopes.find((entry) => entry.file === write.file)?.scope === "shared",
  }
}

/** Every file init would create or change, with its full new content. Nothing is written here. */
export async function planInit(selections: InitSelections, context: PlanContext): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = []
  const config = planConfig(selections, context.configText)
  if (config !== null) changes.push(config)
  for (const choice of selections.agents) {
    const change = await planAgent(choice, context)
    if (change !== null) changes.push(change)
  }
  return changes
}

/** The Review step: one line per file. */
export function reviewText(changes: readonly PlannedChange[]): string {
  const width = Math.max(...changes.map((change) => change.file.length))
  return changes.map((change) => `${change.file.padEnd(width)}  ${change.summary}`).join("\n")
}
