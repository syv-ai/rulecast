import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })
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

export async function mergeBase(cwd: string, ref: string): Promise<string> {
  const result = await git(cwd, ["merge-base", "HEAD", ref])
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
