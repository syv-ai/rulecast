import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { withoutInheritedGitEnv } from "../../src/core/git"
import { createProject } from "./project"

const exec = promisify(execFile)

/**
 * Fixtures need the same scrub the production helper does, and for the same reason: git exports
 * `GIT_DIR` and its siblings to every hook it runs, so a fixture's `init`, `commit`, `checkout -b`
 * and `tag` land in the repository the hook is running for. `pnpm test` from lefthook's pre-push
 * hook did exactly that — it committed to the branch being pushed and left v0.1.0 behind.
 *
 * The list itself lives in `src/core/git.ts`. Keeping a second copy here is what let four of its
 * seven entries go untested: `test/core/git.test.ts` and `git-isolation.test.ts` pin `GIT_DIR`,
 * `GIT_WORK_TREE` and `GIT_INDEX_FILE` on both sides, and nothing pinned the rest.
 */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const env = withoutInheritedGitEnv(process.env)
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
