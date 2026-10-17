import { describe, expect, test } from "vitest"

import { type ActivityRecord, appendActivity, duringCall, readActivity } from "../../../src/core/session/activity"
import { createProject } from "../../helpers/project"

const self = { session: "s1", agent: "main", toolUseId: "t1" }
const started = (at: number, s = "s1", a = "main", tu = "t1"): ActivityRecord => ({ at, s, a, ev: "shell-before", tu })
const ended = (at: number, s = "s1", a = "main", tu = "t1"): ActivityRecord => ({ at, s, a, ev: "shell-after", tu })
const edit = (at: number, f: string[], s = "s2", a = "main"): ActivityRecord => ({ at, s, a, ev: "edit", f })

describe("duringCall", () => {
  test("another agent's edits from the call's start on are theirs; earlier ones are not counted", () => {
    const records = [edit(5, ["old.py"]), started(10), edit(12, ["a.py"]), edit(13, ["b.py"], "s1", "sub1")]
    expect(duringCall(records, self, 20)).toEqual({ edits: new Set(["a.py", "b.py"]), sharedShell: false })
  })

  test("the agent's own edits are never another's", () => {
    expect(duringCall([started(10), edit(12, ["a.py"], "s1", "main")], self, 20).edits).toEqual(new Set())
  })

  test("a shell call that started during this one, or was still running when it started, ran alongside", () => {
    expect(duringCall([started(10), started(12, "s2", "main", "x")], self, 20).sharedShell).toBe(true)
    expect(duringCall([started(5, "s2", "main", "x"), started(10)], self, 20).sharedShell).toBe(true)
  })

  test("a shell call that ended before this one started did not", () => {
    const records = [started(5, "s2", "main", "x"), ended(8, "s2", "main", "x"), started(10)]
    expect(duringCall(records, self, 20).sharedShell).toBe(false)
  })

  test("a call whose after hook never came stops counting after ten minutes", () => {
    const records = [started(0, "s2", "main", "x"), started(11 * 60_000)]
    expect(duringCall(records, self, 11 * 60_000 + 1).sharedShell).toBe(false)
  })

  test("with no record of this call's start there is nothing to tell apart", () => {
    expect(duringCall([edit(12, ["a.py"])], self, 20)).toEqual({ edits: new Set(), sharedShell: false })
  })
})

test("the log round-trips", async () => {
  const dir = await createProject({})
  await appendActivity(dir, started(1))
  await appendActivity(dir, edit(2, ["a.py"]))
  expect(await readActivity(dir)).toEqual([started(1), edit(2, ["a.py"])])
})
