import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { git } from "./git"
import { createProject } from "./project"

export interface RuleRepoVersion {
  tag: string
  /** Written on top of the previous version's files. */
  files: Record<string, string>
  /** An annotated tag instead of a lightweight one. */
  annotated?: boolean
}

/** A bare git repository with one commit per version, each tagged. Returns its path (usable as a repo URL). */
export async function createRuleRepo(versions: RuleRepoVersion[]): Promise<string> {
  const work = await createProject({})
  await git(work, "init", "-q", "-b", "main")
  for (const { tag, files, annotated } of versions) {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(work, file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
    }
    await git(work, "add", "-A")
    await git(work, "commit", "-q", "--allow-empty", "-m", tag)
    if (annotated) await git(work, "tag", "-a", tag, "-m", tag)
    else await git(work, "tag", tag)
  }
  const bare = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-rules-")), "rules.git")
  await git(path.dirname(bare), "clone", "-q", "--bare", work, bare)
  return bare
}
