import { expect, test } from "vitest"

import type { FindingsRecord } from "../../../src/core/stats/log"
import { ruleRuns, stopBlocks } from "../../../src/core/stats/runs"

const stop = (files: number, blocked: boolean, ev: FindingsRecord["ev"] = "stop"): FindingsRecord => ({
  v: 1,
  at: "2026-10-01T10:00:00.000Z",
  s: "s1",
  a: "main",
  ev,
  files: Array.from({ length: files }, (_, n) => `f${n}.py`),
  ran: { r: Array.from({ length: files }, (_, n) => n), quiet: [0] },
  found: blocked ? [{ r: "r", id: "x", f: "f0.py", l: 1, o: "blocked" }] : [],
  ign: [],
})

test("stops are bucketed by the files the rule judged, and only rules that blocked are listed", () => {
  const records = [
    stop(1, false),
    stop(1, false),
    stop(3, true),
    stop(12, true),
    stop(12, false),
    stop(12, true, "edit"),
  ]
  expect(stopBlocks(records)).toEqual([
    {
      rule: "r",
      byFiles: [
        { files: "1", stops: 2, blocked: 0 },
        { files: "2-5", stops: 1, blocked: 1 },
        { files: "6+", stops: 2, blocked: 1 },
      ],
    },
  ])
})

test("a guard's empty run is not a run", () => {
  const guard: FindingsRecord = { ...stop(1, false, "guard"), ran: { r: [] } }
  expect(ruleRuns([stop(1, false, "edit"), guard])).toEqual(
    new Map([
      ["r", 1],
      ["quiet", 1],
    ]),
  )
})
