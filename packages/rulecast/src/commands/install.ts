import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { access, constants, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS, adapterByName } from "../adapters"
import { installDir, probeRulecast } from "../core/binary-home"
import { compile } from "../core/compile/project"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import type { ActiveMode } from "../core/config/mode"
import { type Config, defaultConfig } from "../core/config/schema"
import type { DetectorRegistry } from "../core/detection/registry"
import { errorMessage, isNotFound } from "../core/errors"
import { checkoutOf, git } from "../core/git"
import { cacheHome, type Env } from "../core/home"
import {
  commandsIn,
  type FileReader,
  type HookState,
  inFile,
  installOf,
  planHooks,
  ScopeError,
} from "../core/hook-plan"
import { configRootsAbove, configRootsBelow, displayPath } from "../core/projects"
import { cachedRepo, ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { cachedRepos } from "../core/repos/provider"
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

/**
 * A rulecast the hooks can run: where it was found, its path, and what `--version` printed. `via`
 * "installed" is install.sh's, whether the PATH led to it or its directory did; "path" is any other
 * on the PATH, a global npm install as a rule. `installedOnPath`: install.sh's directory is on the
 * PATH. `installedBehind`: it is, after this "path" one's directory, so what install.sh installs
 * there would never be the one the hooks run.
 */
export interface HookRulecast {
  via: "project" | "main-checkout" | "path" | "installed"
  path: string
  version: string | null
  installedOnPath: boolean
  installedBehind: boolean
}

/**
 * The rulecast a linked worktree's hook script falls back to: the main checkout's
 * `node_modules/.bin/rulecast`, found as the script finds it, from `root`'s own `.git` file and its
 * git directory's `commondir`. Null when `root` is no linked worktree's top.
 */
export function mainCheckoutRulecast(root: string): string | null {
  try {
    const dotGit = path.join(root, ".git")
    if (!statSync(dotGit).isFile()) return null
    const pointer = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"))
    if (pointer === null) return null
    const gitDir = path.resolve(root, pointer[1]!.trim())
    const common = readFileSync(path.join(gitDir, "commondir"), "utf8").trim()
    return path.resolve(gitDir, common, "..", "node_modules", ".bin", "rulecast")
  } catch {
    return null
  }
}

/**
 * Every rulecast the agent hooks' script would consider, in the order it tries them: the project's
 * `node_modules/.bin/rulecast`, then in a linked worktree the main checkout's (mainCheckoutRulecast),
 * then the PATH, then install.sh's in its directory (installDir).
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
  const entries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter)
  const PATH = entries.filter((dir) => !TEMPORARY_BIN.test(dir)).join(path.delimiter)
  const dir = installDir(env)
  // path.resolve drops a trailing slash, which the shell's lookup does not care about either.
  const position = (wanted: string) =>
    PATH.split(path.delimiter).findIndex((entry) => entry !== "" && path.resolve(entry) === path.resolve(wanted))
  const installedAt = position(dir)
  const installedOnPath = installedAt !== -1
  const common = { installedOnPath, installedBehind: false }
  const installed = path.join(dir, "rulecast")
  const project = path.join(root, "node_modules", ".bin", "rulecast")
  if (await executable(project)) {
    const version = (await probeRulecast(project, signal))?.version ?? null
    found.push({ via: "project", path: project, version, ...common })
  }
  const main = mainCheckoutRulecast(root)
  if (main !== null && (await executable(main))) {
    const version = (await probeRulecast(main, signal))?.version ?? null
    found.push({ via: "main-checkout", path: main, version, ...common })
  }
  const onPath = await commandPath("rulecast", signal, PATH)
  const probe = onPath === null ? null : await probeRulecast(onPath, signal)
  if (onPath !== null && probe !== null) {
    // install.sh's, reached through the PATH, is still install.sh's: install.sh updates it in place.
    const via = path.resolve(onPath) === path.resolve(installed) ? "installed" : "path"
    const installedBehind = via === "path" && installedOnPath && installedAt > position(path.dirname(onPath))
    found.push({ via, path: onPath, version: probe.version, installedOnPath, installedBehind })
  }
  if (!found.some((each) => each.via === "installed") && (await executable(installed))) {
    const probe = await probeRulecast(installed, signal)
    if (probe !== null) found.push({ via: "installed", path: installed, version: probe.version, ...common })
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

/**
 * The configs among `roots` with a rule that can refuse a write (refuse_write, in either mode):
 * only they need the hook that runs before every edit. Compiled with the cached rule repos, so a
 * catalog rule's own refuse_write counts; a config that does not compile has none to serve.
 */
export async function refuseWriteRoots(
  roots: readonly string[],
  registry: DetectorRegistry,
  home: string,
  /** One config's data to judge instead of its file: init's, before it is written. */
  planned?: { root: string; data: unknown },
): Promise<string[]> {
  const found: string[] = []
  for (const root of roots) {
    const configData = planned !== undefined && planned.root === root ? { configData: planned.data } : {}
    // Unattended, so `refuse_write: unattended` counts: the mode is the session's, decided later.
    const project = await compile({
      root,
      registry,
      repos: cachedRepos(home),
      mode: UNATTENDED_MODE,
      ...configData,
    }).catch(() => null)
    if (project?.rules.some((rule) => rule.enabled && rule.refuseWrite)) found.push(root)
  }
  return found
}

const UNATTENDED_MODE: ActiveMode = { mode: "unattended", source: "default", detail: "" }

/** Where the adapter's hooks are and whether they are current: planHooks, for doctor. */
export type { HookState }

/**
 * The hooks sessions started in `root` run, and whether they are current: the shared ones there,
 * else the personal ones at the checkout's top (personalRoot). Paths as `root` names them.
 */
export async function hookState(
  root: string,
  adapter: Adapter,
  verifyMs: number,
  guard = true,
): Promise<HookState | null> {
  return (
    (await ownHookState(root, adapter, verifyMs, guard)) ?? (await personalHookState(root, adapter, verifyMs, guard))
  )
}

/** The shared hooks in `root` alone. */
export async function ownHookState(
  root: string,
  adapter: Adapter,
  verifyMs: number,
  guard = true,
): Promise<HookState | null> {
  return (await planHooks(reader(root), adapter, "shared", verifyMs, { guard, dir: root, only: "shared" })).state
}

/** The personal hooks the agent reads for sessions in `root`, at the checkout's top. */
async function personalHookState(
  root: string,
  adapter: Adapter,
  verifyMs: number,
  guard: boolean,
): Promise<HookState | null> {
  if (!installOf(adapter).scopes.some((each) => each.scope === "personal")) return null
  const at = scopeRoot(root, adapter, "personal")
  const state = (await planHooks(reader(at), adapter, "personal", verifyMs, { guard, dir: at, only: "personal" })).state
  return state === null ? null : { ...state, file: fromDir(root, path.join(realpathOr(at), state.file)) }
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
 * The directory whose copy of a scope's settings file the agent reads for sessions started in
 * `dir`: `dir` itself, or for a scope read at the checkout's top (`at: "checkout"`) that top, and in
 * a linked worktree the main checkout's. Read from git's files, without git. A directory other than
 * `dir` is a real path.
 */
export function scopeRoot(dir: string, adapter: Adapter, scope: InstallScope): string {
  const entry = installOf(adapter).scopes.find((each) => each.scope === scope)
  if (entry?.at !== "checkout") return dir
  const checkout = checkoutOf(dir)
  if (checkout === null) return dir
  const main = mainCheckoutOf(checkout)
  if (main !== null) return main
  // `dir` as it was spelled when it is the top itself, so its commands keep that spelling.
  return checkout.top === realpathOr(dir) ? dir : checkout.top
}

/** A linked worktree's main checkout top, or null for a checkout that is no linked worktree. */
function mainCheckoutOf(checkout: { top: string; commonDir: string }): string | null {
  const linked = statSync(path.join(checkout.top, ".git"), { throwIfNoEntry: false })?.isFile() === true
  return linked && path.basename(checkout.commonDir) === ".git" ? path.dirname(checkout.commonDir) : null
}

/** The tops of the repository's linked worktrees, from each `gitdir` file under `<top>/.git/worktrees`, without git. */
function linkedWorktreeTops(top: string): string[] {
  const dir = path.join(top, ".git", "worktrees")
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const tops: string[] = []
  for (const name of names) {
    try {
      const dotGit = readFileSync(path.join(dir, name, "gitdir"), "utf8").trim()
      const worktree = path.dirname(path.resolve(dir, name, dotGit))
      if (statSync(worktree, { throwIfNoEntry: false })?.isDirectory() === true) tops.push(realpathOr(worktree))
    } catch {}
  }
  return tops
}

/** The settings file of `scope` that sessions started in `dir` read, as an absolute real path. */
function scopeFile(dir: string, adapter: Adapter, scope: InstallScope): string | null {
  const entry = installOf(adapter).scopes.find((each) => each.scope === scope)
  return entry === undefined ? null : path.join(realpathOr(scopeRoot(dir, adapter, scope)), entry.file)
}

/** The adapter's hook commands in a settings file; empty when it has none or does not exist. */
async function hookCommands(file: string | null, adapter: Adapter): Promise<string[]> {
  if (file === null) return []
  const current = await readSettings(path.dirname(file), path.basename(file))
  if (current === null) return []
  const install = installOf(adapter)
  // The commands that are rulecast's: what removing them takes out.
  const kept = new Set(commandsIn(inFile(file, () => install.remove(current.value)).settings))
  return [...new Set(commandsIn(current.value).filter((command) => !kept.has(command)))]
}

/** Whether a settings file exists and holds the adapter's hooks. */
async function holdsHooks(file: string | null, adapter: Adapter): Promise<boolean> {
  return (await hookCommands(file, adapter)).length > 0
}

/**
 * Whether `personal`'s rulecast hooks would run beside `shared`'s: Claude Code merges byte-identical
 * handlers, so only a command `shared` does not also run counts.
 */
async function runsBeside(personal: string, shared: string[], adapter: Adapter): Promise<boolean> {
  return (await hookCommands(personal, adapter)).some((command) => !shared.includes(command))
}

/** A path as someone in `dir` names it. */
const fromDir = (dir: string, file: string) => path.relative(realpathOr(dir), file).split(path.sep).join("/")

/** A directory as someone in `dir` names it, "." for `dir` itself. */
const dirFrom = (dir: string, other: string) => fromDir(dir, realpathOr(other)) || "."

/** "here", or "in <dir>": where a command is to be run, as someone in `from` says it. */
export const runIn = (from: string, dir: string) => (dirFrom(from, dir) === "." ? "here" : `in ${dirFrom(from, dir)}`)

function realpathOr(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** Who reads the personal file at the checkout's top, said from `dir`. */
function personalReaders(dir: string): string {
  const checkout = checkoutOf(dir)
  return checkout !== null && mainCheckoutOf(checkout) !== null
    ? "every session in the main checkout and its worktrees"
    : "every session in this checkout and its worktrees"
}

/**
 * Both kinds run for a session started in `dir`: the shared settings there, and the personal file
 * the agent reads for it, with a command the shared file does not also run (Claude Code merges
 * identical ones). The two files as `dir` names them, or null.
 */
export async function hooksTwice(dir: string, adapter: Adapter): Promise<{ shared: string; personal: string } | null> {
  const shared = installOf(adapter).scopes.find((each) => each.scope === "shared")
  const personal = scopeFile(dir, adapter, "personal")
  if (shared === undefined || personal === null) return null
  const sharedFile = path.join(realpathOr(dir), shared.file)
  if (personal === sharedFile) return null
  const commands = await hookCommands(sharedFile, adapter)
  if (commands.length === 0 || !(await runsBeside(personal, commands, adapter))) return null
  return { shared: shared.file, personal: fromDir(dir, personal) }
}

/** Why installing a scope would make sessions run rulecast twice, and the commands that would clear it. */
export interface ScopeConflict {
  reason: string
  /** `rulecast uninstall --scope … here|in <dir>`, each one to run, as `dir` says them. */
  clear: string[]
}

/**
 * Every directory, in the checkout `top` and its linked worktrees, whose `file` (a shared settings
 * file) exists: tracked, untracked or ignored, found by git per checkout, so nowhere a session can
 * start with its own settings is missed. Real paths.
 */
async function settingsDirsIn(top: string, file: string): Promise<string[]> {
  const dirs: string[] = []
  for (const checkout of [top, ...linkedWorktreeTops(top)]) {
    for (const flags of [
      ["--cached", "--others", "--exclude-standard"],
      ["--others", "--ignored", "--exclude-standard"],
    ]) {
      const listed = await git(checkout, ["ls-files", "-z", ...flags, "--", `:(glob)**/${file}`]).catch(() => null)
      if (listed === null || !listed.ok) continue
      for (const entry of listed.stdout.split("\0")) {
        if (entry === "") continue
        const found = path.resolve(checkout, entry)
        if (existsSync(found)) dirs.push(realpathOr(path.dirname(path.dirname(found))))
      }
    }
  }
  return [...new Set(dirs)]
}

/**
 * Why installing `scope`'s hooks from `dir` would make some sessions run rulecast twice, or null.
 * Claude Code merges identical handlers only, and the two scopes' commands differ. A shared file
 * serves the sessions started in its own directory; the personal file at the checkout's top serves
 * every session in the checkout and its worktrees. Install never removes hooks from a file it was
 * not asked about, so the answer is a refusal, with the uninstall commands that clear it and where.
 */
export async function scopeConflict(dir: string, adapter: Adapter, scope: InstallScope): Promise<ScopeConflict | null> {
  const install = installOf(adapter)
  const shared = install.scopes.find((each) => each.scope === "shared")
  const personal = install.scopes.find((each) => each.scope === "personal")
  if (shared === undefined || personal === undefined) return null
  const top = realpathOr(scopeRoot(dir, adapter, "personal"))
  const personalFile = path.join(top, personal.file)
  if (scope === "shared") {
    if (path.join(realpathOr(dir), shared.file) === personalFile) return null
    const writes = install.commandFor?.("shared", dir) ?? install.command
    if (!(await runsBeside(personalFile, [writes], adapter))) return null
    const clear = [`rulecast uninstall --scope personal ${runIn(dir, top)}`]
    return {
      reason:
        `sessions started ${runIn(dir, dir)} would run rulecast twice: they would read ${shared.file} here, and they already read ` +
        `${fromDir(dir, personalFile)}, whose personal hooks run rulecast for ${personalReaders(dir)}. ` +
        `To use shared hooks here instead, run ${clear[0]} first`,
      clear,
    }
  }
  // Every directory sessions of this checkout start in with settings of their own.
  const starts = [realpathOr(dir), top, ...(await settingsDirsIn(top, shared.file))]
  const found: string[] = []
  for (const start of new Set(starts)) {
    if (await holdsHooks(path.join(start, shared.file), adapter)) found.push(start)
  }
  if (found.length === 0) return null
  const clear = found.map((start) => `rulecast uninstall --scope shared ${runIn(dir, start)}`)
  return {
    reason:
      `${fromDir(dir, personalFile)} is read for ${personalReaders(dir)}, so sessions started where shared hooks already run rulecast ` +
      `would run it twice: ${found.map((start) => fromDir(dir, path.join(start, shared.file))).join(", ")}. ` +
      `Keep the shared ones, or remove them first: ${clear.join("; ")}`,
    clear,
  }
}

/**
 * Adds the adapter's hooks to its settings file for `scope`, and writes the files they need: the
 * shared file in `root`, or the personal file at the checkout's top (scopeRoot). Only that file
 * counts: hooks there are upgraded in place, and the other scope's file is never read as installed,
 * changed or removed. A scope that would make sessions run rulecast twice is refused (scopeConflict).
 */
export async function installHooks(
  root: string,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
  /** A config the hooks serve has a refuse_write rule (refuseWriteRoots). */
  guard = true,
): Promise<InstallResult> {
  const conflict = await scopeConflict(root, adapter, scope)
  if (conflict !== null) throw new Error(conflict.reason)
  const at = scope === "shared" ? root : scopeRoot(root, adapter, scope)
  const plan = await planHooks(reader(at), adapter, scope, verifyMs, { guard, dir: at, only: scope }).catch(
    (error: unknown) => {
      throw error instanceof ScopeError ? new UsageError(error.message) : error
    },
  )
  const result = await applyPlan(at, plan)
  return realpathOr(at) === realpathOr(root) ? result : rebase(result, root, at)
}

/** An install result whose files are relative to `at`, named as someone in `root` names them. */
function rebase(result: InstallResult, root: string, at: string): InstallResult {
  const shown = (file: string) => fromDir(root, path.join(realpathOr(at), file))
  return {
    ...result,
    file: shown(result.file),
    wrote: result.wrote.map(shown),
    ...(result.others === undefined
      ? {}
      : { others: result.others.map((other) => ({ ...other, file: shown(other.file) })) }),
  }
}

async function applyPlan(root: string, plan: Awaited<ReturnType<typeof planHooks>>): Promise<InstallResult> {
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
 * Removes the adapter's hooks from its settings files in `root` (`scope`'s alone, when given): what
 * the directory it runs in holds, a leftover personal file below the checkout's top included. A file
 * left with nothing but rulecast's hooks goes. The files install wrote go too, when no settings file
 * in `root` still runs rulecast; a directory they leave empty goes, one with anything else stays.
 */
export async function uninstallHooks(
  root: string,
  adapter: Adapter,
  scope?: InstallScope,
): Promise<{ settings: { file: string; removed: string[] }[]; files: string[] }> {
  const install = installOf(adapter)
  const results: { file: string; removed: string[] }[] = []
  for (const { file } of install.scopes.filter((each) => scope === undefined || each.scope === scope)) {
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
  // Another settings file here still runs the script: it stays.
  if (await anyHolds(root, adapter)) return { settings: results, files }
  for (const { file } of install.files) {
    const full = path.join(root, file)
    try {
      await rm(full)
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
    files.push(file)
    const parent = path.dirname(full)
    if ((await readdir(parent)).length === 0) await rmdir(parent)
  }
  return { settings: results, files }
}

/**
 * The personal file sessions in `dir` read, when it is not in `dir` and holds the adapter's hooks:
 * what `uninstall --scope personal` here would not touch, said with where to run it instead.
 */
export async function personalElsewhere(dir: string, adapter: Adapter): Promise<string | null> {
  const file = scopeFile(dir, adapter, "personal")
  if (file === null || path.dirname(path.dirname(file)) === realpathOr(dir)) return null
  if (!(await holdsHooks(file, adapter))) return null
  return `the personal hooks sessions here run are in ${fromDir(dir, file)}: run rulecast uninstall --scope personal ${runIn(dir, path.dirname(path.dirname(file)))}`
}

/**
 * A personal settings file in `dir` the agent never reads, because `dir` is not the checkout's top
 * (the agent reads that one only there, or the main checkout's from a worktree), holding the
 * adapter's hooks: its path as `dir` names it, or null.
 */
export async function leftoverPersonal(dir: string, adapter: Adapter): Promise<string | null> {
  const personal = installOf(adapter).scopes.find((each) => each.scope === "personal")
  if (personal?.at !== "checkout") return null
  if (realpathOr(scopeRoot(dir, adapter, "personal")) === realpathOr(dir)) return null
  return (await holdsHooks(path.join(realpathOr(dir), personal.file), adapter)) ? personal.file : null
}

async function anyHolds(dir: string, adapter: Adapter): Promise<boolean> {
  for (const { file } of installOf(adapter).scopes) {
    if (await holdsHooks(path.join(dir, file), adapter)) return true
  }
  return false
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

export async function installCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
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
  // First, so a catalog rule's refuse_write is known when the hooks are planned.
  const fetched = await fetchHookRepos(configs, io)
  const guard = (await refuseWriteRoots(roots, registry, cacheHome(io.env))).length > 0
  for (const adapter of adapters) {
    printInstall(io, adapter, await installHooks(dir, adapter, scope, verifyMs, guard))
  }
  // A config whose repos are missing here would have its rules disabled.
  return fetched ? 0 : 2
}

export async function uninstallCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { agent: { type: "string", multiple: true }, scope: { type: "string" } },
  })
  const scope = values.scope
  if (scope !== undefined && scope !== "shared" && scope !== "personal") {
    throw new UsageError(`unknown scope "${scope}" (use shared, personal)`)
  }
  const dir = settingsDir(io.cwd)
  for (const adapter of selectAdapters(values.agent)) {
    const { settings, files } = await uninstallHooks(dir, adapter, scope)
    if (settings.length === 0 && files.length === 0) {
      const elsewhere = scope === "shared" ? null : await personalElsewhere(dir, adapter)
      io.stdout(`no ${adapter.label} hooks to remove here${elsewhere === null ? "" : `; ${elsewhere}`}\n`)
    }
    for (const { file, removed } of settings) {
      io.stdout(`removed ${adapter.label} hooks from ${file}: ${removed.join(", ")}\n`)
    }
    for (const file of files) io.stdout(`removed ${file}\n`)
  }
  return 0
}
