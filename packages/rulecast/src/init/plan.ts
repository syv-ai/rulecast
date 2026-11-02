import { CONFIG_FILE } from "../core/config/load"
import { errorMessage } from "../core/errors"
import type { Adapter, InstallScope } from "../core/types"
import { addLocalRules, type ConfigSettings, newConfigText, setSettings } from "./config-text"
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

function planConfig(selections: InitSelections, configText: string | null): PlannedChange | null {
  const { hooks, settings } = selections
  const named = [
    ...(hooks.length === 0 ? [] : [plural(hooks.length, "hook rule")]),
    ...(settings.conventions ? ["conventions"] : []),
    ...(settings.llmModel || settings.llmProvider ? ["llm"] : []),
  ]
  if (configText === null) {
    const summary = named.length === 0 ? "new, no rules yet" : `new, ${named.join(", ")}`
    return { file: CONFIG_FILE, content: newConfigText(hooks, settings), created: true, summary, commit: true }
  }
  let content = configText
  if (hooks.length > 0) content = addLocalRules(content, hooks)
  content = setSettings(content, settings)
  if (content === configText) return null
  return {
    file: CONFIG_FILE,
    content,
    created: false,
    summary: named.map((part) => `+${part}`).join(", "),
    commit: true,
  }
}

async function planAgent(choice: AgentChoice, context: PlanContext): Promise<PlannedChange | null> {
  const install = choice.adapter.install
  if (install === null) return null
  const command = install.command(context.local)
  const merge = (settings: unknown, file: string) => {
    try {
      return install.merge(settings, command, context.verifyMs)
    } catch (error) {
      throw new PlanError(`${file}: ${errorMessage(error)}`)
    }
  }
  // Hooks already in any of the agent's settings files count as installed, as for rulecast install;
  // installed by an older rulecast, they are rewritten where they are.
  for (const { file } of install.scopes) {
    const text = await context.readText(file)
    if (text === null) continue
    const merged = merge(parseSettings(text, file), file)
    if (merged.added.length > 0) continue
    const updated = merged.updated ?? []
    if (updated.length === 0) return null
    return {
      file,
      content: `${JSON.stringify(merged.settings, null, 2)}\n`,
      created: false,
      summary: `~${plural(updated.length, "hook")} updated (${choice.adapter.label})`,
      commit: install.scopes.find((entry) => entry.file === file)?.scope === "shared",
    }
  }
  const target = install.scopes.find((entry) => entry.scope === choice.scope)
  if (target === undefined) throw new PlanError(`${choice.adapter.label} has no ${choice.scope} settings`)
  const text = await context.readText(target.file)
  const merged = merge(text === null ? {} : parseSettings(text, target.file), target.file)
  return {
    file: target.file,
    content: `${JSON.stringify(merged.settings, null, 2)}\n`,
    created: text === null,
    summary: `+${plural(merged.added.length, "hook")} (${choice.adapter.label})`,
    commit: choice.scope === "shared",
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
