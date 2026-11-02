import { existsSync } from "node:fs"
import path from "node:path"

import { errorMessage } from "./errors"
import type { Adapter, AdapterInstall, InstallScope } from "./types"

/** The adapter has no settings file for the scope asked for: a usage error in `install`. */
export class ScopeError extends Error {}

export function installOf(adapter: Adapter): AdapterInstall {
  if (!adapter.install) throw new Error(`${adapter.name} has no hooks to install`)
  return adapter.install
}

/** Runs an adapter's settings transform, naming the file when the settings have the wrong shape. */
export function inFile<T>(file: string, transform: () => T): T {
  try {
    return transform()
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`)
  }
}

/** rulecast is installed in the project's own node_modules. */
export const projectRulecast = (root: string): boolean =>
  existsSync(path.join(root, "node_modules", ".bin", "rulecast"))

export interface HookState {
  file: string
  stale: string[]
  missing: string[]
}

/** Reads one of an adapter's settings files: its parsed value, or null when it does not exist. */
export type SettingsReader = (file: string) => Promise<{ value: unknown } | null>

/** What installing an adapter's hooks would do, decided in one place for install, init and doctor. */
export interface HookPlan {
  /** Where rulecast's hooks are now, and what is out of date there; null: in no settings file. */
  state: HookState | null
  /** The settings file to write and its new content; null when the hooks are current. */
  write: { file: string; settings: unknown; created: boolean; added: string[]; updated: string[] } | null
}

/**
 * Where the adapter's hooks are, whether they are current, and what to write. A hook counts wherever
 * it is (spec §12): a file with every hook wins over one with only some. `stale`: installed by an
 * older rulecast with another command or too short a timeout; `missing`: installed before rulecast
 * needed every hook it needs now (plan 11's Bash hooks). Either way the file they are in is upgraded
 * in place. With none anywhere, they go into `scope`'s file.
 */
export async function planHooks(
  read: SettingsReader,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
  local: boolean,
): Promise<HookPlan> {
  const install = installOf(adapter)
  const command = install.command(local)
  let complete: { state: HookState; settings: unknown } | null = null
  let partial: { state: HookState; settings: unknown } | null = null
  for (const { file } of install.scopes) {
    const current = await read(file)
    if (current === null) continue
    const merged = inFile(file, () => install.merge(current.value, command, verifyMs))
    const updated = merged.updated ?? []
    if (merged.added.length === 0) {
      complete = { state: { file, stale: updated, missing: [] }, settings: merged.settings }
      break
    }
    const ours = inFile(file, () => install.remove(current.value)).removed.length > 0
    if (ours && partial === null)
      partial = { state: { file, stale: updated, missing: merged.added }, settings: merged.settings }
  }
  const found = complete ?? partial
  if (found !== null) {
    const { state, settings } = found
    if (state.stale.length === 0 && state.missing.length === 0) return { state, write: null }
    return { state, write: { file: state.file, settings, created: false, added: state.missing, updated: state.stale } }
  }
  const target = install.scopes.find((candidate) => candidate.scope === scope)
  if (!target) throw new ScopeError(`${adapter.name} has no ${scope} settings`)
  const current = await read(target.file)
  const merged = inFile(target.file, () => install.merge(current?.value ?? {}, command, verifyMs))
  return {
    state: null,
    write: {
      file: target.file,
      settings: merged.settings,
      created: current === null,
      added: merged.added,
      updated: [],
    },
  }
}
