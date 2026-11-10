import { access, constants, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS, adapterByName } from "../adapters"
import { installDir, probeRulecast } from "../core/binary-home"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import { type Config, defaultConfig } from "../core/config/schema"
import { errorMessage, isNotFound } from "../core/errors"
import { cacheHome, type Env } from "../core/home"
import { type FileReader, type HookState, inFile, installOf, planHooks, ScopeError } from "../core/hook-plan"
import { configRootsAbove, configRootsBelow, displayPath } from "../core/projects"
import { cachedRepo, ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import type { Adapter, InstallScope } from "../core/types"
import { commandPath } from "../core/which"
import type { CliIo } from "./main"
import { UsageError } from "./usage"

/** A file's text, relative to `root`, or null when it does not exist. */
const reader =
  (root: string): FileReader =>
  async (file) => {
    try {
      return { text: await readFile(path.join(root, file), "utf8") }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

/** Parsed settings, or null when the file does not exist. */
async function readSettings(root: string, file: string): Promise<{ value: unknown } | null> {
  const current = await reader(root)(file)
  return current === null ? null : { value: inFile(file, () => JSON.parse(current.text) as unknown) }
}

async function writeText(root: string, file: string, text: string, mode?: number): Promise<void> {
  const full = path.join(root, file)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, text, { mode })
}

const writeSettings = (root: string, file: string, settings: unknown) =>
  writeText(root, file, `${JSON.stringify(settings, null, 2)}\n`)

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0
}

/** A rulecast the hooks can run: where it was found, its path, and what `--version` printed. */
export interface HookRulecast {
  via: "project" | "path" | "installed"
  path: string
  version: string | null
}

/**
 * Every rulecast the agent hooks' script would consider, in the order it tries them: the project's
 * `node_modules/.bin/rulecast`, then the PATH, then install.sh's in its directory (installDir).
 * Executable is enough for the project's (the hook execs it); one that cannot run (126, 127, a
 * binary for another machine) counts as none, as in the hook. A project with none has hooks that are installed and run no rules, which
 * `doctor` exists to catch.
 *
 * `env`'s PATH, without the bins of package runners (TEMPORARY_BIN): the setup docs run doctor as
 * `npx @syv-ai/rulecast doctor`, which puts its own rulecast on the PATH it runs doctor with, and
 * the hooks never run under npx (plan 21).
 */
export async function hookRulecasts(root: string, env: Env, signal?: AbortSignal): Promise<HookRulecast[]> {
  const found: HookRulecast[] = []
  const executable = (file: string) =>
    access(file, constants.X_OK).then(
      () => true,
      () => false,
    )
  const project = path.join(root, "node_modules", ".bin", "rulecast")
  if (await executable(project)) {
    found.push({ via: "project", path: project, version: (await probeRulecast(project, signal))?.version ?? null })
  }
  const entries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter)
  const PATH = entries.filter((dir) => !TEMPORARY_BIN.test(dir)).join(path.delimiter)
  const onPath = await commandPath("rulecast", signal, PATH)
  const probe = onPath === null ? null : await probeRulecast(onPath, signal)
  if (onPath !== null && probe !== null) found.push({ via: "path", path: onPath, version: probe.version })
  const installed = path.join(installDir(env), "rulecast")
  if (await executable(installed)) {
    const probe = await probeRulecast(installed, signal)
    if (probe !== null) found.push({ via: "installed", path: installed, version: probe.version })
  }
  return found
}

/**
 * PATH entries a package runner adds for one command: the temporary installs of `npx`, `pnpm dlx`,
 * `yarn dlx` and `bunx`, and any `node_modules/.bin`, which `npm run` and `pnpm exec` put first.
 * The hook looks for the project's own node_modules itself.
 */
const TEMPORARY_BIN = /[\\/](_npx|dlx(-\d+)?|bunx-[^\\/]*)[\\/]|[\\/]node_modules[\\/]\.bin[\\/]?$/

/**
 * The adapter's settings file its hooks are already in, or null. A hook counts wherever it is
 * (spec §12), so install and doctor agree on what "installed" means.
 */
export async function hooksInstalled(root: string, adapter: Adapter, verifyMs: number): Promise<string | null> {
  return (await hookState(root, adapter, verifyMs))?.file ?? null
}

/** Where the adapter's hooks are and whether they are current: planHooks, for doctor. */
export type { HookState }

export async function hookState(root: string, adapter: Adapter, verifyMs: number): Promise<HookState | null> {
  return (await planHooks(reader(root), adapter, "shared", verifyMs)).state
}

