import type { Stats } from "node:fs"
import { type FileHandle, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "./errors"

export class CorruptStoreError extends Error {}

/** Appends records as one write; small O_APPEND writes do not interleave across processes. */
export async function appendRecords(file: string, records: readonly unknown[]): Promise<void> {
  if (records.length === 0) return
  await mkdir(path.dirname(file), { recursive: true })
  const handle = await open(file, "a+")
  try {
    await writeRecords(handle, records)
  } finally {
    await handle.close()
  }
}

/**
 * Appends to a log that must stay bounded and is shared by concurrent writers: a file already at
 * `maxBytes` is renamed to `rotateTo` first, replacing the previous one, so the two together hold at
 * most about twice the cap.
 *
 * A writer rotates only the file it opened, and only while it holds `<rotateTo>.lock`: when the
 * path no longer names that file, another writer has rotated already, and this one appends to the
 * new file. Without both, two writers that reach the cap together can each rename, and the second
 * push a fresh file over the full one the first rotated. A writer that does not get the lock just
 * appends; a lock left by a crashed writer is taken over once it is a minute old.
 *
 * It never heals a partial last line, which would truncate under a live writer: it starts its own
 * line instead, so the log's reader must skip lines it cannot parse.
 */
export async function appendRecordsCapped(
  file: string,
  records: readonly unknown[],
  cap: { maxBytes: number; rotateTo: string },
): Promise<void> {
  if (records.length === 0) return
  await mkdir(path.dirname(file), { recursive: true })
  let handle: FileHandle | null = await open(file, "a+")
  try {
    const opened = await handle.stat()
    if (opened.size >= cap.maxBytes) {
      const full = handle
      handle = null
      await full.close()
      await rotate(file, opened, cap.rotateTo)
      handle = await open(file, "a+")
    }
    const { size } = await handle.stat()
    const last = Buffer.alloc(1)
    if (size > 0) await handle.read(last, 0, 1, size - 1)
    const text = records.map((record) => `${JSON.stringify(record)}\n`).join("")
    await handle.appendFile(size > 0 && last[0] !== 0x0a ? `\n${text}` : text)
  } finally {
    await handle?.close()
  }
}

const STALE_LOCK_MS = 60_000

async function rotate(file: string, opened: Stats, rotateTo: string): Promise<void> {
  const lock = `${rotateTo}.lock`
  let held: FileHandle
  try {
    held = await open(lock, "wx")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const age = await stat(lock).then(
      (lockStat) => Date.now() - lockStat.mtimeMs,
      () => 0,
    )
    if (age < STALE_LOCK_MS) return
    await rm(lock, { force: true })
    return rotate(file, opened, rotateTo)
  }
  try {
    if (await names(file, opened)) await rename(file, rotateTo)
  } finally {
    await held.close()
    await rm(lock, { force: true })
  }
}

/** Whether `file` still names the file `opened` was taken from. */
async function names(file: string, opened: Stats): Promise<boolean> {
  try {
    const now = await stat(file)
    return now.ino === opened.ino && now.dev === opened.dev
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

async function writeRecords(handle: FileHandle, records: readonly unknown[]): Promise<void> {
  await dropPartialRecord(handle)
  await handle.appendFile(records.map((record) => `${JSON.stringify(record)}\n`).join(""))
}

const TAIL_CHUNK = 64 * 1024

/**
 * A crash mid-append leaves a partial last line; appending after it would make it non-final and so a store
 * error. Truncates it away. Two writers healing the same crash at once can lose one of their records.
 */
async function dropPartialRecord(handle: FileHandle): Promise<void> {
  const { size } = await handle.stat()
  let end = size
  while (end > 0) {
    const start = Math.max(0, end - TAIL_CHUNK)
    const chunk = Buffer.alloc(end - start)
    await handle.read(chunk, 0, chunk.length, start)
    const newline = chunk.lastIndexOf(0x0a)
    if (newline !== -1) {
      end = start + newline + 1
      break
    }
    end = start
  }
  if (end < size) await handle.truncate(end)
}

export async function readRecords<T>(file: string): Promise<T[]> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const lines = text.split("\n")
  const records: T[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line) as T)
    } catch {
      // Only a crash mid-append can leave a partial record, and only as the last line.
      if (i === lines.length - 1) break
      throw new CorruptStoreError(`${file}: unparseable record on line ${i + 1}`)
    }
  }
  return records
}
