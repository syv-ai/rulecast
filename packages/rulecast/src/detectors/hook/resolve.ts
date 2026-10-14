import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

import { runTool } from "../../core/detection/tool"
import { isNotFound } from "../../core/errors"
import { git } from "../../core/git"
import { onPath } from "../../core/which"
import type { Runner } from "./framing"

export const PRE_COMMIT_CONFIG = ".pre-commit-config.yaml"

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null

/**
 * A hook id (or alias) in .pre-commit-config.yaml, and the stage to run it at: `pre-commit` unless
 * the hook, or the config's `default_stages`, leaves that stage out. Null when the id is not there.
 */
export async function findPreCommitHook(root: string, id: string): Promise<{ id: string; stage: string } | null> {
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
      return { id, stage: runsAtCommit ? "pre-commit" : stages[0]! }
    }
  }
  return null
}

/**
 * The repository's top, where git hooks are declared and run: a rulecast project can sit below it.
 * As a path from `root` rather than git's own absolute one, which is the realpath and would not be
 * under a root reached through a symlink. `root` itself outside a repository.
 */
export async function repositoryTop(root: string): Promise<string> {
  const result = await git(root, ["rev-parse", "--show-cdup"])
  return result.ok ? path.resolve(root, result.stdout.trim()) : root
}

/** The project's node_modules/.bin, then the repository's, then PATH. */
async function locate(name: string, root: string, top: string, signal?: AbortSignal): Promise<string | null> {
  for (const dir of new Set([root, top])) {
    const local = path.join(dir, "node_modules", ".bin", name)
    if (await onPath(local, signal)) return local
  }
  return (await onPath(name, signal)) ? name : null
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

/** lefthook's file templates, each replaced by the rule's files: rulecast decides which files, not git. */
export function substituteFiles(run: string, files: string[]): string {
  const list = files.map(quote).join(" ")
  return run.replace(/\{(staged_files|files|all_files|push_files)\}/g, list)
}
