import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { CONFIG_FILE } from "./config/load"
import { checkoutOf, git } from "./git"
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
 * own config would otherwise become part of one project rooted at `~`. Nor does a config in another
 * checkout of the same repository above `dir`'s own: from a worktree at `<repo>/.claude/worktrees/x`,
 * `<repo>` is the main checkout's project, not this one's. A bare repository's directory is no
 * checkout (bareContainer): its config applies to the worktrees below it. Above a different repository (a submodule's
 * superproject, a home directory kept in git) configs still count.
 */
export function configRootsAbove(dir: string, home: string = homedir()): string[] {
  const start = path.resolve(dir)
  const homeDir = path.resolve(home)
  const chain: string[] = []
  for (let current = start; ; current = path.dirname(current)) {
    chain.push(current)
    if (path.dirname(current) === current) break
  }
  // owner[i]: the index of the checkout top chain[i] is in (the nearest ancestor holding .git), -1 outside git.
  const owner: number[] = []
  for (let i = chain.length - 1, next = -1; i >= 0; i--) {
    if (existsSync(path.join(chain[i]!, ".git"))) next = i
    owner[i] = next
  }
  const own = owner[0]!
  // Read only when a second checkout is above `dir`: a worktree's .git file, no git process.
  const repos = new Map<number, string | null>()
  const repoOf = (top: number) => {
    if (!repos.has(top)) repos.set(top, checkoutOf(chain[top]!)?.commonDir ?? null)
    return repos.get(top)!
  }
  const sameRepository = (top: number) =>
    top !== own &&
    top !== -1 &&
    own !== -1 &&
    repoOf(own) !== null &&
    repoOf(top) === repoOf(own) &&
    !bareContainer(chain[top]!)
  const roots: string[] = []
  chain.forEach((current, i) => {
    if (sameRepository(owner[i]!)) return
    if (existsSync(path.join(current, CONFIG_FILE)) && (current !== homeDir || current === start)) roots.push(current)
  })
  return roots
}

/**
 * Whether `top` holds a `.git` file naming a bare repository's own git directory, as in the "bare
 * repository plus worktrees" layout (`proj/.git` is `gitdir: ./.bare`, worktrees at `proj/w1`). Such a
 * directory is not a work tree, so it is no checkout boundary. Read from files, without git.
 */
function bareContainer(top: string): boolean {
  try {
    const dotGit = path.join(top, ".git")
    if (!statSync(dotGit).isFile()) return false
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))
    if (pointer === null) return false
    const gitDir = path.resolve(top, pointer[1]!.trim())
    // A linked worktree's git directory names the common one; a bare repository's is the common one.
    if (existsSync(path.join(gitDir, "commondir"))) return false
    return /^\s*bare\s*=\s*true\s*$/im.test(readFileSync(path.join(gitDir, "config"), "utf8"))
  } catch {
    return false
  }
}

/**
 * Whether `dir` is in another checkout of `from`'s repository: a worktree nested in its own
 * repository, seen from either side. Another repository (a submodule, say) is not.
 */
export function inOtherCheckout(dir: string, from: string): boolean {
  const there = checkoutOf(dir)
  const here = checkoutOf(from)
  return there !== null && here !== null && there.top !== here.top && there.commonDir === here.commonDir
}

/**
 * Config directories strictly below `dir` in its git work tree, tracked or untracked but not ignored,
 * sorted by path. Lists untracked files, so it is slow on a large repository: session start,
 * install, init and doctor call it, and `run --commit-msg` on every commit, where git has just
 * listed the work tree for the message template too. Outside a git repository it is empty.
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

function sessionAgentTypeFile(cache: string, sessionId: string): string {
  return path.join(cache, "sessions", `${safeSegment(sessionId)}.agent-type`)
}

/**
 * The agent type the session runs as (Claude Code's `--agent`), as its main-thread events name it.
 * Written only when it changes, so the event that names it again costs a read.
 */
export async function rememberSessionAgentType(cache: string, sessionId: string, agentType: string): Promise<void> {
  if ((await sessionAgentType(cache, sessionId)) === agentType) return
  const file = sessionAgentTypeFile(cache, sessionId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, agentType)
}

/** The type rememberSessionAgentType kept, or null when no main-thread event named one. */
export async function sessionAgentType(cache: string, sessionId: string): Promise<string | null> {
  try {
    return await readFile(sessionAgentTypeFile(cache, sessionId), "utf8")
  } catch {
    return null
  }
}

/**
 * A root an agent of the session ran: `a` is the agent id, MAIN_AGENT for the main agent. `s` marks
 * the roots a session start found, above and below the launch directory.
 */
interface RootRecord {
  r: string
  a: string
  s?: true
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
  start = false,
): Promise<void> {
  await appendRecords(
    sessionRootsFile(cache, sessionId),
    roots.map((root): RootRecord => ({ r: path.resolve(root), a: agent, ...(start ? { s: true as const } : {}) })),
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
 * launch directory, recorded as the main agent's. A shell call or a stop: the configs above cwd
 * (and, for the main agent, above the launch directory), then those the agent ran before; a
 * subagent's also reaches the configs the start found below its cwd in its own checkout, and for the
 * main agent the ones only its subagents ran come after, in `subagents`. Neither crosses into
 * another checkout of the repository above or below cwd (configRootsAbove, inOtherCheckout): a sibling's or the lead's
 * worktree is not a subagent's work. A prompt or reset only resets bookkeeping, so it reaches every
 * project the session ran. Only a start records roots here; edits and shell calls that changed
 * files record theirs (commands/hook.ts). Deduplicated by real path, keeping the first seen.
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
    await recordSessionRoots(cache, event.sessionId, event.agent, roots, true)
    return { own: roots, subagents: [] }
  }
  const here = dedupe([...configRootsAbove(event.cwd, home), ...(main ? configRootsAbove(event.launchDir, home) : [])])
  const records = (await rootRecords(cache, event.sessionId)).filter((record) =>
    existsSync(path.join(record.r, CONFIG_FILE)),
  )
  const recorded = (mine: boolean) =>
    records.filter((record) => (record.a === event.agent) === mine).map((record) => record.r)
  if (!CHECKS.has(event.kind)) return { own: dedupe([...here, ...records.map((record) => record.r)]), subagents: [] }
  if (!main) {
    const below = startRootsBelow(records, event.cwd)
    return { own: dedupe([...here, ...below, ...recorded(true)]), subagents: [] }
  }
  const own = dedupe([...here, ...recorded(true)])
  const ownReal = new Set(own.map(realPath))
  return { own, subagents: dedupe(recorded(false)).filter((root) => !ownReal.has(realPath(root))) }
}

/**
 * The roots the session start found below `cwd`, in `cwd`'s own checkout: a subagent's projects
 * there, as its shell calls and stop reach them.
 */
function startRootsBelow(records: readonly RootRecord[], cwd: string): string[] {
  const dir = path.resolve(cwd)
  return records
    .filter((record) => record.s === true && record.r.startsWith(`${dir}${path.sep}`))
    .map((record) => record.r)
    .filter((root) => !inOtherCheckout(root, dir))
}

/** startRootsBelow, read from the session's records. */
export async function sessionStartRootsBelow(cache: string, sessionId: string, cwd: string): Promise<string[]> {
  return startRootsBelow(await rootRecords(cache, sessionId), cwd)
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
