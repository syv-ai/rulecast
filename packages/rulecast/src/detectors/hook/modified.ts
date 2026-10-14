import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../../core/errors"

/** The bytes of each file before a hook ran; null when it did not exist. */
export type Snapshot = Map<string, Buffer | null>

export async function snapshot(files: string[], cwd: string): Promise<Snapshot> {
  const taken: Snapshot = new Map()
  for (const file of files) {
    try {
      taken.set(file, await readFile(path.resolve(cwd, file)))
    } catch (error) {
      if (!isNotFound(error)) throw error
      taken.set(file, null)
    }
  }
  return taken
}

/**
 * Puts back every file the hook changed and returns them. rulecast never rewrites an agent's file
 * behind its back: a formatter hook's change is reported as a finding, and the agent makes it.
 * A file the hook created is left alone; only files the rule selected are compared.
 */
export async function restoreChanged(taken: Snapshot, cwd: string): Promise<string[]> {
  const changed: string[] = []
  for (const [file, before] of taken) {
    const full = path.resolve(cwd, file)
    let after: Buffer | null
    try {
      after = await readFile(full)
    } catch (error) {
      if (!isNotFound(error)) throw error
      after = null
    }
    if (before === null || (after !== null && before.equals(after))) continue
    await writeFile(full, before)
    changed.push(file)
  }
  return changed
}
