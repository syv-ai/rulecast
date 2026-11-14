import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { checkoutOf } from "../git"
import { configRootsAbove, configRootsBelow } from "../projects"

/**
 * A shell command that works in another checkout of the repository: `cd ../w1-m && sed …` from the
 * lead's worktree. Its hooks arrive with the session's cwd, so rulecast compares that tree and never
 * sees what the command changed elsewhere (#71). The agent is told once per checkout: switch into it.
 */

/** The real path of `dir`, which need not exist: its nearest existing ancestor's, with the rest after it. */
const realPath = (dir: string): string => {
  const rest: string[] = []
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    try {
      return path.join(realpathSync(current), ...rest)
    } catch {
      if (path.dirname(current) === current) return path.resolve(dir)
      rest.unshift(path.basename(current))
    }
  }
}

/** Right before a quoted word: it is the target of `cd`, `pushd` or `-C`, so it is a path even with spaces. */
const TARGET_BEFORE = /(?:(?:^|[\s;&|(])(?:cd|pushd)\s+(?:--\s+)?|\b(?:git|make)\s+-C\s+)$/

/**
 * Quoted text that is prose, such as a commit message or an echo, says nothing about where the
 * command works: a quoted string with whitespace is blanked, unless it is the target of `cd`,
 * `pushd` or `-C`. A quoted single word is unquoted, since it may be a path.
 */
function maskQuoted(command: string): string {
  return command.replace(/"[^"]*"|'[^']*'/g, (quoted, offset: number) => {
    if (TARGET_BEFORE.test(command.slice(0, offset))) return quoted
    const inner = quoted.slice(1, -1)
    return /\s/.test(inner) ? "''" : inner
  })
}

