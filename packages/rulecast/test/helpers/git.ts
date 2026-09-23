import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createProject } from "./project"

const exec = promisify(execFile)

/**
 * Git exports these to every hook it runs, and they override `cwd`: a fixture's `init`, `commit`,
 * `checkout -b` and `tag` then land in the repository the hook is running for. `pnpm test` from
 * lefthook's pre-push hook did exactly that — it committed to the branch being pushed and left
 * v0.1.0 behind. Clearing them is what makes a fixture repository its own.
 */
const INHERITED = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
]

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const env = { ...process.env }
  for (const name of INHERITED) delete env[name]
  const { stdout } = await exec(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "-c",
      "commit.gpgsign=false",
      // A fixture must not run the developer's hooks, whether from this repo or a global hooksPath.
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, env },
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
