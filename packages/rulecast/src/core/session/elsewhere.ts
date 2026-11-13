import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { git } from "../git"
import { appendRecords, readRecords } from "../jsonl"
import { configRootsAbove } from "../projects"

/**
 * A shell command that works in another checkout of the repository: `cd ../w1-m && sed …` from the
 * lead's worktree. Its hooks arrive with the session's cwd, so rulecast compares that tree and never
 * sees what the command changed elsewhere (#71). The agent is told once per checkout: switch into it.
 */

const realPath = (dir: string): string => {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** Where a command says it works: `cd X`, `pushd X`, `git -C X`, and any absolute or `~/` path in it. */
export function namedPaths(command: string, cwd: string, home: string = homedir()): string[] {
  const expand = (word: string): string => {
    const bare = word.replace(/^["']|["']$/g, "")
    if (bare === "~" || bare.startsWith("~/")) return path.join(home, bare.slice(1))
    return path.resolve(cwd, bare)
  }
  const found: string[] = []
  for (const match of command.matchAll(/(?:^|[\s;&|(])(?:cd|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|()]+)/g)) {
    found.push(expand(match[1]!))
  }
  for (const match of command.matchAll(/\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|()]+)/g)) found.push(expand(match[1]!))
  for (const match of command.matchAll(/(?:^|[\s;&|(=])((?:~|\/)[^\s;&|()'"`$]*)/g)) {
    const word = match[1]!
    if (word === "/" || word.startsWith("/dev/") || word.startsWith("/tmp/")) continue
    found.push(expand(word))
  }
  // Paths with a variable in them (`cd $W/$wt`) are left out: they cannot be read without the shell.
  return [...new Set(found.filter((dir) => !dir.includes("$")))]
}

/** The repository's checkouts, by real path, from `git worktree list`; empty outside git. */
async function worktrees(cwd: string): Promise<string[]> {
  const listed = await git(cwd, ["worktree", "list", "--porcelain"])
  if (!listed.ok) return []
  return listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realPath(line.slice("worktree ".length)))
}

const inside = (dir: string, root: string) => dir === root || dir.startsWith(`${root}${path.sep}`)

/**
 * The other checkouts of the repository that `command` works in and rulecast is not checking for
 * this call: they hold a config, and none of `checked` (the call's projects) is inside them.
 * Sorted, so the notice reads the same each time.
 */
export async function uncheckedCheckouts(command: string, cwd: string, checked: readonly string[]): Promise<string[]> {
  const named = namedPaths(command, cwd)
  if (named.length === 0) return []
  const all = await worktrees(cwd)
  const here = all.filter((tree) => inside(realPath(cwd), tree)).sort((a, b) => b.length - a.length)[0]
  const checkedReal = checked.map(realPath)
  const found = new Set<string>()
  for (const dir of named.map(realPath)) {
    const tree = all.filter((one) => one !== here && inside(dir, one)).sort((a, b) => b.length - a.length)[0]
    if (tree === undefined || checkedReal.some((root) => inside(root, tree))) continue
    // Only a checkout rulecast would judge: a config above the named place, inside the checkout.
    const start = existsSync(dir) ? dir : tree
    if (!configRootsAbove(start).some((root) => inside(realPath(root), tree))) continue
    found.add(tree)
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

function noticesFile(cache: string, sessionId: string): string {
  return path.join(cache, "sessions", `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.elsewhere`)
}

/** The checkouts of `trees` this agent has not been told about yet; records them as told. */
export async function untold(
  cache: string,
  sessionId: string,
  agent: string,
  trees: readonly string[],
): Promise<string[]> {
  if (trees.length === 0) return []
  const file = noticesFile(cache, sessionId)
  const told = new Set(
    (await readRecords<{ a?: unknown; t?: unknown }>(file))
      .filter((record) => record.a === agent)
      .map((record) => record.t),
  )
  const fresh = trees.filter((tree) => !told.has(tree))
  if (fresh.length > 0)
    await appendRecords(
      file,
      fresh.map((tree) => ({ a: agent, t: tree })),
    )
  return fresh
}
