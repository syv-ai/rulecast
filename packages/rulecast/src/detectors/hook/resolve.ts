import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "yaml"

import { runTool } from "../../core/detection/tool"
import { isNotFound } from "../../core/errors"
import type { Env } from "../../core/home"
import { localBin, onPath } from "../../core/which"
import type { Runner } from "./framing"

export const PRE_COMMIT_CONFIG = ".pre-commit-config.yaml"
export const LEFTHOOK_CONFIGS = ["lefthook.yml", ".lefthook.yml", "lefthook.yaml", ".lefthook.yaml"]
/** Every name lefthook reads a main config from, YAML or not: whether lefthook is set up at all. */
const LEFTHOOK_ANY = ["", ".", ".config/"].flatMap((dir) =>
  ["yml", "yaml", "toml", "json", "jsonc"].map((ext) => `${dir}lefthook.${ext}`),
)

/** The project configs hk reads at the repository's top, in hk's order: it evaluates the first there (hk 2.12). */
export const HK_CONFIGS = ["hk.pkl", ".config/hk.pkl"]
/** Personal configs hk evaluates instead, when there: they usually amend hk.pkl. */
const HK_LOCAL_CONFIGS = ["hk.local.pkl", ".config/hk.local.pkl"]

/** Whether the repository's top holds `file`. */
export async function hasConfig(top: string, file: string): Promise<boolean> {
  try {
    await readFile(path.join(top, file))
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

/**
 * What to say when a hook rule's hook manager has no config here: the repository moved to another
 * manager, or the rule was copied from another repository (#87). Null when the config is there.
 */
export async function missingManager(top: string, manager: "pre-commit" | "lefthook" | "hk"): Promise<string | null> {
  const files = manager === "pre-commit" ? [PRE_COMMIT_CONFIG] : manager === "lefthook" ? LEFTHOOK_ANY : HK_CONFIGS
  for (const file of files) if (await hasConfig(top, file)) return null
  return `no ${files[0]} in the repository, so ${manager} is not set up here and this rule cannot run; point the rule at the hook manager the project uses now, or remove it`
}

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === "string" ? value : "")
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null

/**
 * A hook id (or alias) in .pre-commit-config.yaml, and the stage to run it at: `pre-commit` unless
 * the hook, or the config's `default_stages`, leaves that stage out. `givenFiles`: the hook gets
 * the files it is run on. Null when the id is not there.
 */
export async function findPreCommitHook(
  root: string,
  id: string,
): Promise<{ id: string; stage: string; givenFiles: boolean } | null> {
  let text: string
  try {
    text = await readFile(path.join(root, PRE_COMMIT_CONFIG), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const config: unknown = parse(text)
  if (!isObject(config) || !Array.isArray(config.repos)) return null
  const defaults = strings(config.default_stages)
  for (const repo of config.repos) {
    if (!isObject(repo) || !Array.isArray(repo.hooks)) continue
    for (const hook of repo.hooks) {
      if (!isObject(hook) || (hook.id !== id && hook.alias !== id)) continue
      const stages = strings(hook.stages) ?? defaults
      // "commit" is the pre-3.2 name of the pre-commit stage.
      const runsAtCommit = stages === null || stages.includes("pre-commit") || stages.includes("commit")
      const givenFiles = await getsItsFiles(repo, hook)
      return { id, stage: runsAtCommit ? "pre-commit" : stages[0]!, givenFiles }
    }
  }
  return null
}

/**
 * Whether a hook gets the files it is run on: always_run and pass_filenames: false run it over the
 * project instead. The config's own values win; a remote hook's defaults are in its repository's
 * .pre-commit-hooks.yaml, read from the clone pre-commit or prek already made at that rev. Unknown,
 * with no clone, counts as not given.
 */
async function getsItsFiles(repo: JsonObject, hook: JsonObject): Promise<boolean> {
  const own = (field: "always_run" | "pass_filenames") =>
    typeof hook[field] === "boolean" ? (hook[field] as boolean) : undefined
  if (own("always_run") === true || own("pass_filenames") === false) return false
  if (own("always_run") === false && own("pass_filenames") === true) return true
  // A local hook is all in the config: pre-commit's defaults, always_run false and pass_filenames true.
  if (typeof repo.repo !== "string" || repo.repo === "local" || repo.repo === "meta") return true
  if (typeof repo.rev !== "string") return false
  const manifest = await cachedManifest(repo.repo, repo.rev)
  const entry = manifest?.find((one) => isObject(one) && one.id === hook.id)
  if (!isObject(entry)) return false
  const always = own("always_run") ?? entry.always_run === true
  const names = own("pass_filenames") ?? entry.pass_filenames !== false
  return !always && names
}

/**
 * A remote hook repository's .pre-commit-hooks.yaml at `rev`, from the clone pre-commit
 * (`<PRE_COMMIT_HOME>/repo*`, its .git/FETCH_HEAD naming rev and url) or prek
 * (`<PREK_HOME>/repos/*`, its .prek-repo.json) already made. Null when neither has one: never fetched.
 */
async function cachedManifest(url: string, rev: string): Promise<unknown[] | null> {
  const env = process.env
  const cache = env.XDG_CACHE_HOME || path.join(env.HOME || os.homedir(), ".cache")
  const clones: string[] = []
  const preCommit = env.PRE_COMMIT_HOME || path.join(cache, "pre-commit")
  for (const name of await readdir(preCommit).catch(() => [] as string[])) {
    if (!name.startsWith("repo")) continue
    const fetched = await readFile(path.join(preCommit, name, ".git", "FETCH_HEAD"), "utf8").catch(() => "")
    if (fetched.split("\n")[0]!.endsWith(`'${rev}' of ${url}`)) clones.push(path.join(preCommit, name))
  }
  const prek = path.join(env.PREK_HOME || path.join(cache, "prek"), "repos")
  for (const name of await readdir(prek).catch(() => [] as string[])) {
    const meta = await readFile(path.join(prek, name, ".prek-repo.json"), "utf8").catch(() => "")
    try {
      const repo: unknown = JSON.parse(meta)
      if (isObject(repo) && repo.repo === url && repo.rev === rev) clones.push(path.join(prek, name))
    } catch {
      // Not a clone prek finished.
    }
  }
  for (const clone of clones) {
    try {
      const manifest: unknown = parse(await readFile(path.join(clone, ".pre-commit-hooks.yaml"), "utf8"))
      if (Array.isArray(manifest)) return manifest
    } catch {
      // No manifest in that clone: try the next.
    }
  }
  return null
}

/** node_modules/.bin from the project up to the repository's top (core/which.ts `localBin`), then PATH. */
async function locate(name: string, root: string, top: string, signal?: AbortSignal): Promise<string | null> {
  return (await localBin(name, root, top)) ?? ((await onPath(name, signal)) ? name : null)
}

/** prek when installed (a third of pre-commit's overhead, same config), else pre-commit. */
export async function preCommitRunner(
  root: string,
  top: string,
  signal?: AbortSignal,
): Promise<{ runner: Runner; command: string } | null> {
  for (const runner of ["prek", "pre-commit"] as const) {
    const command = await locate(runner, root, top, signal)
    if (command !== null) return { runner, command }
  }
  return null
}

export async function hkCommand(root: string, top: string, signal?: AbortSignal): Promise<string | null> {
  return locate("hk", root, top, signal)
}

/** One step of an hk run, as `--format json` reports it. */
export interface HkStep {
  name: string
  status: string
  output?: string
}

/**
 * What `hk run --format json` printed: the run's status, why it failed before any step ran
 * (`failure` with no steps: an unknown hook or step), and each step.
 */
export function parseHkRun(stdout: string): { status: string; failure: string | null; steps: HkStep[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!isObject(parsed) || typeof parsed.status !== "string" || !Array.isArray(parsed.steps)) return null
  const steps = parsed.steps.filter(
    (step): step is HkStep => isObject(step) && typeof step.name === "string" && typeof step.status === "string",
  )
  return { status: parsed.status, failure: typeof parsed.failure === "string" ? parsed.failure : null, steps }
}

/**
 * The environment every hk call gets: HK_PKL_OFFLINE makes hk refuse to download a Pkl package it
 * has not cached (hk 2.12), so no plan or run can fetch one, whatever `hkNeedsNetwork` concluded.
 */
export const HK_ENV: Readonly<Record<string, string>> = { HK_PKL_OFFLINE: "1" }

/** One step of hk's plan for a hook: `skipped` with a reason when hk would not run it. */
export interface HkPlanStep {
  name: string
  status: string
  reasons: { kind: string; detail: string }[]
}

/** hk's plan for one hook: its steps, `missing` when hk.pkl has no such hook, or hk's error. */
export type HkPlan = { steps: HkPlanStep[] } | { missing: true } | { error: string }

/**
 * hk's plan for one hook in check mode, from `hk run <hook> --plan --json --all --check`. A
 * commit-msg hook takes the message file first: an empty one stands in. Never ask this for
 * pre-push: its plan asks the git remote for the default branch (hk 2.12).
 */
export async function hkPlan(command: string, top: string, hook: string, signal: AbortSignal): Promise<HkPlan> {
  const message = hook === "commit-msg" ? [os.devNull] : []
  const ran = await runTool(command, ["run", hook, ...message, "--plan", "--json", "--all", "--check"], {
    cwd: top,
    signal,
    notFound: "hk is not installed",
    env: HK_ENV,
  })
  if (`${ran.stderr}\n${ran.stdout}`.includes(`Hook '${hook}' not found`)) return { missing: true }
  let plan: unknown
  try {
    plan = JSON.parse(ran.stdout)
  } catch {
    plan = null
  }
  if (!isObject(plan) || !Array.isArray(plan.steps)) {
    // hk's error ends in its cause: "hk.pkl:2:62: Missing `}` delimiter.", "HTTP fetch failed for …".
    const said = `${ran.stderr}\n${ran.stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^(?:Error:|\d+:)\s*/, ""))
      .filter((line) => line !== "" && !/^(?:Caused by:|Error output:|Location:|See |[✔❯|]|\d+\s*\|)/.test(line))
    return { error: said.at(-1) ?? `hk exited ${ran.exitCode}` }
  }
  const steps = plan.steps.flatMap((step): HkPlanStep[] => {
    if (!isObject(step) || typeof step.name !== "string") return []
    const reasons = Array.isArray(step.reasons)
      ? step.reasons.filter(isObject).map((reason) => ({ kind: text(reason.kind), detail: text(reason.detail) }))
      : []
    return [{ name: step.name, status: text(step.status), reasons }]
  })
  return { steps }
}

/** Why hk never runs a planned step in check mode, as hk says it, or null when it may run it. */
export function hkStepNeverRuns(step: HkPlanStep): string | null {
  if (step.status !== "skipped") return null
  // no_command: only a fix command. profile_exclude: a profile rulecast does not enable.
  const reason = step.reasons.find((one) => one.kind === "no_command" || one.kind === "profile_exclude")
  return reason === undefined ? null : reason.detail || reason.kind
}

/** Why hk's pre-push steps are not read: the plan reaches the network. */
export const HK_PRE_PUSH_UNREAD =
  "not read: hk's plan for pre-push asks the git remote for its default branch; `hk run pre-push --plan` lists them"

/**
 * Why hk can't be asked for its plan without the network, or null when it can. hk evaluates its
 * Pkl config with pklr, which downloads each `package://` module the first time into its cache
 * (`<cache>/pklr/packages`, one `.url` file per download naming the zip it came from). So hk is
 * asked only when every package the configs it reads use is already there, and no config reads an
 * http(s) module.
 */
export async function hkNeedsNetwork(top: string, env: Env): Promise<string | null> {
  const home = env.HOME || os.homedir()
  const entry = [...HK_LOCAL_CONFIGS, ...HK_CONFIGS].find((file) => existsSync(path.join(top, file)))
  const roots = [
    ...(entry === undefined ? [] : [path.join(top, entry)]),
    path.join(top, ".hkrc.pkl"),
    path.join(home, ".hkrc.pkl"),
    path.join(home, ".config", "hk", "config.pkl"),
  ]
  const packages = new Set<string>()
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      source = await readFile(file, "utf8")
    } catch {
      continue
    }
    for (const match of source.matchAll(PKL_MODULE)) {
      const uri = match[1]!
      if (uri.startsWith("package://")) packages.add(uri)
      else if (/^https?:/.test(uri)) return `${path.relative(top, file) || file} reads ${uri}, which hk would download`
      else if (!/^[a-z]+:/.test(uri)) queue.push(path.resolve(path.dirname(file), uri))
    }
  }
  if (packages.size === 0) return null
  const cached = await pklrCached(env, home)
  for (const uri of packages) {
    const zip = `https://${uri.slice("package://".length).replace(/#.*$/, "")}.zip`
    if (!cached.has(zip)) return `hk's Pkl package ${zip} is not in hk's cache, and reading hk.pkl would download it`
  }
  return null
}

/** A module a Pkl file amends, extends, imports or reads: `amends "package://…#/Config.pkl"`. */
const PKL_MODULE = /\b(?:amends|extends|import\*?|read[?*]?\s*\()\s*"([^"]+)"/g

/**
 * The zips pklr has downloaded. Its cache is $HK_PKL_CACHE_DIR when hk is given one, else `pklr` in
 * the platform's cache directory (dirs::cache_dir); the packages sit in `packages/` under it.
 */
async function pklrCached(env: Env, home: string): Promise<Set<string>> {
  const base =
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : process.platform === "win32"
        ? (env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
        : env.XDG_CACHE_HOME || path.join(home, ".cache")
  const dir = path.join(env.HK_PKL_CACHE_DIR || path.join(base, "pklr"), "packages")
  const names = await readdir(dir).catch(() => [] as string[])
  const urls = await Promise.all(
    names.filter((name) => name.endsWith(".url")).map((name) => readFile(path.join(dir, name), "utf8").catch(() => "")),
  )
  return new Set(urls.map((url) => url.trim()))
}

export async function lefthookCommand(root: string, top: string, signal?: AbortSignal): Promise<string | null> {
  return locate("lefthook", root, top, signal)
}

/** lefthook's merged config (extends and lefthook-local applied), as `lefthook dump` prints it. */
export async function lefthookDump(command: string, root: string, signal: AbortSignal): Promise<unknown> {
  const dumped = await runTool(command, ["dump", "--format", "json"], {
    cwd: root,
    signal,
    notFound: "lefthook is not installed",
  })
  try {
    return JSON.parse(dumped.stdout)
  } catch {
    throw new Error(`lefthook dump did not print JSON: ${dumped.stderr.trim() || dumped.stdout.trim()}`)
  }
}

function findJob(jobs: unknown, name: string): JsonObject | null {
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      if (!isObject(job)) continue
      if (job.name === name) return job
      const nested = isObject(job.group) ? findJob(job.group.jobs, name) : null
      if (nested) return nested
    }
    return null
  }
  // lefthook 1's `commands:` map, still read by lefthook 2.
  return isObject(jobs) && isObject(jobs[name]) ? (jobs[name] as JsonObject) : null
}

/** `<hook>/<job>` in a dump: the job's command and directory. Null when there is none, or it is a group or a script. */
export function findLefthookJob(dump: unknown, spec: string): { run: string; root: string } | null {
  const slash = spec.indexOf("/")
  const hook = isObject(dump) ? dump[spec.slice(0, slash)] : undefined
  if (!isObject(hook)) return null
  const name = spec.slice(slash + 1)
  const job = findJob(hook.jobs, name) ?? findJob(hook.commands, name)
  if (!job || typeof job.run !== "string") return null
  return { run: job.run, root: typeof job.root === "string" ? job.root.replace(/\/+$/, "") : "" }
}

const quote = (file: string) => `'${file.replaceAll("'", "'\\''")}'`

/** lefthook's file templates: a job's command that has one is given files. */
export const FILE_TEMPLATE = /\{(staged_files|files|all_files|push_files)\}/

/** lefthook's file templates, each replaced by the rule's files: rulecast decides which files, not git. */
export function substituteFiles(run: string, files: string[]): string {
  const list = files.map(quote).join(" ")
  return run.replace(new RegExp(FILE_TEMPLATE.source, "g"), list)
}
