import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"
import { git } from "../git"

/**
 * The working tree as git sees it, at one moment (spec §9, Shell edits).
 *
 * A shell command says nothing about the files it writes, so rulecast compares the tree before and
 * after the call instead of guessing from the command text. Only what `git status` lists is recorded
 * — a clean file has no entry — so a state costs a few git processes and one `lstat` and read per
 * dirty file, whatever the size of the repository.
 */
export interface TreeState {
  head: string | null
  /**
   * Project-relative path → [mtimeMs, size, content hash]; absent from the map means clean (or
   * ignored). The hash is absent for a file over HASHED_MAX_BYTES, which is compared by mtime and size.
   */
  entries: Record<string, [mtimeMs: number, size: number, hash?: string]>
}

/**
 * Files up to this size are hashed. A new mtime on the same content is not an edit: `git stash &&
 * git stash pop` rewrites every dirty file and moves no `HEAD`, and without the hash the user's
 * uncommitted work would be counted as the command's. Larger files are rare among dirty ones, and
 * reading them before every shell command would cost more than the mistake it prevents.
 */
const HASHED_MAX_BYTES = 1024 * 1024

/** The size of a listed path that no longer exists. */
const GONE = -1

/** Listed as deleted: there is nothing left to check. A file absent from the map is clean, and exists. */
export function isGone(state: TreeState, file: string): boolean {
  return state.entries[file]?.[1] === GONE
}

/**
 * Paths from `git status --porcelain=v2 -z`, and `HEAD` from its `--branch` header. Version 2
 * rather than 1 because the header saves another git process on a hook that runs before every
 * shell command. Paths are relative to the repository's top, whatever the directory.
 */
function parseStatus(stdout: string): { head: string | null; paths: string[] } {
  const fields = stdout.split("\0")
  let head: string | null = null
  const paths: string[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    if (field.startsWith("# branch.oid ")) {
      const oid = field.slice("# branch.oid ".length)
      head = oid === "(initial)" ? null : oid
    } else if (field.startsWith("1 ")) {
      paths.push(field.split(" ").slice(8).join(" "))
    } else if (field.startsWith("2 ")) {
      // A rename or copy: the new path here, the original in the next field.
      paths.push(field.split(" ").slice(9).join(" "))
      const original = fields[++index]
      if (original) paths.push(original)
    } else if (field.startsWith("u ")) {
      paths.push(field.split(" ").slice(10).join(" "))
    }
  }
  return { head, paths }
}

/** null outside a git repository, or when git fails: the caller stays silent. */
export async function treeState(root: string): Promise<TreeState | null> {
  // Tracked changes and untracked files as two processes run side by side: finding untracked files
  // is most of the cost on a large repository (vscode: 110 of 135 ms), and in parallel the wall time
  // is the slower of the two rather than their sum. Limited to the project (`-- .`): a project below
  // the repository's top owns only its own files. `ls-files` already answers relative to `root`.
  const [status, untracked, prefix] = await Promise.all([
    git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=no", "--", "."]),
    git(root, ["ls-files", "-z", "--others", "--exclude-standard"]),
    git(root, ["rev-parse", "--show-prefix"]),
  ])
  if (!status.ok || !untracked.ok || !prefix.ok) return null
  const top = prefix.stdout.trim()
  const { head, paths } = parseStatus(status.stdout)
  const files = [
    ...paths.filter((listed) => listed.startsWith(top)).map((listed) => listed.slice(top.length)),
    ...untracked.stdout.split("\0").filter(Boolean),
  ]
  const entries: TreeState["entries"] = {}
  await Promise.all(
    files.map(async (file) => {
      try {
        const stats = await lstat(path.join(root, file))
        entries[file] =
          stats.isFile() && stats.size <= HASHED_MAX_BYTES
            ? [stats.mtimeMs, stats.size, await contentHash(path.join(root, file))]
            : [stats.mtimeMs, stats.size]
      } catch (error) {
        if (!isNotFound(error)) throw error
        entries[file] = [0, GONE]
      }
    }),
  )
  return { head, entries }
}

async function contentHash(file: string): Promise<string> {
  return createHash("sha1")
    .update(await readFile(file))
    .digest("hex")
    .slice(0, 16)
}

/** Whether two entries for one path are the same file: by content when both were hashed. */
function same(
  [mtime, size, hash]: TreeState["entries"][string],
  [wasMtime, wasSize, wasHash]: TreeState["entries"][string],
): boolean {
  if (hash !== undefined && wasHash !== undefined) return hash === wasHash && size === wasSize
  return mtime === wasMtime && size === wasSize
}

/**
 * What changed between two states. A moved `HEAD` means the interval was a git operation — a
 * commit, checkout, pull or rebase — and its file changes are git's, not an edit. A stash and its
 * pop move no `HEAD`; they restore the same content, which the hash sees.
 */
export function treeChanges(
  before: TreeState,
  after: TreeState,
): { gitOperation: true } | { gitOperation: false; files: string[] } {
  if (before.head !== after.head) return { gitOperation: true }
  const files = new Set<string>()
  for (const [file, entry] of Object.entries(after.entries)) {
    const was = before.entries[file]
    if (was === undefined || !same(entry, was)) files.add(file)
  }
  for (const file of Object.keys(before.entries)) if (!(file in after.entries)) files.add(file)
  return { gitOperation: false, files: [...files].sort() }
}
