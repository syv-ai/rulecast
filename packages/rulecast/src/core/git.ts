import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { isNotFound } from "./errors"

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
  // No optional locks: `git status` would otherwise refresh the index under .git/index.lock, and an
  // agent's own `git commit` running at that moment fails with "index.lock exists".
  return withoutInheritedGitEnv({ ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extra })
}

/**
 * Runs git; a non-zero exit is a result, not an exception. `env` is added to the process environment.
 * Past `timeoutMs` git is killed and the call is a failed result, without waiting for any process git
 * started to let go of its output.
 */
export async function git(
  cwd: string,
  args: string[],
  env?: Readonly<Record<string, string>>,
  options: { timeoutMs?: number } = {},
): Promise<GitResult> {
  const running = exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: environment(env) })
  const finished = running.then(
    ({ stdout }): GitResult => ({ ok: true, stdout }),
    (error: unknown): GitResult => {
      const failure = error as { code?: unknown; stderr?: string }
      if (isNotFound(error)) throw new Error("git is not installed or not on PATH")
      if (typeof failure.code === "number") return { ok: false, stderr: failure.stderr ?? "" }
      throw error
    },
  )
  if (options.timeoutMs === undefined) return finished
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<GitResult>((resolve) => {
    timer = setTimeout(() => {
      running.child.kill()
      running.child.stdout?.destroy()
      running.child.stderr?.destroy()
      resolve({ ok: false, stderr: `git ${args[0]} timed out after ${options.timeoutMs} ms` })
    }, options.timeoutMs)
  })
  // Once expired, the killed call's own rejection has nobody waiting for it.
  finished.catch(() => {})
  return Promise.race([finished, expired]).finally(() => clearTimeout(timer))
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

/** A repo-relative file's staged content, or null when it is not in the index. */
export async function fileInIndex(cwd: string, file: string): Promise<string | null> {
  const result = await git(cwd, ["show", `:./${file}`])
  return result.ok ? result.stdout : null
}

/** Whether this clone has only part of the history, as `actions/checkout` gives by default. */
export async function isShallow(cwd: string): Promise<boolean> {
  const result = await git(cwd, ["rev-parse", "--is-shallow-repository"])
  return result.ok && result.stdout.trim() === "true"
}

const FETCH_HISTORY = "fetch full history (actions/checkout: fetch-depth: 0)"

/**
 * The merge base of `ref` and `other`. When there is none, the error says why and what to do: the
 * usual cause is CI's shallow checkout, where git's own message is either about a ref that was
 * never fetched or nothing at all.
 */
export async function mergeBase(cwd: string, ref: string, other = "HEAD"): Promise<string> {
  const result = await git(cwd, ["merge-base", other, ref])
  if (result.ok) return result.stdout.trim()
  const shallow = await isShallow(cwd)
  const resolves = (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok
  if (!resolves) {
    throw new Error(`"${ref}" is not a commit here${shallow ? `; this is a shallow clone: ${FETCH_HISTORY}` : ""}`)
  }
  if (shallow) throw new Error(`no merge base with ${ref} in a shallow clone: ${FETCH_HISTORY}`)
  const detail = result.stderr.trim()
  throw new Error(`no merge base with ${ref}${detail ? `: ${detail}` : ": the histories are unrelated"}`)
}

/** Files that exist now and differ from `commit`: committed, uncommitted and untracked. Sorted. */
export async function changedFilesSince(cwd: string, commit: string): Promise<string[]> {
  const diff = await git(cwd, ["diff", "-z", "--name-only", "--relative", "--diff-filter=d", commit])
  if (!diff.ok) throw new Error(`git diff against ${commit} failed: ${diff.stderr.trim()}`)
  const untracked = await git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"])
  if (!untracked.ok) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`)
  return nulSeparated(`${diff.stdout}\0${untracked.stdout}`)
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
