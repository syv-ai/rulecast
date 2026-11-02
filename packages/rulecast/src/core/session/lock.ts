import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"

export class LockTimeoutError extends Error {}

export interface LockOptions {
  waitMs: number
  staleMs: number
  retryMs: number
  /**
   * Keep the lock fresh while `fn` runs (the default), so only a dead holder's lock goes stale.
   * False for long holds that rely on staleness to get past a holder that hangs, such as a fetch.
   */
  refresh?: boolean
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
 * A lock is stale when its mtime is older than `staleMs`: its holder died (or, with `refresh: false`,
 * has held it too long). A live holder keeps it fresh, however long `fn` takes, and removes it on
 * release only while it still names that holder. Without both, a holder slower than `staleMs` was
 * taken over, and its release then removed the new owner's lock, so several processes were inside
 * at once (plan 21).
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
      // Another waiter taking over meanwhile: wait like for any held lock.
      if (Date.now() - mtimeMs > options.staleMs && (await takeOver(lock, options.staleMs))) continue
    } catch (error) {
      if (!isNotFound(error)) throw error
      continue
    }
    if (Date.now() - started > options.waitMs)
      throw new LockTimeoutError(`could not lock ${lock} within ${options.waitMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, options.retryMs))
  }
  await writeFile(path.join(lock, OWNER), token)
  const heartbeat =
    options.refresh === false
      ? null
      : setInterval(
          () => {
            const now = new Date()
            utimes(lock, now, now).catch(() => {})
          },
          Math.max(10, Math.floor(options.staleMs / 3)),
        )
  heartbeat?.unref()
  try {
    return await fn()
  } finally {
    if (heartbeat !== null) clearInterval(heartbeat)
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
 * Removes a stale lock, one waiter at a time. Several waiters can judge the same lock stale; each
 * takes over only behind `<lock>.takeover` and only if the lock is still stale there, so a second
 * waiter never removes the fresh lock the first one has since acquired. A takeover lock left by a
 * crash is itself removed once stale. False when another waiter is taking over.
 */
async function takeOver(lock: string, staleMs: number): Promise<boolean> {
  const guard = `${lock}.takeover`
  try {
    await mkdir(guard)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    try {
      if (Date.now() - (await stat(guard)).mtimeMs > staleMs) await rm(guard, { recursive: true, force: true })
    } catch (inner) {
      if (!isNotFound(inner)) throw inner
    }
    return false
  }
  try {
    if (Date.now() - (await stat(lock)).mtimeMs > staleMs) await rm(lock, { recursive: true, force: true })
  } catch (error) {
    if (!isNotFound(error)) throw error
  } finally {
    await rm(guard, { recursive: true, force: true })
  }
  return true
}