/** What installHooks did: the settings file, the hooks added and rewritten there, and the files written beside it. */
export interface InstallResult {
  file: string
  added: string[]
  updated?: string[]
  wrote: string[]
  /** The other settings files upgraded alongside it. */
  others?: { file: string; updated: string[] }[]
}

/**
 * Adds the adapter's hooks to its settings file for `scope`, and writes the files they need. Hooks
 * already present in any of the adapter's settings files count as installed: then the settings are
 * not written and `added` is empty. The files are written whenever they are missing or differ.
 */
export async function installHooks(
  root: string,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
): Promise<InstallResult> {
  const plan = await planHooks(reader(root), adapter, scope, verifyMs).catch((error: unknown) => {
    throw error instanceof ScopeError ? new UsageError(error.message) : error
  })
  if (plan.write === null) return { file: plan.state!.file, added: [], wrote: [] }
  const { write } = plan
  if (write.settings !== null) await writeSettings(root, write.file, write.settings)
  for (const { file, settings } of write.others) await writeSettings(root, file, settings)
  // Not executable: the hooks run each file through its interpreter, as `sh <file>`.
  for (const { file, content } of write.files) await writeText(root, file, content, 0o644)
  const wrote = write.files.map(({ file }) => file)
  return plan.state === null
    ? { file: write.file, added: write.added, wrote }
    : {
        file: write.file,
        added: write.added,
        updated: write.updated,
        wrote,
        others: write.others.map(({ file, updated }) => ({ file, updated })),
      }
}

/**
 * Removes the adapter's hooks from every settings file of it that exists, and the files install
 * wrote for them: no settings file here runs them any more. A directory those files leave empty
 * goes too; one with anything else in it stays.
 */
export async function uninstallHooks(
  root: string,
  adapter: Adapter,
): Promise<{ settings: { file: string; removed: string[] }[]; files: string[] }> {
  const install = installOf(adapter)
  const results: { file: string; removed: string[] }[] = []
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    const { settings, removed } = inFile(file, () => install.remove(current.value))
    if (removed.length === 0) continue
    // Nothing left but rulecast's own hooks: the file is ours too, and `{}` is not a settings file
    // anyone wrote.
    if (isEmptyObject(settings)) await rm(path.join(root, file))
    else await writeSettings(root, file, settings)
    results.push({ file, removed })
  }
  const files: string[] = []
  for (const { file } of install.files) {
    const full = path.join(root, file)
    try {
      await rm(full)
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
    files.push(file)
    const dir = path.dirname(full)
    if ((await readdir(dir)).length === 0) await rmdir(dir)
  }
  return { settings: results, files }
}

function selectAdapters(names: string[] | undefined): Adapter[] {
  if (names === undefined) return ADAPTERS.filter((adapter) => adapter.install !== null)
  const known = ADAPTERS.filter((adapter) => adapter.install !== null).map((adapter) => adapter.name)
  return names.map((name) => {
    const adapter = adapterByName(name)
    if (!adapter?.install) throw new UsageError(`unknown agent "${name}" (use ${known.join(", ")})`)
    return adapter
  })
}

export async function loadProjectConfig(root: string, command: string): Promise<Config> {
  const data = await readConfigData(root)
  const config = data.ok ? parseConfig(data.value) : data
  if (!config.ok) throw new Error(`${config.message} (fix it, then run rulecast ${command} again)`)
  return config.value
}

export function printInstall(io: CliIo, adapter: Adapter, result: InstallResult): void {
  const updated = result.updated ?? []
  const others = result.others ?? []
  if (updated.length > 0) {
    io.stdout(`updated ${adapter.label} hooks in ${result.file}: ${updated.join(", ")}\n`)
  }
  for (const other of others) {
    io.stdout(`updated ${adapter.label} hooks in ${other.file}: ${other.updated.join(", ")}\n`)
  }
  if (result.added.length > 0) {
    io.stdout(`installed ${adapter.label} hooks in ${result.file}: ${result.added.join(", ")}\n`)
  }
  for (const file of result.wrote) io.stdout(`wrote ${file}\n`)
  if (updated.length === 0 && others.length === 0 && result.added.length === 0 && result.wrote.length === 0) {
    io.stdout(`${adapter.label} hooks already installed in ${result.file}\n`)
  }
}

/** Fetches every URL repo the config pins that is missing from the cache. False when a fetch failed. */
async function fetchMissingRepos(config: Config, io: CliIo): Promise<boolean> {
  const home = cacheHome(io.env)
  let ok = true
  for (const entry of config.repos) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    if (cachedRepo(home, entry.repo, entry.rev) !== null) continue
    const label = repoLabel(entry.repo, entry.rev)
    try {
      await ensureRepo(home, entry.repo, entry.rev)
      io.stdout(`fetched ${label}\n`)
    } catch (error) {
      io.stderr(`rulecast: could not fetch ${label}: ${errorMessage(error)}\n`)
      ok = false
    }
  }
  return ok
}

