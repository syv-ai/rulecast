import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"

export class LockTimeoutError extends Error {}

export interface LockOptions {
  waitMs: number
  staleMs: number
  retryMs: number
}

const DEFAULTS: LockOptions = { waitMs: 2000, staleMs: 5000, retryMs: 20 }

/** The file in the lock directory naming its holder. */
const OWNER = "owner"

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST"
}

/** mkdir is atomic, so the lock is a directory. Held only while `fn` runs. */
export async function withLock<T>(dir: string, fn: () => Promise<T>, options: LockOptions = DEFAULTS): Promise<T> {
  await mkdir(dir, { recursive: true })
  return withLockAt(path.join(dir, ".lock"), fn, options)
}

/**
 * `withLock` with the lock directory named outright; its parent must exist.
 *
 * A lock is stale when its mtime is older than `staleMs`: its holder died. A live holder keeps it
 * fresh, however long `fn` takes, and removes it on release only while it still names that holder.
 * Without both, a holder slower than `staleMs` was taken over, and its release then removed the new
 * owner's lock, so several processes were inside at once (plan 21).
 */
export async function withLockAt<T>(lock: string, fn: () => Promise<T>, options: LockOptions = DEFAULTS): Promise<T> {
  const token = `${process.pid}-${randomUUID()}`
  const started = Date.now()
  for (;;) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    try {
      const { mtimeMs } = await stat(lock)
      if (Date.now() - mtimeMs > options.staleMs) {
        await takeOver(lock, token, options.staleMs)
        continue
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      continue
    }
    if (Date.now() - started > options.waitMs)
      throw new LockTimeoutError(`could not lock ${lock} within ${options.waitMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, options.retryMs))
  }
  await writeFile(path.join(lock, OWNER), token)
  const heartbeat = setInterval(
    () => {
      const now = new Date()
      utimes(lock, now, now).catch(() => {})
    },
    Math.max(10, Math.floor(options.staleMs / 3)),
  )
  heartbeat.unref()
  try {
    return await fn()
  } finally {
    clearInterval(heartbeat)
    if ((await ownerOf(lock)) === token) await rm(lock, { recursive: true, force: true })
  }
}

async function ownerOf(lock: string): Promise<string | null> {
  try {
    return await readFile(path.join(lock, OWNER), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

/**
 * Moves a stale lock aside, then removes it. Two waiters can judge the same lock stale; the second
 * to rename may move the first's fresh lock instead, so a lock that turns out fresh once moved is
 * put back.
 */
async function takeOver(lock: string, token: string, staleMs: number): Promise<void> {
  const aside = `${lock}.stale-${token}`
  try {
    await rename(lock, aside)
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
  const { mtimeMs } = await stat(aside)
  if (Date.now() - mtimeMs <= staleMs) {
    try {
      await rename(aside, lock)
      return
    } catch {
      // Someone locked meanwhile; the holder moved aside finds its lock gone and leaves theirs.
    }
  }
  await rm(aside, { recursive: true, force: true })
}
