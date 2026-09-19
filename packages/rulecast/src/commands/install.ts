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
 * Adds the adapter's hooks to its settings file for `scope`. Hooks already present in any of the adapter's
 * settings files count as installed: then nothing is written and `added` is empty.
 */
export async function installHooks(
  root: string,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
): Promise<{ file: string; added: string[] }> {
  const install = installOf(adapter)
  const command = install.command(existsSync(path.join(root, "node_modules", ".bin", "rulecast")))
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    if (inFile(file, () => install.merge(current.value, command, verifyMs)).added.length === 0) {
      return { file, added: [] }
    }
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

export function printInstall(io: CliIo, adapter: Adapter, result: { file: string; added: string[] }): void {
  io.stdout(
    result.added.length === 0
      ? `${adapter.label} hooks already installed in ${result.file}\n`
      : `installed ${adapter.label} hooks in ${result.file}: ${result.added.join(", ")}\n`,
  )
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
