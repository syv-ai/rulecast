import path from "node:path"

import { git } from "../git"

/**
 * A git operation the session saw move `HEAD` (a pull, merge, rebase, checkout or commit), with when
 * the tree state before it was taken.
 */
export interface HeadMove {
  from: string
  to: string
  /** Epoch ms. Commits made before this came from elsewhere; commits made after it are the agent's. */
  since: number
}

/** Every git call here is on a hook's path and bounded by this; past it, nothing is excused. */
const GIT_TIMEOUT_MS = 2000

/**
 * The commits the session's git operations brought in from elsewhere (abide #5): those in a move's
 * range committed before the operation began. The agent's own `git commit`, and the commits
 * `pull --rebase` rewrites, carry a later committer time and are not among them. Committer time has
 * whole seconds, so a commit in the same second as `since` counts as the agent's.
 */
export async function foreignCommits(root: string, moves: readonly HeadMove[]): Promise<Set<string>> {
  const commits = new Set<string>()
  const listed = await Promise.all(
    moves.map((move) =>
      git(root, ["log", "--no-merges", "--format=%H %ct", `${move.from}..${move.to}`], undefined, {
        timeoutMs: GIT_TIMEOUT_MS,
      }).then((result) => ({ move, result })),
    ),
  )
  for (const { move, result } of listed) {
    if (!result.ok) continue
    for (const line of result.stdout.split("\n")) {
      const [commit, seconds] = line.split(" ")
      if (commit !== undefined && seconds !== undefined && (Number(seconds) + 1) * 1000 <= move.since) {
        commits.add(commit)
      }
    }
  }
  return commits
}

/**
 * The lines of `file`, as it is in the working tree, that `git blame` attributes to one of `commits`:
 * by position, so a line the agent wrote is never excused because a pull added the same text
 * elsewhere in the file. One git call per file; empty when blame fails or is too slow.
 */
export async function linesFromCommits(root: string, file: string, commits: ReadonlySet<string>): Promise<Set<number>> {
  const lines = new Set<number>()
  if (commits.size === 0) return lines
  const blamed = await git(root, ["blame", "--porcelain", "--contents", path.join(root, file), "--", file], undefined, {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (!blamed.ok) return lines
  for (const header of blamed.stdout.matchAll(/^([0-9a-f]{40}) \d+ (\d+)(?: (\d+))?$/gm)) {
    if (!commits.has(header[1]!)) continue
    const start = Number(header[2])
    const count = header[3] === undefined ? 1 : Number(header[3])
    for (let line = start; line < start + count; line++) lines.add(line)
  }
  return lines
}
