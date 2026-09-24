import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

export type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

/**
 * Git exports these to every hook it runs, and they override `cwd`. rulecast always says which
 * directory it means, so a caller invoked from a git hook — a pre-commit hook running
 * `rulecast run`, or anything under `git push` — must not be redirected to the hook's repository.
 */
const INHERITED = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
]

/**
 * A copy of `env` with the inherited git variables removed. Test fixtures need exactly the same
 * scrub — a fixture's `init` and `commit` land in the surrounding repository without it — so this
 * is the one place the list lives, rather than one list per side that can drift apart.
 */
export function withoutInheritedGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env }
  for (const name of INHERITED) delete scrubbed[name]
  return scrubbed
}

function environment(extra?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return withoutInheritedGitEnv({ ...process.env, ...extra })
}

/** Runs git; a non-zero exit is a result, not an exception. `env` is added to the process environment. */
export async function git(cwd: string, args: string[], env?: Readonly<Record<string, string>>): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: environment(env),
    })
    return { ok: true, stdout }
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: string }
    if (failure.code === "ENOENT") throw new Error("git is not installed or not on PATH")
    if (typeof failure.code === "number") return { ok: false, stderr: failure.stderr ?? "" }
    throw error
  }
}

/** HEAD commit, or null outside a repository or before the first commit. */
export async function headCommit(cwd: string): Promise<string | null> {
  const result = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"])
  return result.ok ? result.stdout.trim() : null
}

/** A repo-relative file's content at a commit, or null when it does not exist there. */
export async function fileAtCommit(cwd: string, commit: string, file: string): Promise<string | null> {
  const result = await git(cwd, ["show", `${commit}:./${file}`])
  return result.ok ? result.stdout : null
}

export async function mergeBase(cwd: string, ref: string, other = "HEAD"): Promise<string> {
  const result = await git(cwd, ["merge-base", other, ref])
  if (!result.ok) throw new Error(`cannot find merge base with ${ref}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** Files that exist now and differ from `commit`: committed, uncommitted and untracked. Sorted. */
export async function changedFilesSince(cwd: string, commit: string): Promise<string[]> {
  const diff = await git(cwd, ["diff", "--name-only", "--relative", "--diff-filter=d", commit])
  if (!diff.ok) throw new Error(`git diff against ${commit} failed: ${diff.stderr.trim()}`)
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"])
  if (!untracked.ok) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`)
  const files = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean)
  return [...new Set(files)].sort()
}

function nulSeparated(stdout: string): string[] {
  return [...new Set(stdout.split("\0").filter(Boolean))].sort()
}

/** Tracked and untracked files, not ignored ones: the files `run --all-files` checks. Sorted. */
export async function allFiles(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  if (!result.ok) throw new Error(`git ls-files failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}

/** Staged files that are not deleted. Sorted. */
export async function stagedFiles(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["diff", "--cached", "--name-only", "-z", "--relative", "--diff-filter=d"])
  if (!result.ok) throw new Error(`git diff --cached failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}

/** Files changed from `from` to `to` that exist at `to`. Sorted. */
export async function changedFilesBetween(cwd: string, from: string, to: string): Promise<string[]> {
  const result = await git(cwd, ["diff", "--name-only", "-z", "--relative", "--diff-filter=d", from, to])
  if (!result.ok) throw new Error(`git diff ${from} ${to} failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}
