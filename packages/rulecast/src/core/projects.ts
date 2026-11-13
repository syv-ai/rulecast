import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { CONFIG_FILE } from "./config/load"
import { git } from "./git"
import { appendRecords, readRecords } from "./jsonl"
import { MAIN_AGENT } from "./session/state"
import type { EventKind } from "./types"

/**
 * Which configs exist and which apply to a file or an event. Every config above a file judges it as
 * its own project; nothing else walks directories looking for CONFIG_FILE.
 */

/**
 * Every ancestor of `dir`, and `dir` itself, that holds CONFIG_FILE, nearest first. A config in the
 * home directory counts only when `dir` is the home directory: below it, every repository without its
 * own config would otherwise become part of one project rooted at `~`.
 */
export function configRootsAbove(dir: string, home: string = homedir()): string[] {
  const start = path.resolve(dir)
  const homeDir = path.resolve(home)
  const roots: string[] = []
  for (let current = start; ; current = path.dirname(current)) {
    if (existsSync(path.join(current, CONFIG_FILE)) && (current !== homeDir || current === start)) roots.push(current)
    if (path.dirname(current) === current) return roots
  }
}

/**
 * Config directories strictly below `dir` in its git work tree, tracked or untracked but not ignored,
 * sorted by path. Lists untracked files, so it is slow on a large repository: only session
 * start, install, init and doctor call it. Outside a git repository it is empty.
 */
export async function configRootsBelow(dir: string): Promise<string[]> {
  const start = path.resolve(dir)
  const result = await git(start, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    `:(glob)**/${CONFIG_FILE}`,
  ])
  if (!result.ok) return []
  const roots = new Set<string>()
  for (const listed of result.stdout.split("\0")) {
    if (listed === "") continue
    const root = path.resolve(start, path.dirname(listed))
    // The glob matches dir's own config too; and the index can list a config deleted on disk.
    if (root === start || !existsSync(path.join(root, CONFIG_FILE))) continue
    roots.add(root)
  }
  return [...roots].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Each project root mapped to its root-relative files (forward slashes). A file under several configs
 * appears under each; a file under none is dropped. `files` are absolute or relative to `cwd`.
 */
export function projectsForFiles(
  cwd: string,
  files: readonly string[],
  home: string = homedir(),
): Map<string, string[]> {
  const projects = new Map<string, string[]>()
  for (const file of files) {
    const absolute = path.resolve(cwd, file)
    for (const root of configRootsAbove(path.dirname(absolute), home)) {
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      const listed = projects.get(root)
      if (!listed) projects.set(root, [relative])
      else if (!listed.includes(relative)) listed.push(relative)
    }
  }
  return projects
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_")
  // "", "." and ".." would name the directory itself or its parent.
  return /^\.*$/.test(segment) ? `_${segment}` : segment
}

function sessionRootsFile(cache: string, sessionId: string): string {
  return path.join(cache, "sessions", `${safeSegment(sessionId)}.roots`)
}

/** A root an agent of the session ran: `a` is the agent id, MAIN_AGENT for the main agent. */
interface RootRecord {
  r: string
  a: string
}

const isRootRecord = (record: unknown): record is RootRecord =>
  typeof record === "object" &&
  record !== null &&
  typeof (record as RootRecord).r === "string" &&
  typeof (record as RootRecord).a === "string"

/** Appends `roots` to the projects `agent` has run in the session. Safe under concurrent hooks. */
export async function recordSessionRoots(
  cache: string,
  sessionId: string,
  agent: string,
  roots: readonly string[],
): Promise<void> {
  await appendRecords(
    sessionRootsFile(cache, sessionId),
    roots.map((root): RootRecord => ({ r: path.resolve(root), a: agent })),
  )
}

async function rootRecords(cache: string, sessionId: string): Promise<RootRecord[]> {
  return (await readRecords<unknown>(sessionRootsFile(cache, sessionId))).filter(isRootRecord)
}

/**
 * Every project root the session has run, first-recorded first, without repeats: any agent's, or
 * only `agent`'s when it is given.
 */
