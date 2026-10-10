import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, test } from "vitest"

import { type TreeState, treeChanges, treeState } from "../../../src/core/session/tree"
import { createRepo, git } from "../../helpers/git"

async function stateOf(root: string): Promise<TreeState> {
  const state = await treeState(root)
  if (state === null) throw new Error("no tree state")
  return state
}

/** Changes made by `act`, as a shell call's before and after states would see them. */
async function changedBy(root: string, act: () => Promise<unknown>) {
  const before = await stateOf(root)
  await act()
  return treeChanges(before, await stateOf(root))
}

const files = {
  ".gitignore": "build/\n",
  "src/a.ts": "export const a = 1\n",
  "src/b.ts": "export const b = 1\n",
}

describe("treeState", () => {
  test("lists only what git lists as changed or untracked, with HEAD", async () => {
    const root = await createRepo(files)
    const clean = await stateOf(root)
    expect(clean.entries).toEqual({})
    expect(clean.head).toBe(await git(root, "rev-parse", "HEAD"))

    await writeFile(path.join(root, "src/a.ts"), "export const a = 22\n")
    await writeFile(path.join(root, "new.ts"), "x\n")
    const dirty = await stateOf(root)
    expect(Object.keys(dirty.entries).sort()).toEqual(["new.ts", "src/a.ts"])
    expect(dirty.entries["src/a.ts"]![1]).toBe("export const a = 22\n".length)
  })

  test("null outside a git repository", async () => {
    const dir = path.join(tmpdir(), `rulecast-tree-${process.pid}-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    expect(await treeState(dir)).toBeNull()
  })

  test("null HEAD before the first commit", async () => {
    const dir = path.join(tmpdir(), `rulecast-tree-init-${process.pid}-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    await git(dir, "init", "-q")
    await writeFile(path.join(dir, "a.ts"), "a\n")
    const state = await stateOf(dir)
    expect(state.head).toBeNull()
    expect(Object.keys(state.entries)).toEqual(["a.ts"])
  })

  test("a project below the repository's top sees its own paths, relative to itself", async () => {
    const root = await createRepo({ "web/src/a.ts": "a\n", "api/b.py": "b\n" })
    await writeFile(path.join(root, "web/src/a.ts"), "aa\n")
    await writeFile(path.join(root, "api/b.py"), "bb\n")
    const state = await stateOf(path.join(root, "web"))
    expect(Object.keys(state.entries)).toEqual(["src/a.ts"])
  })
})

describe("treeChanges", () => {
  test("an edit to a clean file", async () => {
    const root = await createRepo(files)
    expect(await changedBy(root, () => writeFile(path.join(root, "src/a.ts"), "export const a = 2\n"))).toEqual({
      gitOperation: false,
      files: ["src/a.ts"],
    })
  })

  test("an edit to a file already dirty: same status, new mtime", async () => {
    const root = await createRepo(files)
    await writeFile(path.join(root, "src/a.ts"), "export const a = 2\n")
    // Same size as the first edit, so only the mtime can tell them apart.
    expect(await changedBy(root, () => writeFile(path.join(root, "src/a.ts"), "export const a = 3\n"))).toEqual({
      gitOperation: false,
      files: ["src/a.ts"],
    })
  })

  test("a new untracked file", async () => {
    const root = await createRepo(files)
    expect(await changedBy(root, () => writeFile(path.join(root, "src/c.ts"), "c\n"))).toEqual({
      gitOperation: false,
      files: ["src/c.ts"],
    })
  })

  test("a deleted file", async () => {
    const root = await createRepo(files)
    expect(await changedBy(root, () => rm(path.join(root, "src/b.ts")))).toEqual({
      gitOperation: false,
      files: ["src/b.ts"],
    })
  })

  test("a revert to clean", async () => {
    const root = await createRepo(files)
    await writeFile(path.join(root, "src/a.ts"), "export const a = 2\n")
    expect(await changedBy(root, () => git(root, "checkout", "--", "src/a.ts"))).toEqual({
      gitOperation: false,
      files: ["src/a.ts"],
    })
  })

  test("a commit moves HEAD: a git operation", async () => {
    const root = await createRepo(files)
    await writeFile(path.join(root, "src/a.ts"), "export const a = 2\n")
    expect(
      await changedBy(root, async () => {
        await git(root, "add", "src/a.ts")
        await git(root, "commit", "-q", "-m", "change")
      }),
    ).toEqual({ gitOperation: true })
  })

  test("an ignored file is never listed", async () => {
    const root = await createRepo(files)
    expect(
      await changedBy(root, async () => {
        await mkdir(path.join(root, "build"), { recursive: true })
        await writeFile(path.join(root, "build/out.js"), "x\n")
      }),
    ).toEqual({ gitOperation: false, files: [] })
  })

  test("a rename: both paths", async () => {
    const root = await createRepo(files)
    expect(
      await changedBy(root, async () => {
        await rename(path.join(root, "src/b.ts"), path.join(root, "src/renamed.ts"))
        await git(root, "add", "-A")
      }),
    ).toEqual({ gitOperation: false, files: ["src/b.ts", "src/renamed.ts"] })
  })

  test("nothing changed", async () => {
    const root = await createRepo(files)
    await writeFile(path.join(root, "src/a.ts"), "export const a = 2\n")
    expect(await changedBy(root, async () => {})).toEqual({ gitOperation: false, files: [] })
  })
})
