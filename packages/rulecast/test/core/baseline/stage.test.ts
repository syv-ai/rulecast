import { describe, expect, test } from "vitest"

import { snapshotOf } from "../../../src/core/baseline/hash"
import { type BaselineInput, changesFor, touchRecords } from "../../../src/core/baseline/stage"
import { type BaselineState, containerRecord, mergeContainers } from "../../../src/core/baseline/store"
import { memoryCache } from "../../../src/core/detection/cache"
import { createRegistry } from "../../../src/core/detection/registry"
import { headCommit } from "../../../src/core/git"
import { defaultDetectorSettings } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { createRepo } from "../../helpers/git"
import { createProject } from "../../helpers/project"
import { rule } from "../../helpers/rules"

/**
 * The baseline stage is behaviour-preserving: the pipeline's own tests are its real coverage. What
 * these pin are the two properties the move had to keep and nothing else would notice losing —
 * records come back in append order, snapshots first, and the stage never changes the state it was
 * handed.
 */

const container = rule({
  id: "no-todo",
  files: "\\.py$",
  scope: "container",
  stages: ["edit"],
  detector: { kind: "regex", config: { pattern: "TODO", flags: "" }, captures: [] },
  message: "m",
})

const onVerify = rule({ ...container, stages: ["edit", "verify"] })

const input = (root: string): BaselineInput => ({
  root,
  detection: {
    root,
    registry: createRegistry([...builtinDetectors]),
    settings: defaultDetectorSettings(),
    cacheFor: () => memoryCache(),
    contextFor: async () => [],
  },
  rules: [container],
  disabled: new Set(),
  limits: { editDeadlineMs: 5_000, verifyMs: 5_000, maxFileBytes: 1024 * 1024 },
})

const emptyState = (): BaselineState => ({
  started: true,
  startCommit: null,
  snapshots: new Map(),
  containers: new Map(),
})

describe("touchRecords", () => {
  test("every snapshot comes before any container record, because they are appended in one write", async () => {
    const root = await createProject({ "a.py": "x = 1  # TODO\n", "b.py": "y = 2\n" })
    const records = await touchRecords(input(root), emptyState(), ["a.py", "b.py"])
    const kinds = records.map((record) => record.t)
    expect(kinds).toEqual(["snapshot", "snapshot", "container", "container"])
    // An empty record is a measurement too: b.py was clean, so a later match there is new.
    expect(records.filter((record) => record.t === "container")).toEqual([
      containerRecord("a.py", "no-todo", [[1, 1]]),
      containerRecord("b.py", "no-todo", []),
    ])
  })

  test("a file already snapshotted is neither snapshotted nor measured again", async () => {
    const root = await createProject({ "a.py": "x = 1\n" })
    const state = emptyState()
    state.snapshots.set("a.py", snapshotOf("x = 1\n"))
    expect(await touchRecords(input(root), state, ["a.py"])).toEqual([])
  })

  test("a file that is not there leaves no record", async () => {
    const root = await createProject({})
    expect(await touchRecords(input(root), emptyState(), ["gone.py"])).toEqual([])
  })
})

describe("changesFor", () => {
  test("measures nothing on an edit", async () => {
    const root = await createProject({ "a.py": "x = 1\ny = 2\n" })
    const state = emptyState()
    state.snapshots.set("a.py", snapshotOf("x = 1\n"))
    state.containers.set("a.py", new Map([["no-todo", []]]))

    const result = await changesFor(input(root), { kind: "edit" }, state, ["a.py"])
    expect(result.records).toEqual([])
    expect(result.changes.sets.get("a.py")?.changedLines).toEqual([[2, 2]])
    expect(result.containers.get("a.py")?.get("no-todo")).toEqual([])
  })

  test("a verify measures a commit baseline's missing containers into a copy, not into the state it was handed", async () => {
    // The pipeline used to merge straight into the session's BaselineState. The stage hands back a
    // merged copy, so a caller holding the state sees exactly what it read.
    const root = await createRepo({ "a.py": "x = 1  # TODO\n" })
    const state = emptyState()
    state.startCommit = await headCommit(root)
    const before = structuredClone(state)

    // A verify fills in verify-stage rules; the shared fixture rule is edit-only.
    const result = await changesFor({ ...input(root), rules: [onVerify] }, { kind: "verify" }, state, ["a.py"])
    expect(result.records).toEqual([containerRecord("a.py", "no-todo", [[1, 1]])])
    expect(result.containers.get("a.py")?.get("no-todo")).toEqual([[1, 1]])
    expect(state).toEqual(before)
  })

  test("a session verify drops a file that is back at its snapshot", async () => {
    const root = await createProject({ "a.py": "x = 1\n", "b.py": "changed\n" })
    const state = emptyState()
    state.snapshots.set("a.py", snapshotOf("x = 1\n"))
    state.snapshots.set("b.py", snapshotOf("original\n"))
    const result = await changesFor(input(root), { kind: "verify" }, state, ["a.py", "b.py"])
    expect(result.files).toEqual(["b.py"])
  })

  test("without a session nothing is dropped and there is no baseline to compare to", async () => {
    const root = await createProject({ "a.py": "x = 1\n" })
    const result = await changesFor(input(root), { kind: "verify" }, null, ["a.py"])
    expect(result.files).toEqual(["a.py"])
    expect(result.changes.sets.size).toBe(0)
  })
})

describe("mergeContainers", () => {
  test("the first record for a file and rule wins, as the store's lock-free appends require", () => {
    const merged = mergeContainers(new Map(), [
      containerRecord("a.py", "r", [[1, 2]]),
      containerRecord("a.py", "r", [[5, 9]]),
      containerRecord("a.py", "other", []),
    ])
    expect(merged.get("a.py")?.get("r")).toEqual([[1, 2]])
    // Present and empty is a measurement — "clean" — and must not read as absent.
    expect(merged.get("a.py")?.has("other")).toBe(true)
    expect(merged.get("a.py")?.get("other")).toEqual([])
  })

  test("leaves what was already there alone", () => {
    const into: BaselineState["containers"] = new Map([["a.py", new Map([["r", [[1, 1]]]])]])
    mergeContainers(into, [containerRecord("a.py", "r", [[7, 7]])])
    expect(into.get("a.py")?.get("r")).toEqual([[1, 1]])
  })
})
