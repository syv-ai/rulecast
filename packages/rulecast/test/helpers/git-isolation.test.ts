import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { createRepo, git } from "./git"

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe("fixture repositories are their own", () => {
  test("a git environment inherited from a hook does not redirect a fixture's commands", async () => {
    // What `git push` hands its pre-push hook, and what `pnpm test` then inherits.
    const outer = await createRepo({ "a.txt": "outer\n" })
    process.env.GIT_DIR = path.join(outer, ".git")
    process.env.GIT_WORK_TREE = outer
    process.env.GIT_INDEX_FILE = path.join(outer, ".git", "index")

    const inner = await createRepo({ "b.txt": "inner\n" })
    await git(inner, "commit", "-q", "--allow-empty", "-m", "second")

    // The fixture's own repository moved; the one the "hook" was running for did not.
    expect(await git(inner, "log", "--format=%s")).toBe("second\ninitial")
    expect(await git(outer, "log", "--format=%s")).toBe("initial")
    expect(await git(outer, "status", "--short")).toBe("")
  })

  test("a fixture does not run the repository's hooks", async () => {
    // A hook that fails, as this project's own does when lefthook is not on the fixture's PATH.
    const hooks = mkdtempSync(path.join(tmpdir(), "rulecast-hooks-"))
    writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho refused >&2\nexit 1\n", { mode: 0o755 })
    process.env.GIT_CONFIG_COUNT = "1"
    process.env.GIT_CONFIG_KEY_0 = "core.hooksPath"
    process.env.GIT_CONFIG_VALUE_0 = hooks

    const root = await createRepo({ "a.txt": "x\n" })
    expect(await git(root, "log", "--format=%s")).toBe("initial")
  })
})
