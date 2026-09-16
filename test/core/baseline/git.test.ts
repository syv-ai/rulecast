import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { changedFilesSince, fileAtCommit, headCommit, mergeBase } from "../../../src/core/baseline/git"
import { createRepo, git } from "../../helpers/git"
import { createProject } from "../../helpers/project"

describe("git helpers", () => {
  test("headCommit is null outside a repository", async () => {
    expect(await headCommit(await createProject({}))).toBeNull()
  })

  test("fileAtCommit returns content, or null when absent", async () => {
    const root = await createRepo({ "src/a.ts": "one\n" })
    const head = (await headCommit(root))!
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    await writeFile(path.join(root, "src/a.ts"), "two\n")
    expect(await fileAtCommit(root, head, "src/a.ts")).toBe("one\n")
    expect(await fileAtCommit(root, head, "src/missing.ts")).toBeNull()
  })

  test("mergeBase and changedFilesSince cover committed, modified and untracked files", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
    const base = await headCommit(root)
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await git(root, "commit", "-q", "-am", "change a")
    await writeFile(path.join(root, "b.ts"), "b2\n")
    await writeFile(path.join(root, "new.ts"), "new\n")
    await rm(path.join(root, "c.ts"))
    expect(await mergeBase(root, "main")).toBe(base)
    expect(await changedFilesSince(root, base!)).toEqual(["a.ts", "b.ts", "new.ts"])
  })

  test("mergeBase with an unknown ref throws", async () => {
    const root = await createRepo({ "a.ts": "a\n" })
    await expect(mergeBase(root, "does-not-exist")).rejects.toThrow(/cannot find merge base with does-not-exist/)
  })
})