/**
 * Where hooks are installed: the directory `install` (and `init`) is run in. Claude Code reads
 * `.claude/settings*.json` only in the directory a session starts in, with no walk-up, so the
 * settings go where sessions start, not next to a config.
 */
export function settingsDir(cwd: string): string {
  return path.resolve(cwd)
}

/** Every config whose project a session started in `dir` can reach: at or above it, then below it. */
export async function reachableConfigs(dir: string): Promise<string[]> {
  return [...new Set([...configRootsAbove(dir), ...(await configRootsBelow(dir))])]
}

/** A config's directory as the person in `from` would name it: ".", "backend", "..". */
export function configLabel(from: string, root: string): string {
  return displayPath(root, from)(".")
}

/**
 * What hooks installed in `dir` must serve: every config a session started there reaches
 * (reachableConfigs), loaded, and the Stop timeout they need. Every project runs in parallel on Stop,
 * so the slowest one's verify budget is the one to wait for. One owner for install and init. `own`:
 * the config `dir` will have, when the caller is about to write it (init); it stands in for one there.
 * A config that does not load fails the call, unless `skip` is given (init): then another config's
 * failure is passed to it, and that config is left out of `configs` and `verifyMs`.
 */
export async function hookConfigs(
  dir: string,
  command: string,
  own?: Config,
  skip?: (problem: string) => void,
): Promise<{ roots: string[]; configs: Config[]; verifyMs: number }> {
  const found = await reachableConfigs(dir)
  const roots = own === undefined || found.includes(dir) ? found : [dir, ...found]
  const configs: Config[] = []
  for (const root of roots) {
    if (own !== undefined && root === dir) {
      configs.push(own)
      continue
    }
    try {
      configs.push(await loadProjectConfig(root, command))
    } catch (error) {
      if (root === dir) throw error
      const problem = `${path.join(configLabel(dir, root), CONFIG_FILE)}: ${errorMessage(error)}`
      if (skip === undefined) throw new Error(problem)
      skip(problem)
    }
  }
  // Every config skipped (doctor): the default's, rather than Math.max() of nothing, -Infinity.
  const verifyMs = Math.max(
    ...[...configs, ...(configs.length === 0 ? [defaultConfig()] : [])].map((config) => config.timeouts.verifyMs),
  )
  return { roots, configs, verifyMs }
}

/** Hooks never fetch: each config's missing repos, fetched now. False when a fetch failed. */
export async function fetchHookRepos(configs: readonly Config[], io: CliIo): Promise<boolean> {
  let fetched = true
  for (const config of configs) fetched = (await fetchMissingRepos(config, io)) && fetched
  return fetched
}

export async function installCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { agent: { type: "string", multiple: true }, scope: { type: "string", default: "shared" } },
  })
  const scope = values.scope
  if (scope !== "shared" && scope !== "personal") {
    throw new UsageError(`unknown scope "${scope}" (use shared, personal)`)
  }
  const adapters = selectAdapters(values.agent)
  const dir = settingsDir(io.cwd)
  const { roots, configs, verifyMs } = await hookConfigs(dir, "install")
  if (roots.length === 0) {
    throw new Error(`no ${CONFIG_FILE} in ${io.cwd}, its parents or below it (run rulecast init)`)
  }
  if (roots.length > 1 || roots[0] !== dir) {
    io.stdout(`configs: ${roots.map((root) => path.join(configLabel(dir, root), CONFIG_FILE)).join(", ")}\n`)
  }
  for (const adapter of adapters) {
    printInstall(io, adapter, await installHooks(dir, adapter, scope, verifyMs))
  }
  // A config whose repos are missing here would have its rules disabled.
  return (await fetchHookRepos(configs, io)) ? 0 : 2
}

export async function uninstallCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { agent: { type: "string", multiple: true } } })
  const dir = settingsDir(io.cwd)
  for (const adapter of selectAdapters(values.agent)) {
    const { settings, files } = await uninstallHooks(dir, adapter)
    if (settings.length === 0 && files.length === 0) io.stdout(`no ${adapter.label} hooks to remove\n`)
    for (const { file, removed } of settings) {
      io.stdout(`removed ${adapter.label} hooks from ${file}: ${removed.join(", ")}\n`)
    }
    for (const file of files) io.stdout(`removed ${file}\n`)
  }
  return 0
}
