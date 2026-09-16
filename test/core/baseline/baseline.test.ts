import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { computeChanges, isNew } from "../../../src/core/baseline/baseline"
import { headCommit } from "../../../src/core/baseline/git"
import { snapshotOf } from "../../../src/core/baseline/hash"
import type { Match } from "../../../src/core/types"
import { createRepo } from "../../helpers/git"
import { createProject } from "../../helpers/project"

const at = (file: string, line: number, endLine = line): Match => ({ file, line, endLine, column: 1, text: "", captures: {} })

describe("computeChanges", () => {
  test("uses snapshots first", async () => {
    const root = await createProject({ "a.ts": "one\nTWO\nthree\n", "same.ts": "x\n" })
    const snapshots = new Map([
      ["a.ts", snapshotOf("one\ntwo\nthree\n")],
      ["same.ts", snapshotOf("x\n")],
    ])
    const changes = await computeChanges(root, ["a.ts", "same.ts"], { snapshots, fallbackCommit: null })
    expect(changes).toEqual(
      new Map([
        ["a.ts", { changedLines: [[2, 2]] }],
        ["same.ts", { changedLines: [] }],
      ]),
    )
  })

  test("falls back to the commit, and has no baseline for files absent there", async () => {
    const root = await createRepo({ "a.ts": "one\ntwo\n" })
    const commit = await headCommit(root)
    await writeFile(path.join(root, "a.ts"), "one\ntwo\nthree\n")
    await writeFile(path.join(root, "new.ts"), "fresh\n")
    const changes = await computeChanges(root, ["a.ts", "new.ts"], { snapshots: new Map(), fallbackCommit: commit })
    expect(changes).toEqual(new Map([["a.ts", { changedLines: [[3, 3]] }]]))
  })

  test("skips deleted files and has no baseline without snapshot or commit", async () => {
    const root = await createProject({ "a.ts": "x\n", "gone.ts": "y\n" })
    await rm(path.join(root, "gone.ts"))
    const changes = await computeChanges(root, ["a.ts", "gone.ts"], {
      snapshots: new Map([["gone.ts", snapshotOf("y\n")]]),
      fallbackCommit: null,
    })
    expect(changes).toEqual(new Map())
  })
})

describe("isNew", () => {
  const changes = new Map([
    ["a.ts", { changedLines: [[5, 7]] as [number, number][] }],
    ["same.ts", { changedLines: [] as [number, number][] }],
  ])

  test("a finding touching a changed line is new", () => {
    expect(isNew(at("a.ts", 6), changes)).toBe(true)
    expect(isNew(at("a.ts", 1, 5), changes)).toBe(true)
    expect(isNew(at("a.ts", 7, 9), changes)).toBe(true)
  })

  test("a finding on unchanged lines is pre-existing", () => {
    expect(isNew(at("a.ts", 4), changes)).toBe(false)
    expect(isNew(at("a.ts", 8, 9), changes)).toBe(false)
    expect(isNew(at("same.ts", 1), changes)).toBe(false)
  })

  test("a file without a baseline makes every finding new", () => {
    expect(isNew(at("other.ts", 1), changes)).toBe(true)
  })
})
