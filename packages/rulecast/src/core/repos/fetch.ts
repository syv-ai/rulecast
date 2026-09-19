import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

import { git } from "../git"
import { withLock } from "../session/lock"
import { repoDir } from "./layout"

export class RepoFetchError extends Error {}

/** No hook can type a password: a repo that needs credentials must fail, not wait. */
export const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" }

/** Another process may be fetching a big repo; a lock older than any fetch could take is abandoned. */
const FETCH_LOCK = { waitMs: 120_000, staleMs: 5 * 60_000, retryMs: 50 }

async function run(cwd: string, args: string[]): Promise<void> {
  const result = await git(cwd, args, NO_PROMPT)
  if (!result.ok) throw new RepoFetchError(result.stderr.trim() || `git ${args[0]} failed`)
}

/** Shallow fetch of `rev` from `url` into the empty directory `into`, checked out, without .git. */
export async function fetchCheckout(url: string, rev: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true })
  await run(into, ["init", "-q"])
  await run(into, ["fetch", "-q", "--depth", "1", url, rev])
  await run(into, ["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"])
  await rm(path.join(into, ".git"), { recursive: true, force: true })
}

/** The cached checkout of `rev`, or null when it has not been fetched. */
export function cachedRepo(home: string, url: string, rev: string): string | null {
  const dir = repoDir(home, url, rev)
  return existsSync(dir) ? dir : null
}

/**
 * Fetches `rev` into the cache once. The checkout is built in a temp directory and renamed into place under a
 * per-repo lock, so a partially fetched repo is never read and concurrent fetches of one rev share one checkout.
 */
export async function ensureRepo(home: string, url: string, rev: string): Promise<string> {
  const dir = repoDir(home, url, rev)
  if (existsSync(dir)) return dir
  const parent = path.dirname(dir)
  await withLock(
    parent,
    async () => {
      // Another process may have fetched it while this one waited for the lock.
      if (existsSync(dir)) return
      const temp = path.join(parent, `.tmp-${randomUUID()}`)
      try {
        await fetchCheckout(url, rev, temp)
        await rename(temp, dir)
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    },
    FETCH_LOCK,
  )
  return dir
}
