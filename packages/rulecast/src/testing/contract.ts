import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/** One contract check. `run` throws (node:assert) when the check fails. */
export interface ContractCase {
  name: string
  run(): Promise<void>
}

/** Writes files (repo-relative path → content) into a fresh temp directory and returns its path. */
export async function contractProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rulecast-contract-"))
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return root
}
