import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { CONFIG_FILE } from "./config/load"
import { git } from "./git"
import { appendRecords, readRecords } from "./jsonl"
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

/** Appends `roots` to the session's record of the projects it has run. Safe under concurrent hooks. */
export async function recordSessionRoots(cache: string, sessionId: string, roots: readonly string[]): Promise<void> {
  await appendRecords(
    sessionRootsFile(cache, sessionId),
    roots.map((root) => path.resolve(root)),
  )
}

/** Every project root the session has run, first-recorded first, without repeats. */
export async function sessionRoots(cache: string, sessionId: string): Promise<string[]> {
  const records = await readRecords<unknown>(sessionRootsFile(cache, sessionId))
  return dedupe(records.filter((record): record is string => typeof record === "string"))
}

export interface ProjectEvent {
  cwd: string
  /** Where the session started ($CLAUDE_PROJECT_DIR for Claude Code); it does not follow a `cd`. */
  launchDir: string
  sessionId: string
  kind: EventKind
}

/**
 * The projects an event without files belongs to. A session start: every config above and below the
 * launch directory, recorded for the session. Anything else: the projects the session has run, then
 * those above cwd and above the launch directory. Deduplicated by real path, keeping the first seen:
 * for a start, above the launch dir (nearest first) then below it; otherwise above cwd (nearest
 * first), above the launch dir, then the session's recorded roots.
 *
 * `cache` is the rulecast cache home (core/home.ts `cacheHome`); `home` the user's home directory.
 */
export async function projectsForEvent(
  event: ProjectEvent,
  cache: string,
  home: string = homedir(),
): Promise<string[]> {
  if (event.kind === "start") {
    const roots = dedupe([...configRootsAbove(event.launchDir, home), ...(await configRootsBelow(event.launchDir))])
    await recordSessionRoots(cache, event.sessionId, roots)
    return roots
  }
  return dedupe([
    ...configRootsAbove(event.cwd, home),
    ...configRootsAbove(event.launchDir, home),
    ...(await sessionRoots(cache, event.sessionId)).filter((root) => existsSync(path.join(root, CONFIG_FILE))),
  ])
}

function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

function dedupe(roots: readonly string[]): string[] {
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
