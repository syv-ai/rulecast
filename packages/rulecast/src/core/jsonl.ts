import { type FileHandle, mkdir, open, readFile, rename } from "node:fs/promises"
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
 * `appendRecords` for a log that must stay bounded: a file already at `maxBytes` is renamed to
 * `rotateTo` first, replacing the previous one, so the two together hold at most about twice the cap.
 * Two writers rotating at once can push a small fresh file over the older one and lose its history,
 * which is acceptable only for a store nothing depends on.
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
    if ((await handle.stat()).size >= cap.maxBytes) {
      const full = handle
      handle = null
      await full.close()
      await rename(file, cap.rotateTo)
      handle = await open(file, "a+")
    }
    await writeRecords(handle, records)
  } finally {
    await handle?.close()
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
