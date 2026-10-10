import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS, adapterByName } from "../adapters"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import type { Config } from "../core/config/schema"
import { errorMessage, isNotFound } from "../core/errors"
import { cacheHome } from "../core/home"
import { cachedRepo, ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import type { Adapter, AdapterInstall, InstallScope } from "../core/types"
import { onPath } from "../core/which"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** Parsed settings, or null when the file does not exist. */
async function readSettings(root: string, file: string): Promise<{ value: unknown } | null> {
  let text: string
  try {
    text = await readFile(path.join(root, file), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`)
  }
}

async function writeSettings(root: string, file: string, settings: unknown): Promise<void> {
  const full = path.join(root, file)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, `${JSON.stringify(settings, null, 2)}\n`)
}

function installOf(adapter: Adapter): AdapterInstall {
  if (!adapter.install) throw new UsageError(`${adapter.name} has no hooks to install`)
  return adapter.install
}

/** Runs an adapter's settings transform, naming the file when the settings have the wrong shape. */
function inFile<T>(file: string, transform: () => T): T {
  try {
    return transform()
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`)
  }
}

/**
 * Can the command an installed hook runs actually be found?
 *
 * The hook command is `rulecast hook <adapter>` unless rulecast is in the project's
 * `node_modules/.bin`, in which case it is that path. The bare form needs rulecast on the PATH, and
 * a project where it is on neither has hooks that are installed and silently do nothing — which
 * `doctor` exists to catch, and did not until a self-install on this repository walked into it.
 */
export async function hookCommandResolves(root: string, signal?: AbortSignal): Promise<boolean> {
  return existsSync(path.join(root, "node_modules", ".bin", "rulecast")) || (await onPath("rulecast", signal))
}

/**
 * The adapter's settings file its hooks are already in, or null. A hook counts wherever it is
 * (spec §12), so install and doctor agree on what "installed" means.
 */
export async function hooksInstalled(root: string, adapter: Adapter, verifyMs: number): Promise<string | null> {
  return (await hookState(root, adapter, verifyMs))?.file ?? null
}

/**
 * Where the adapter's hooks are and whether they are current. `stale`: installed by an older
 * rulecast with another command; `missing`: installed before rulecast needed every hook it needs
 * now (plan 11's Bash hooks). Either way `install` upgrades that file in place and `doctor` says so.
 * A file with every hook wins over one with only some.
 */
export async function hookState(
  root: string,
  adapter: Adapter,
  verifyMs: number,
): Promise<{ file: string; stale: string[]; missing: string[] } | null> {
  const install = installOf(adapter)
  const command = install.command(existsSync(path.join(root, "node_modules", ".bin", "rulecast")))
  let partial: { file: string; stale: string[]; missing: string[] } | null = null
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    const merged = inFile(file, () => install.merge(current.value, command, verifyMs))
    if (merged.added.length === 0) return { file, stale: merged.updated ?? [], missing: [] }
    const ours = inFile(file, () => install.remove(current.value)).removed.length > 0
    if (ours && partial === null) partial = { file, stale: merged.updated ?? [], missing: merged.added }
  }
  return partial
}

/**
 * Adds the adapter's hooks to its settings file for `scope`. Hooks already present in any of the
 * adapter's settings files count as installed: then nothing is written and `added` is empty.
 */
export async function installHooks(
  root: string,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
): Promise<{ file: string; added: string[]; updated?: string[] }> {
  const install = installOf(adapter)
  const command = install.command(existsSync(path.join(root, "node_modules", ".bin", "rulecast")))
  const already = await hookState(root, adapter, verifyMs)
  if (already !== null && already.stale.length === 0 && already.missing.length === 0) {
    return { file: already.file, added: [] }
  }
  if (already !== null) {
    // Installed by an older rulecast: rewrite its entries and add the missing ones where they are.
    const current = (await readSettings(root, already.file))?.value ?? {}
    const merged = inFile(already.file, () => install.merge(current, command, verifyMs))
    await writeSettings(root, already.file, merged.settings)
    return { file: already.file, added: merged.added, updated: merged.updated ?? [] }
  }
  const target = install.scopes.find((candidate) => candidate.scope === scope)
  if (!target) throw new UsageError(`${adapter.name} has no ${scope} settings`)
  const current = (await readSettings(root, target.file))?.value ?? {}
  const merged = inFile(target.file, () => install.merge(current, command, verifyMs))
  await writeSettings(root, target.file, merged.settings)
  return { file: target.file, added: merged.added }
}

/** Removes the adapter's hooks from every settings file of it that exists. */
export async function uninstallHooks(root: string, adapter: Adapter): Promise<{ file: string; removed: string[] }[]> {
  const install = installOf(adapter)
  const results: { file: string; removed: string[] }[] = []
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    const { settings, removed } = inFile(file, () => install.remove(current.value))
    if (removed.length === 0) continue
    await writeSettings(root, file, settings)
    results.push({ file, removed })
  }
  return results
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

export function printInstall(
  io: CliIo,
  adapter: Adapter,
  result: { file: string; added: string[]; updated?: string[] },
): void {
  const updated = result.updated ?? []
  if (updated.length > 0) {
    io.stdout(`updated ${adapter.label} hooks in ${result.file} to the current command: ${updated.join(", ")}\n`)
  }
  if (result.added.length > 0) {
    io.stdout(`installed ${adapter.label} hooks in ${result.file}: ${result.added.join(", ")}\n`)
  }
  if (updated.length === 0 && result.added.length === 0) {
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

export async function installCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { agent: { type: "string", multiple: true }, scope: { type: "string", default: "shared" } },
  })
  const scope = values.scope
  if (scope !== "shared" && scope !== "personal") {
    throw new UsageError(`unknown scope "${scope}" (use shared, personal)`)
  }
  const adapters = selectAdapters(values.agent)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents (run rulecast init)`)
  const config = await loadProjectConfig(root, "install")
  for (const adapter of adapters) {
    printInstall(io, adapter, await installHooks(root, adapter, scope, config.timeouts.verifyMs))
  }
  return (await fetchMissingRepos(config, io)) ? 0 : 2
}

export async function uninstallCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { agent: { type: "string", multiple: true } } })
  for (const adapter of selectAdapters(values.agent)) {
    const results = await uninstallHooks(root, adapter)
    if (results.length === 0) io.stdout(`no ${adapter.label} hooks to remove\n`)
    for (const { file, removed } of results) {
      io.stdout(`removed ${adapter.label} hooks from ${file}: ${removed.join(", ")}\n`)
    }
  }
  return 0
}
