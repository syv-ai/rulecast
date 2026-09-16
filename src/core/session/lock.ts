import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"

export class LockTimeoutError extends Error {}

export interface LockOptions {
  waitMs: number
  staleMs: number
  retryMs: number
}

const DEFAULTS: LockOptions = { waitMs: 2000, staleMs: 5000, retryMs: 20 }

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST"
}

/** mkdir is atomic, so the lock is a directory. Held only while `fn` runs. */
export async function withLock<T>(dir: string, fn: () => Promise<T>, options: LockOptions = DEFAULTS): Promise<T> {
  const lock = path.join(dir, ".lock")
  await mkdir(dir, { recursive: true })
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
        await rm(lock, { recursive: true, force: true })
        continue
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      continue
    }
    if (Date.now() - started > options.waitMs)
      throw new LockTimeoutError(`could not lock ${dir} within ${options.waitMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, options.retryMs))
  }
  try {
    return await fn()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}
