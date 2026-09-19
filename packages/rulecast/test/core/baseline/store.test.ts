import { describe, expect, test } from "vitest"

import { snapshotOf } from "../../../src/core/baseline/hash"
import { appendBaseline, readBaseline, snapshotRecord, startRecord } from "../../../src/core/baseline/store"
import { createProject } from "../../helpers/project"

describe("baseline store", () => {
  test("an empty session has no start commit and no snapshots", async () => {
    const dir = await createProject({})
    expect(await readBaseline(dir)).toEqual({ started: false, startCommit: null, snapshots: new Map() })
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

  test("a session started outside git records a null commit", async () => {
    const dir = await createProject({})
    await appendBaseline(dir, [startRecord(null)])
    expect(await readBaseline(dir)).toMatchObject({ started: true, startCommit: null })
  })
})
