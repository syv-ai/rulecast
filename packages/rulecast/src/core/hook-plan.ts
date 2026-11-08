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

export interface HookState {
  file: string
  stale: string[]
  missing: string[]
  /**
   * The adapter's files (AdapterInstall.files) that are not as install writes them. Only when the
   * hooks found are current: hooks on an older command do not run them, and `stale` says enough.
   */
  files: { file: string; problem: "missing" | "differs" }[]
}

/** Reads one of an adapter's files, relative to the settings' directory: its text, or null when it does not exist. */
export type FileReader = (file: string) => Promise<{ text: string } | null>

/** What installing an adapter's hooks would do, decided in one place for install, init and doctor. */
export interface HookPlan {
  /** Where rulecast's hooks are now, and what is out of date there; null: in no settings file. */
  state: HookState | null
  /**
   * What to write; null when the hooks and their files are current. `settings`: the settings file's
   * new content, null when only files need writing. `files`: those missing or differing, in full.
   */
  write: {
    file: string
    settings: unknown | null
    created: boolean
    added: string[]
    updated: string[]
    files: { file: string; content: string; created: boolean }[]
  } | null
}

/**
 * Where the adapter's hooks are, whether they are current, and what to write. A hook counts wherever
 * it is (spec §12): a file with every hook wins over one with only some. `stale`: installed by an
 * older rulecast with another command or too short a timeout; `missing`: installed before rulecast
 * needed every hook it needs now (plan 11's Bash hooks). Either way the file they are in is upgraded
 * in place. With none anywhere, they go into `scope`'s file. The adapter's files are written
 * whenever they are not byte for byte what install writes, whichever settings file the hooks are in.
 */
/** Some string anywhere in `value` is `command`: a hook in these settings runs the current command. */
function runsCommand(value: unknown, command: string): boolean {
  if (value === command) return true
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).some((child) => runsCommand(child, command))
}

export async function planHooks(
  read: FileReader,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
): Promise<HookPlan> {
  const install = installOf(adapter)
  const readSettings = async (file: string): Promise<{ value: unknown } | null> => {
    const current = await read(file)
    return current === null ? null : { value: inFile(file, () => JSON.parse(current.text) as unknown) }
  }
  const files: { file: string; content: string; created: boolean }[] = []
  const problems: HookState["files"] = []
  for (const { file, content } of install.files) {
    const current = await read(file)
    if (current?.text === content) continue
    files.push({ file, content, created: current === null })
    problems.push({ file, problem: current === null ? "missing" : "differs" })
  }
  // `runs`: a hook there already runs the current command, so the files it needs are its problem now.
  let complete: { state: HookState; settings: unknown; runs: boolean } | null = null
  let partial: { state: HookState; settings: unknown; runs: boolean } | null = null
  for (const { file } of install.scopes) {
    const current = await readSettings(file)
    if (current === null) continue
    const merged = inFile(file, () => install.merge(current.value, install.command, verifyMs))
    const updated = merged.updated ?? []
    const runs = runsCommand(current.value, install.command)
    if (merged.added.length === 0) {
      complete = { state: { file, stale: updated, missing: [], files: [] }, settings: merged.settings, runs }
      break
    }
    const ours = inFile(file, () => install.remove(current.value)).removed.length > 0
    if (ours && partial === null)
      partial = { state: { file, stale: updated, missing: merged.added, files: [] }, settings: merged.settings, runs }
  }
  const found = complete ?? partial
  if (found !== null) {
    const { settings } = found
    // Hooks still on an older command don't run the files yet: reported stale, and the write adds them.
    // Stale on a timeout alone, they do, and a missing script fails every one of them.
    const state = { ...found.state, files: found.runs ? problems : [] }
    if (state.stale.length === 0 && state.missing.length === 0) {
      if (files.length === 0) return { state, write: null }
      return { state, write: { file: state.file, settings: null, created: false, added: [], updated: [], files } }
    }
    return {
      state,
      write: { file: state.file, settings, created: false, added: state.missing, updated: state.stale, files },
    }
  }
  const target = install.scopes.find((candidate) => candidate.scope === scope)
  if (!target) throw new ScopeError(`${adapter.name} has no ${scope} settings`)
  const current = await readSettings(target.file)
  const merged = inFile(target.file, () => install.merge(current?.value ?? {}, install.command, verifyMs))
  return {
    state: null,
    write: {
      file: target.file,
      settings: merged.settings,
      created: current === null,
      added: merged.added,
      updated: [],
      files,
    },
  }
}
