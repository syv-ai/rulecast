import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  allFiles,
  changedFilesBetween,
  changedFilesSince,
  fileAtCommit,
  headCommit,
  mergeBase,
  stagedFiles,
} from "../../src/core/git"
import { createRepo, git } from "../helpers/git"
import { createProject } from "../helpers/project"

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
    await expect(mergeBase(root, "does-not-exist")).rejects.toThrow('"does-not-exist" is not a commit here')
  })

  test("allFiles lists tracked and untracked files but not ignored ones", async () => {
    const root = await createRepo({ ".gitignore": "dist/\n", "a.ts": "a\n", "src/b.ts": "b\n" })
    await mkdir(path.join(root, "dist"), { recursive: true })
    await writeFile(path.join(root, "dist/out.js"), "x\n")
    await writeFile(path.join(root, "new file.ts"), "n\n")
    expect(await allFiles(root)).toEqual([".gitignore", "a.ts", "new file.ts", "src/b.ts"])
  })

  test("stagedFiles lists staged files that still exist", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n" })
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await writeFile(path.join(root, "c.ts"), "c\n")
    await git(root, "add", "a.ts", "c.ts")
    await git(root, "rm", "-q", "b.ts")
    await writeFile(path.join(root, "unstaged.ts"), "u\n")
    expect(await stagedFiles(root)).toEqual(["a.ts", "c.ts"])
  })

  test("changedFilesBetween lists files changed between two commits, and mergeBase takes a second ref", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
    const base = (await headCommit(root))!
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await git(root, "rm", "-q", "c.ts")
    await git(root, "commit", "-q", "-am", "change a, delete c")
    await writeFile(path.join(root, "b.ts"), "uncommitted\n")
    expect(await mergeBase(root, "main", "feature")).toBe(base)
    expect(await changedFilesBetween(root, base, "feature")).toEqual(["a.ts"])
  })

  test("a git environment inherited from a hook does not redirect rulecast at another repository", async () => {
    const elsewhere = await createRepo({ "elsewhere.ts": "x\n" })
    const root = await createRepo({ "a.ts": "a\n" })
    const head = (await headCommit(root))!
    const saved = { ...process.env }
    // What a pre-commit hook running `rulecast run` inherits from the git that invoked it.
    process.env.GIT_DIR = path.join(elsewhere, ".git")
    process.env.GIT_WORK_TREE = elsewhere
    process.env.GIT_INDEX_FILE = path.join(elsewhere, ".git", "index")
    try {
      expect(await headCommit(root)).toBe(head)
      expect(await allFiles(root)).toEqual(["a.ts"])
      expect(await fileAtCommit(root, head, "a.ts")).toBe("a\n")
    } finally {
      process.env = saved
    }
  })
})

/** The DX review's reproduction (plan 10, H4): CI's default checkout is one commit deep. */
describe("mergeBase errors say what to do", () => {
  async function shallowFeatureClone(): Promise<string> {
    const origin = await createRepo({ "a.ts": "a\n" })
    await git(origin, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(origin, "a.ts"), "a2\n")
    await git(origin, "commit", "-qam", "feature")
    const clone = await createProject({})
    await git(clone, "clone", "-q", "--depth", "1", "--branch", "feature", `file://${origin}`, ".")
    return clone
  }

  test("a ref a shallow clone never fetched names the fix", async () => {
    const clone = await shallowFeatureClone()
    await expect(mergeBase(clone, "origin/main")).rejects.toThrow(
      '"origin/main" is not a commit here; this is a shallow clone: fetch full history (actions/checkout: fetch-depth: 0)',
    )
  })

  test("a fetched ref with no merge base in a shallow clone names the fix, never an empty tail", async () => {
    const clone = await shallowFeatureClone()
    await git(clone, "fetch", "-q", "--depth", "1", "origin", "main:refs/remotes/origin/main")
    await expect(mergeBase(clone, "origin/main")).rejects.toThrow(
      "no merge base with origin/main in a shallow clone: fetch full history (actions/checkout: fetch-depth: 0)",
    )
  })

  test("a typo in a full clone says the ref is not a commit, without the shallow advice", async () => {
    const root = await createRepo({ "a.ts": "a\n" })
    const error = await mergeBase(root, "mian").catch((caught: Error) => caught)
    expect(String(error)).toContain('"mian" is not a commit here')
    expect(String(error)).not.toContain("shallow")
  })
})