/** A here-document's body is text, not where the command works: kept is the line that starts it. */
function maskHeredocs(command: string): string {
  return command.replace(/(<<-?\s*(["']?)([A-Za-z_]\w*)\2[^\n]*)\n[\s\S]*?\n\t*\3(?=\n|$)/g, "$1")
}

/**
 * Where a command says it works: `cd X`, `pushd X`, `git -C X`, `make -C X`, and any relative path
 * with a slash, `..`, absolute or `~/` path in it, outside quoted prose and here-documents.
 */
export function namedPaths(command: string, cwd: string, home: string = homedir()): string[] {
  const expand = (word: string): string => {
    const bare = word.replace(/^["']|["']$/g, "")
    if (bare === "~" || bare.startsWith("~/")) return path.join(home, bare.slice(1))
    return path.resolve(cwd, bare)
  }
  const masked = maskQuoted(maskHeredocs(command))
  const target = `("[^"]+"|'[^']+'|[^\\s;&|()]+)`
  const found: string[] = []
  for (const match of masked.matchAll(new RegExp(`(?:^|[\\s;&|(])(?:cd|pushd)\\s+(?:--\\s+)?${target}`, "g"))) {
    found.push(expand(match[1]!))
  }
  for (const match of masked.matchAll(new RegExp(`\\b(?:git|make)\\s+-C\\s+${target}`, "g"))) {
    found.push(expand(match[1]!))
  }
  // A relative path: `..`, or a word with a slash in it. One inside cwd's checkout is dropped later.
  for (const match of masked.matchAll(
    /(?:^|[\s;&|(=])(\.\.|[^\s;&|()'"`$<>~/-][^\s;&|()'"`$<>]*\/[^\s;&|()'"`$<>]*)(?=$|[\s;&|()<>])/g,
  )) {
    found.push(expand(match[1]!))
  }
  for (const match of masked.matchAll(/(?:^|[\s;&|(=])((?:~|\/)[^\s;&|()'"`$]*)/g)) {
    const word = match[1]!
    if (word === "/" || word.startsWith("/dev/")) continue
    found.push(expand(word))
  }
  // Paths with a variable in them (`cd $W/$wt`) are left out: they cannot be read without the shell.
  return [...new Set(found.filter((dir) => !dir.includes("$")))]
}

const inside = (dir: string, root: string) => dir === root || dir.startsWith(`${root}${path.sep}`)

/** The nearest existing directory at or above `dir`. */
function existingDir(dir: string): string {
  for (let current = dir; ; current = path.dirname(current)) {
    try {
      if (statSync(current).isDirectory()) return current
    } catch {
      // Not there yet: try its parent.
    }
    if (path.dirname(current) === current) return current
  }
}

/**
 * Whether the checkout at `top` has a detached HEAD: a throwaway copy, such as a gate's
 * `git worktree add --detach` to run tests in, not a place anyone edits. Read from files, without git.
 */
function detached(top: string): boolean {
  try {
    const dotGit = path.join(top, ".git")
    let gitDir = dotGit
    if (statSync(dotGit).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))
      if (pointer === null) return false
      gitDir = path.resolve(top, pointer[1]!.trim())
    }
    return !readFileSync(path.join(gitDir, "HEAD"), "utf8").startsWith("ref:")
  } catch {
    return false
  }
}

/**
 * The other checkouts of the repository that `command` works in and rulecast is not checking for
 * this call: they hold a config, above or below the named place, and none of `checked` (the projects
 * the call ran) is in them, and their HEAD is on a branch (a detached one is a throwaway copy). `skip` leaves out a checkout before its configs are looked for (one the
 * agent was told about). Sorted, so the notice reads the same each time. A checkout of the same
 * repository is one whose `.git` leads to the same common git directory (core/git.ts `checkoutOf`),
 * read from disk: git runs only to list configs below a named place in another checkout.
 */
export async function uncheckedCheckouts(
  command: string,
  cwd: string,
  checked: readonly string[],
  skip: (tree: string) => boolean = () => false,
): Promise<string[]> {
  const here = checkoutOf(cwd)
  if (here === null) return []
  const covered = new Set(checked.map((root) => checkoutOf(root)?.top))
  const found = new Set<string>()
  for (const dir of namedPaths(command, cwd).map(realPath)) {
    const near = existingDir(dir)
    const there = checkoutOf(near)
    // Outside every checkout, in this one, or in another repository: not another checkout of this one.
    if (there === null || there.top === here.top || there.commonDir !== here.commonDir) continue
    const tree = there.top
    if (found.has(tree) || covered.has(tree) || detached(tree) || skip(tree)) continue
    // Only a checkout rulecast would judge: a config above the named place inside the checkout, or below it.
    const configs =
      configRootsAbove(near).some((root) => inside(realPath(root), tree)) || (await configRootsBelow(near)).length > 0
    if (configs) found.add(tree)
  }
  return [...found].sort()
}

export function elsewhereNotice(trees: readonly string[], cwd: string): string {
  const shown = trees.map((tree) => path.relative(realPath(cwd), tree) || ".").join(", ")
  const one = trees.length === 1
  return (
    `rulecast: this command works in ${shown}, ${one ? "another checkout" : "other checkouts"} of this repository. ` +
    `Your working directory is elsewhere, so rulecast does not see what shell commands change there, and nothing there ` +
    `is checked. Switch into ${one ? "it" : "the one you work in"} first (in Claude Code, EnterWorktree with its path), ` +
    "or change its files with Edit and Write."
  )
}

/** The marker that says `agent` was told about `tree`: one file each, created exclusively. */
function noticeMarker(cache: string, sessionId: string, agent: string, tree: string): string {
  const digest = createHash("sha256").update(`${agent}\0${tree}`).digest("hex").slice(0, 32)
  return path.join(cache, "sessions", `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.elsewhere`, digest)
}

/** Whether `agent` was told about `tree` in the session. */
export function wasTold(cache: string, sessionId: string, agent: string, tree: string): boolean {
  return existsSync(noticeMarker(cache, sessionId, agent, tree))
}

/**
 * The checkouts of `trees` this agent has not been told about yet; records them as told. Each is
 * claimed by creating its marker exclusively, so of concurrent hooks only one tells it.
 */
export async function untold(
  cache: string,
  sessionId: string,
  agent: string,
  trees: readonly string[],
): Promise<string[]> {
  const fresh: string[] = []
  for (const tree of trees) {
    const marker = noticeMarker(cache, sessionId, agent, tree)
    await mkdir(path.dirname(marker), { recursive: true })
    try {
      await writeFile(marker, "", { flag: "wx" })
      fresh.push(tree)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  return fresh
}
