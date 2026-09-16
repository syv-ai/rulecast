import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "./errors"

export class CorruptStoreError extends Error {}

/** Appends records as one write; small O_APPEND writes do not interleave across processes. */
export async function appendRecords(file: string, records: readonly unknown[]): Promise<void> {
  if (records.length === 0) return
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, records.map((record) => `${JSON.stringify(record)}\n`).join(""))
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
