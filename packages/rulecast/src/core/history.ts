import { git } from "./git"

/** A commit `rulecast test --history` judges a rule on: what it changed among the files the rule matches. */
export interface HistoryCommit {
  commit: string
  /** Its first parent: the change is judged against it, as `run --from-ref` judges against a base. */
  parent: string
  subject: string
  files: string[]
}

/** How far back to look for commits that touch the rule's files, per commit wanted. */
const SCAN_PER_COMMIT = 50
const SCAN_MAX = 5000

/**
 * The newest `limit` non-merge commits on HEAD that change a file `matches` accepts, newest first.
 * A root commit has no parent to judge against and is left out, as are merges: their change is
 * the branches', which are judged as their own commits.
 */
export async function recentCommits(
  root: string,
  matches: (file: string) => boolean,
  limit: number,
): Promise<HistoryCommit[]> {
  const scan = Math.min(SCAN_MAX, limit * SCAN_PER_COMMIT)
  const result = await git(root, [
    "log",
    "--no-merges",
    "-z",
    `-n${scan}`,
    "--format=%x1e%H %P%x00%s",
    "--name-only",
    "--no-renames",
    "--relative",
  ])
  if (!result.ok) throw new Error(`git log failed: ${result.stderr.trim()}`)
  const commits: HistoryCommit[] = []
  for (const entry of result.stdout.split("\x1e")) {
    if (commits.length >= limit) break
    const [ids, subject, ...names] = entry.split("\0")
    const [commit, parent] = (ids ?? "").trim().split(" ")
    if (commit === undefined || commit === "" || parent === undefined) continue
    const files = names.map((name) => name.trim()).filter((name) => name !== "" && matches(name))
    if (files.length > 0) commits.push({ commit, parent, subject: subject ?? "", files })
  }
  return commits
}
