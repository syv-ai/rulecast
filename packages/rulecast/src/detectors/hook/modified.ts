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
 * The files whose bytes changed since the snapshot. A file created since is left out (a hook's
 * new file is not one the rule selected), and so is one that existed and is gone.
 */
export async function changedSince(taken: Snapshot, cwd: string): Promise<string[]> {
  const changed: string[] = []
  for (const [file, before] of taken) {
    let after: Buffer | null
    try {
      after = await readFile(path.resolve(cwd, file))
    } catch (error) {
      if (!isNotFound(error)) throw error
      after = null
    }
    if (before === null || (after !== null && before.equals(after))) continue
    changed.push(file)
  }
  return changed
}

/**
 * Puts `files` back as the snapshot has them: outside an agent's hooks, a formatter hook's change is
 * reported as a finding and the file is left as it was (`DetectorRun.leaveChanges`).
 */
export async function restore(taken: Snapshot, files: readonly string[], cwd: string): Promise<void> {
  for (const file of files) {
    const before = taken.get(file)
    if (before !== undefined && before !== null) await writeFile(path.resolve(cwd, file), before)
  }
}
