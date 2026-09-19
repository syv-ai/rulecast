import type { Adapter } from "../core/types"
import { claudeCodeAdapter } from "./claude-code/adapter"

/** Every agent adapter rulecast ships. */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter]

export function adapterByName(name: string): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.name === name)
}
