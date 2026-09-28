import { describe, expect, test } from "vitest"

import type { BaselineChanges } from "../../../src/core/baseline/baseline"
import { diffLines, identityMap } from "../../../src/core/baseline/changes"
import { classify, type Fingerprints, mapRange } from "../../../src/core/baseline/fingerprint"
import { hashLines } from "../../../src/core/baseline/hash"
import type { Match } from "../../../src/core/types"

const FILE = "app/api/routes/users.py"

const at = (line: number, endLine = line): Match => ({
  file: FILE,
  line,
  endLine,
  column: 1,
  text: "",
  captures: {},
})

/** A file whose baseline and current content are given as line arrays. */
function edit(before: string[], after: string[]): BaselineChanges {
  const diff = diffLines(hashLines(before.join("\n")), hashLines(after.join("\n")))
  return {
    sets: new Map([[FILE, { changedLines: diff.changed }]]),
    maps: new Map([[FILE, diff.map]]),
    fromCommit: new Map(),
  }
}

/** Nothing about the file changed. */
function untouched(lines: number): BaselineChanges {
  return {
    sets: new Map([[FILE, { changedLines: [] }]]),
    maps: new Map([[FILE, identityMap(lines)]]),
    fromCommit: new Map(),
  }
}

const recorded = (...ranges: [number, number][]): Fingerprints => new Map([[FILE, new Map([["slim-routes", ranges]])]])

const none: Fingerprints = new Map()

const container = (match: Match, changes: BaselineChanges, fingerprints: Fingerprints) =>
  classify(match, "container", "slim-routes", changes, fingerprints)

const body = (n: number) => Array.from({ length: n }, (_, index) => `    step_${index}()`)

describe("mapRange", () => {
  test("an untouched range keeps its lines", () => {
    expect(mapRange(identityMap(50), [10, 40])).toEqual([10, 40])
  })

  test("an insertion above shifts the whole range down", () => {
    const { map } = diffLines(hashLines(["a", "b", "c"].join("\n")), hashLines(["x", "a", "b", "c"].join("\n")))
    expect(mapRange(map, [1, 3])).toEqual([2, 4])
  })

  test("a range with lines removed from inside keeps the part that survived", () => {
    const { map } = diffLines(hashLines(["a", "b", "c", "d"].join("\n")), hashLines(["a", "d"].join("\n")))
    expect(mapRange(map, [1, 4])).toEqual([1, 2])
  })

  test("a range whose every line is gone maps to nothing", () => {
    const { map } = diffLines(hashLines(["a", "b", "c"].join("\n")), hashLines(["x", "y", "z"].join("\n")))
    expect(mapRange(map, [1, 3])).toBeNull()
  })
})

describe("classify: instance scope is unchanged", () => {
  const changes = edit(["a", "b", "c"], ["a", "CHANGED", "c"])

  test("a match on a changed line is new, one on an unchanged line is not", () => {
    expect(classify(at(2), "instance", "slim-routes", changes, none)).toBe("new")
    expect(classify(at(3), "instance", "slim-routes", changes, none)).toBe("preexisting")
  })

  test("fingerprints are ignored entirely", () => {
    expect(classify(at(2), "instance", "slim-routes", changes, recorded([1, 3]))).toBe("new")
  })
})

describe("classify: container scope", () => {
  test("an edit inside a route that already violated is pre-existing", () => {
    // The route spans lines 1–30 before and 1–31 after: one line added inside it.
    const before = ["def list_users():", ...body(29)]
    const after = ["def list_users():", "    if flag:", ...body(29)]
    expect(container(at(1, 31), edit(before, after), recorded([1, 30]))).toBe("preexisting")
  })

  test("an edit that pushes a compliant route over is new", () => {
    const before = ["def list_users():", ...body(5)]
    const after = ["def list_users():", ...body(40)]
    // The rule was measured against the baseline and found nothing: the record is empty.
    expect(container(at(1, 41), edit(before, after), recorded())).toBe("new")
  })

  test("a second violation inside an already-violating container is pre-existing", () => {
    // The known recall cost of the container comparison (R 0.15 against 0.26 for changed lines
    // only). Asserted so it is a decision rather than a regression somebody quietly fixes.
    const before = ["def list_users():", ...body(29)]
    const after = ["def list_users():", "    crud.fetch()", ...body(29)]
    expect(container(at(1, 31), edit(before, after), recorded([1, 30]))).toBe("preexisting")
  })

  test("a container added below an existing one is new", () => {
    const before = ["def a():", ...body(29)]
    const after = [...before, "def b():", ...body(29)]
    const changes = edit(before, after)
    expect(container(at(1, 30), changes, recorded([1, 30]))).toBe("preexisting")
    expect(container(at(31, 60), changes, recorded([1, 30]))).toBe("new")
  })

  test("an insertion above a violating container follows it down", () => {
    const before = ["def a():", ...body(29)]
    const after = ["import os", "", ...before]
    expect(container(at(3, 32), edit(before, after), recorded([1, 30]))).toBe("preexisting")
  })

  test("a container replaced line for line is new, not inherited", () => {
    const before = ["def a():", ...body(4)]
    const after = ["def b():", "    other_1()", "    other_2()", "    other_3()", "    other_4()"]
    expect(container(at(1, 5), edit(before, after), recorded([1, 5]))).toBe("new")
  })

  test("an empty record makes every match new", () => {
    expect(container(at(1, 30), edit(["a"], ["a", "b"]), recorded())).toBe("new")
  })

  test("no record at all falls back to instance classification", () => {
    const before = ["def a():", ...body(29)]
    const after = ["def a():", "    if flag:", ...body(29)]
    // Instance would call this new: the match spans the changed line.
    expect(container(at(1, 31), edit(before, after), none)).toBe("new")
    // …and pre-existing where the match is nowhere near the edit.
    expect(container(at(40, 60), edit(before, after), none)).toBe("preexisting")
  })

  test("a file with no baseline at all makes every match new", () => {
    const empty: BaselineChanges = { sets: new Map(), maps: new Map(), fromCommit: new Map() }
    expect(container(at(1, 30), empty, none)).toBe("new")
    expect(container(at(1, 30), empty, recorded([1, 30]))).toBe("new")
  })

  test("an untouched file keeps its violations pre-existing", () => {
    expect(container(at(1, 30), untouched(60), recorded([1, 30]))).toBe("preexisting")
  })
})
