import { git } from "../git"
import { fnv1a } from "./hash"

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

/**
 * Lines that commits from elsewhere brought into `file` (abide #5). A file's baseline stays what it
 * was at the session's start, so after `git pull` every line the pull added to a file the agent had
 * edited read as the agent's. A commit is from elsewhere when it was committed before the git
 * operation began: the agent's own `git commit`, and the commits `pull --rebase` rewrites, carry a
 * later committer time and stay the agent's.
 *
 * Returned as the hashes of the added lines, trimmed, as snapshots hash them (baseline/hash.ts).
 */
export async function foreignLines(root: string, moves: readonly HeadMove[], file: string): Promise<Set<number>> {
  const hashes = new Set<number>()
  for (const move of moves) {
    const listed = await git(root, ["log", "--no-merges", "--format=%H %ct", `${move.from}..${move.to}`, "--", file])
    if (!listed.ok) continue
    for (const line of listed.stdout.split("\n")) {
      const [commit, seconds] = line.split(" ")
      // Committer time has whole seconds: a commit in the same second as `since` counts as the agent's.
      if (commit === undefined || seconds === undefined || (Number(seconds) + 1) * 1000 > move.since) continue
      const diff = await git(root, ["show", "--format=", "--unified=0", "--no-color", commit, "--", file])
      if (!diff.ok) continue
      for (const added of diff.stdout.split("\n")) {
        if (added.startsWith("+") && !added.startsWith("+++")) hashes.add(fnv1a(added.slice(1).trim()))
      }
    }
  }
  return hashes
}
