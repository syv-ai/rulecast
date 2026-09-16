import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createProject } from "./project"

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args],
    { cwd },
  )
  return stdout.trim()
}

/** A git repository with `files` committed on branch main. Returns the root. */
export async function createRepo(files: Record<string, string>): Promise<string> {
  const root = await createProject(files)
  await git(root, "init", "-q", "-b", "main")
  await git(root, "add", "-A")
  await git(root, "commit", "-q", "--allow-empty", "-m", "initial")
  return root
}
