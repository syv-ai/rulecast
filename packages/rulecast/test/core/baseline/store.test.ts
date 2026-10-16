import { describe, expect, test } from "vitest"

import { snapshotOf } from "../../../src/core/baseline/hash"
import {
  appendBaseline,
  containerRecord,
  readBaseline,
  snapshotRecord,
  startRecord,
} from "../../../src/core/baseline/store"
import { createProject } from "../../helpers/project"

describe("baseline store", () => {
  test("an empty session has no start commit and no snapshots", async () => {
    const dir = await createProject({})
    expect(await readBaseline(dir)).toEqual({
      started: false,
      startCommit: null,
      snapshots: new Map(),
      containers: new Map(),
    })
  })

  test("round-trips snapshots and keeps the first start record and first snapshot per file", async () => {
    const dir = await createProject({})
    const first = snapshotOf("a\nb\n")
    const later = snapshotOf("changed\n")
    await appendBaseline(dir, [startRecord("abc123"), snapshotRecord("src/a.ts", first)])
    await appendBaseline(dir, [startRecord("def456"), snapshotRecord("src/a.ts", later)])
    const state = await readBaseline(dir)
    expect(state.started).toBe(true)
    expect(state.startCommit).toBe("abc123")
    const snapshot = state.snapshots.get("src/a.ts")!
    expect(snapshot.fileHash).toBe(first.fileHash)
    expect([...snapshot.lines]).toEqual([...first.lines])
  })

  test("round-trips containers, first writer wins per file and rule", async () => {
    const dir = await createProject({})
    await appendBaseline(dir, [
      containerRecord("src/routes.py", "slim-routes", [
        [10, 40],
        [60, 95],
      ]),
      containerRecord("src/routes.py", "docstrings", []),
    ])
    await appendBaseline(dir, [containerRecord("src/routes.py", "slim-routes", [[1, 2]])])
    const state = await readBaseline(dir)
    expect(state.containers.get("src/routes.py")!.get("slim-routes")).toEqual([
      [10, 40],
      [60, 95],
    ])
    // Measured and clean is not the same as never measured: an empty record is a record.
    expect(state.containers.get("src/routes.py")!.get("docstrings")).toEqual([])
    expect(state.containers.get("src/routes.py")!.has("lifecycle")).toBe(false)
  })

  test("a store written before containers existed still reads", async () => {
    const dir = await createProject({})
    await appendBaseline(dir, [startRecord("abc123"), snapshotRecord("src/a.ts", snapshotOf("a\n"))])
    const state = await readBaseline(dir)
    expect(state.containers).toEqual(new Map())
    expect(state.snapshots.has("src/a.ts")).toBe(true)
  })

  test("a session started outside git records a null commit", async () => {
    const dir = await createProject({})
    await appendBaseline(dir, [startRecord(null)])
    expect(await readBaseline(dir)).toMatchObject({ started: true, startCommit: null })
  })
})