export async function sessionRoots(cache: string, sessionId: string, agent?: string): Promise<string[]> {
  const records = await rootRecords(cache, sessionId)
  return dedupe(records.filter((record) => agent === undefined || record.a === agent).map((record) => record.r))
}

export interface ProjectEvent {
  cwd: string
  /** Where the session started ($CLAUDE_PROJECT_DIR for Claude Code); it does not follow a `cd`. */
  launchDir: string
  sessionId: string
  /** The agent the event is from: MAIN_AGENT, or a subagent's id. */
  agent: string
  kind: EventKind
}

/**
 * The projects of an event without files. `own` are the agent's; `subagents` are those only the
 * main agent's subagents ran (their own worktrees, say), which a config's `subagent_projects` may
 * leave out of the main agent's shell calls and stop. Empty for a subagent's event and for a
 * start, prompt or reset.
 */
export interface EventProjects {
  own: string[]
  subagents: string[]
}

/** The kinds that check the working tree and so belong to the agent's own projects. */
const CHECKS: ReadonlySet<EventKind> = new Set(["shell-before", "shell-after", "verify"])

/**
 * The projects an event without files belongs to. A session start: every config above and below the
 * launch directory. A shell call or a stop: the configs above cwd (and, for the main agent, above the
 * launch directory), then those the agent ran before; for the main agent, the ones only its
 * subagents ran come after, in `subagents`. A subagent's never reaches another agent's projects: a
 * sibling's worktree is not its work. A prompt or reset only resets bookkeeping, so it reaches every
 * project the session ran. What is above cwd and the launch directory is recorded as the agent's.
 * Deduplicated by real path, keeping the first seen.
 *
 * `cache` is the rulecast cache home (core/home.ts `cacheHome`); `home` the user's home directory.
 */
export async function projectsForEvent(
  event: ProjectEvent,
  cache: string,
  home: string = homedir(),
): Promise<EventProjects> {
  const main = event.agent === MAIN_AGENT
  if (event.kind === "start") {
    const roots = dedupe([...configRootsAbove(event.launchDir, home), ...(await configRootsBelow(event.launchDir))])
    await recordSessionRoots(cache, event.sessionId, event.agent, roots)
    return { own: roots, subagents: [] }
  }
  const here = dedupe([...configRootsAbove(event.cwd, home), ...(main ? configRootsAbove(event.launchDir, home) : [])])
  const records = (await rootRecords(cache, event.sessionId)).filter((record) =>
    existsSync(path.join(record.r, CONFIG_FILE)),
  )
  const known = new Set(records.filter((record) => record.a === event.agent).map((record) => record.r))
  const fresh = here.filter((root) => !known.has(path.resolve(root)))
  if (fresh.length > 0) await recordSessionRoots(cache, event.sessionId, event.agent, fresh)
  const recorded = (mine: boolean) =>
    records.filter((record) => (record.a === event.agent) === mine).map((record) => record.r)
  if (!CHECKS.has(event.kind)) return { own: dedupe([...here, ...records.map((record) => record.r)]), subagents: [] }
  const own = dedupe([...here, ...recorded(true)])
  if (!main) return { own, subagents: [] }
  const ownReal = new Set(own.map(realPath))
  return { own, subagents: dedupe(recorded(false)).filter((root) => !ownReal.has(realPath(root))) }
}

function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** `roots` without repeats by real path, the first seen kept. */
export function dedupe(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const root of roots) {
    const real = realPath(root)
    if (seen.has(real)) continue
    seen.add(real)
    kept.push(root)
  }
  return kept
}

/**
 * Maps a root-relative file to the path shown to whoever is at `displayFrom`: relative to it, with
 * forward slashes. Without `displayFrom` the file is shown as it is.
 */
export function displayPath(root: string, displayFrom: string | undefined): (file: string) => string {
  if (displayFrom === undefined) return (file) => file
  const from = path.resolve(displayFrom)
  return (file) => path.relative(from, path.resolve(root, file)).split(path.sep).join("/") || "."
}
