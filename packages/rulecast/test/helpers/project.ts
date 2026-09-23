import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { readSourceFile } from "../../src/core/detection/per-rule"

/** Writes files (repo-relative path → content) into a fresh temp directory and returns its path. */
export async function createProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rulecast-test-"))
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return root
}

/** The reader a detector gets outside a guard: the file as it is on disk. */
export function fromDisk(cwd: string): (file: string) => Promise<string | null> {
  return (file) => readSourceFile(cwd, file)
}
