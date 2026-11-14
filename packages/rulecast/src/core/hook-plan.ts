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
  /**
   * The other settings files holding rulecast's hooks that are out of date. Claude Code runs every
   * settings file's handlers, so a file left behind on an older command runs rulecast twice.
   */
  others: { file: string; stale: string[] }[]
  /**
   * Every one of rulecast's hooks, in every settings file, runs the current command: a missing
   * file fails all of them, not only some.
   */
  allRun: boolean
}

/** Reads one of an adapter's files, relative to the settings' directory: its text, or null when it does not exist. */
export type FileReader = (file: string) => Promise<{ text: string } | null>

/** What installing an adapter's hooks would do, decided in one place for install, init and doctor. */
export interface HookPlan {
  /** Where rulecast's hooks are now, and what is out of date there; null: in no settings file. */
  state: HookState | null
  /**
   * Once written, a shared settings file runs the current command, so the files it needs
   * (AdapterInstall.files) must be committed with it: a teammate's hooks fail without them.
   */
  sharedRuns: boolean
  /**
   * What to write; null when the hooks and their files are current. `settings`: the settings file's
   * new content, null when only files need writing. `files`: those missing or differing, in full.
   * `others`: the other settings files to upgrade, each written in full.
   */
  write: {
    file: string
    settings: unknown | null
    created: boolean
    added: string[]
    updated: string[]
    files: { file: string; content: string; created: boolean }[]
    others: { file: string; settings: unknown; updated: string[] }[]
  } | null
}

export interface PlanOptions {
  /** A config the hooks serve has a refuse_write rule (AdapterInstall.merge). Default true. */
  guard?: boolean
  /** The directory the settings are in, for a command that names it (AdapterInstall.commandFor). */
  dir?: string
  /**
   * Only this scope's settings file is looked at and written: install's rule, under which a scope
   * is never satisfied, upgraded or reported by the other scope's file. Absent: every scope's.
   */
  only?: InstallScope
}

/** Every hook command in settings. */
export function commandsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(commandsIn)
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === "command" && typeof child === "string" ? [child] : commandsIn(child),
  )
}

/** `value` with every string that is `command` replaced: what is left of rulecast's is on another command. */
function withoutCommand(value: unknown, command: string): unknown {
  if (value === command) return ""
  if (Array.isArray(value)) return value.map((child) => withoutCommand(child, command))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withoutCommand(child, command)]))
}

/** Some string anywhere in `value` is `command`: a hook in these settings runs the current command. */
function runsCommand(value: unknown, command: string): boolean {
  if (value === command) return true
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).some((child) => runsCommand(child, command))
}

/**
 * Where the adapter's hooks are, whether they are current, and what to write. A hook counts wherever
 * it is (spec §12): a file with every hook wins over one with only some. `stale`: installed by an
 * older rulecast with another command or too short a timeout; `missing`: installed before rulecast
 * needed every hook it needs now (plan 11's Bash hooks). Either way the file they are in is upgraded
 * in place. Every other settings file holding rulecast's hooks has them upgraded too, but none added:
 * the file that won already has what is missing. With none anywhere, they go into `scope`'s file. The
 * adapter's files are written whenever they are not byte for byte what install writes, whichever
 * settings file the hooks are in.
 */
export async function planHooks(
  read: FileReader,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
  options: PlanOptions = {},
): Promise<HookPlan> {
  const install = installOf(adapter)
  const guard = options.guard ?? true
  const scopeOf = (file: string) => install.scopes.find((each) => each.file === file)?.scope
  /**
   * The command a settings file runs (AdapterInstall.commandFor). Without the directory, a command
   * of that form already in the file stands, so a caller that plans through a reader alone never
   * rewrites what install wrote.
   */
  const commandOf = (file: string, value: unknown): string => {
    const scope = scopeOf(file)
    if (install.commandFor === undefined || scope === undefined) return install.command
    if (options.dir !== undefined) return install.commandFor(scope, options.dir)
    const there = commandsIn(value)
      .map((command) => install.dirOf?.(command) ?? null)
      .find((dir) => dir !== null)
    return there === undefined || there === null ? install.command : install.commandFor(scope, there)
  }
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
  const holding: {
    file: string
    value: unknown
    command: string
    settings: unknown
    added: string[]
    updated: string[]
  }[] = []
  // Every scope, past the first complete file: the others can hold hooks that need upgrading as well.
  for (const { file } of install.scopes.filter((each) => options.only === undefined || each.scope === options.only)) {
    const current = await readSettings(file)
    if (current === null) continue
    const command = commandOf(file, current.value)
    const merged = inFile(file, () => install.merge(current.value, command, verifyMs, { guard }))
    const updated = merged.updated ?? []
    const ours = merged.added.length === 0 || inFile(file, () => install.remove(current.value)).removed.length > 0
    if (ours) {
      holding.push({ file, value: current.value, command, settings: merged.settings, added: merged.added, updated })
    }
  }
  const found = holding.find((each) => each.added.length === 0) ?? holding[0]
  if (found !== undefined) {
    const others = holding
      .filter((each) => each !== found)
      .map(({ file, value, command }) => {
        const merged = inFile(file, () => install.merge(value, command, verifyMs, { upgradeOnly: true, guard }))
        return { file, settings: merged.settings, updated: merged.updated ?? [] }
      })
      .filter((each) => each.updated.length > 0)
    // Hooks still on an older command don't run the files yet: reported stale, and the write adds them.
    // Stale on a timeout alone, they do, and a missing script fails every one of them. So does any
    // other settings file's hook on the current command, since Claude Code runs every file's.
    const runs = holding.some((each) => runsCommand(each.value, each.command))
    const state: HookState = {
      file: found.file,
      stale: found.updated,
      missing: found.added,
      files: runs ? problems : [],
      others: others.map(({ file, updated }) => ({ file, stale: updated })),
      // A hook on the current command no longer looks like rulecast's once the command is hidden,
      // so remove() finds only those on an older one.
      allRun: holding.every(
        ({ file, value, command }) =>
          inFile(file, () => install.remove(withoutCommand(value, command))).removed.length === 0,
      ),
    }
    const current = state.stale.length === 0 && state.missing.length === 0
    // Each file as it will be: what the write puts there, else what is there now.
    const after = (file: string, value: unknown): unknown =>
      file === found.file
        ? current
          ? value
          : found.settings
        : (others.find((other) => other.file === file)?.settings ?? value)
    const sharedRuns = holding.some(
      ({ file, value, command }) => scopeOf(file) === "shared" && runsCommand(after(file, value), command),
    )
    if (current && files.length === 0 && others.length === 0) return { state, sharedRuns, write: null }
    return {
      state,
      sharedRuns,
      write: {
        file: state.file,
        settings: current ? null : found.settings,
        created: false,
        added: state.missing,
        updated: state.stale,
        files,
        others,
      },
    }
  }
  const target = install.scopes.find((candidate) => candidate.scope === scope)
  if (!target) throw new ScopeError(`${adapter.name} has no ${scope} settings`)
  const current = await readSettings(target.file)
  const command = commandOf(target.file, current?.value ?? {})
  const merged = inFile(target.file, () => install.merge(current?.value ?? {}, command, verifyMs, { guard }))
  return {
    state: null,
    sharedRuns: target.scope === "shared",
    write: {
      file: target.file,
      settings: merged.settings,
      created: current === null,
      added: merged.added,
      updated: [],
      files,
      others: [],
    },
  }
}
