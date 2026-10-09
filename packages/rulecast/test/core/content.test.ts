import { writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"

import { computeChanges } from "../../src/core/baseline/baseline"
import { snapshotOf } from "../../src/core/baseline/hash"
import { contentReader } from "../../src/core/content"
import { headCommit } from "../../src/core/git"
import { createRepo, git } from "../helpers/git"

/** One file whose committed, staged and working-tree content all differ. */
async function threeVersions(): Promise<string> {
  const root = await createRepo({ "a.py": "committed\n" })
  await writeFile(path.join(root, "a.py"), "staged\n")
  await git(root, "add", "a.py")
  await writeFile(path.join(root, "a.py"), "worktree\n")
  return root
}

test("each source reads its own version of the file", async () => {
  const root = await threeVersions()
  expect(await contentReader(root, { kind: "worktree" })("a.py")).toBe("worktree\n")
  expect(await contentReader(root, { kind: "index" })("a.py")).toBe("staged\n")
  expect(await contentReader(root, { kind: "commit", ref: "HEAD" })("a.py")).toBe("committed\n")
})

test("a file absent from the source reads as null", async () => {
  const root = await createRepo({ "a.py": "x\n" })
  await writeFile(path.join(root, "untracked.py"), "y\n")
  expect(await contentReader(root, { kind: "index" })("untracked.py")).toBeNull()
  expect(await contentReader(root, { kind: "commit", ref: "HEAD" })("untracked.py")).toBeNull()
  expect(await contentReader(root, { kind: "worktree" })("missing.py")).toBeNull()
})

test("computeChanges diffs the content it is given against the baseline", async () => {
  const root = await createRepo({ "a.py": "one\ntwo\nthree\n" })
  await writeFile(path.join(root, "a.py"), "one\nTWO\nthree\n")
  await git(root, "add", "a.py")
  // The working tree changes a different line; the index reader must not see it.
  await writeFile(path.join(root, "a.py"), "ONE\nTWO\nthree\n")
  const commit = await headCommit(root)
  const index = contentReader(root, { kind: "index" })
  const changes = await computeChanges(root, ["a.py"], { snapshots: new Map(), fallbackCommit: commit }, index)
  expect(changes.sets.get("a.py")).toEqual({ changedLines: [[2, 2]] })
  // And the default is still the working tree.
  const worktree = await computeChanges(root, ["a.py"], {
    snapshots: new Map([["a.py", snapshotOf("one\ntwo\nthree\n")]]),
    fallbackCommit: null,
  })
  expect(worktree.sets.get("a.py")).toEqual({ changedLines: [[1, 2]] })
})
