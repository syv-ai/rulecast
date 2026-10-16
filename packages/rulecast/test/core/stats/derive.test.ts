import { describe, expect, test } from "vitest"
import { findingIds } from "../../../src/core/finding-id"
import {
  derive,
  type FindingLife,
  NOISY_MIN_FIRED,
  NOISY_REPEAT_RATE,
  NOISY_SUPPRESSION_RATE,
  ruleStats,
} from "../../../src/core/stats/derive"
import type { FindingsRecord, WriteOutcome } from "../../../src/core/stats/log"

const RULE = "backend/no-httpexception"
const OTHER = "python/no-print"
const FILE = "app/services/users.py"

let clock = 0

/** One event's record; `ran` defaults to RULE over FILE, `found` to nothing. */
function record(
  ev: FindingsRecord["ev"],
  found: [id: string, outcome: WriteOutcome][] = [],
  options: { s?: string; a?: string; ran?: string[]; ign?: string[]; file?: string; rule?: string } = {},
): FindingsRecord {
  const file = options.file ?? FILE
  const rule = options.rule ?? RULE
  const ran = options.ran ?? (ev === "guard" ? [] : [rule])
  clock += 1000
  return {
    v: 1,
    at: new Date(Date.UTC(2026, 9, 1) + clock).toISOString(),
    s: options.s ?? "s1",
    a: options.a ?? "main",
    ev,
    files: ran.length > 0 ? [file] : [],
    ran: Object.fromEntries(ran.map((id) => [id, [0]])),
    found: found.map(([id, o]) => ({ r: rule, id, f: file, l: 3, o })),
    ign: (options.ign ?? []).map((id) => ({ r: rule, id, f: file, l: 3 })),
  }
}

const only = (lives: FindingLife[]) => {
  expect(lives).toHaveLength(1)
  return lives[0]!
}

describe("derive", () => {
  test("delivered at an edit, gone at the next check of its rule and file: fixed in the same turn", () => {
    const life = only(derive([record("edit", [["a", "delivered"]]), record("edit")]))
    expect(life).toMatchObject({ state: "fixed", turnsToFix: 0, deliveries: 1, blocks: 0 })
  })

  test("blocked at a stop, then fixed at an edit after it: one turn", () => {
    const life = only(
      derive([
        record("edit", [["a", "delivered"]]),
        record("stop", [["a", "blocked"]]),
        record("edit"),
        record("stop"),
      ]),
    )
    expect(life).toMatchObject({ state: "fixed", turnsToFix: 1, blocks: 1, stopsPresent: 1 })
  })

  test("gone at the stop itself is fixed in the turn that is ending", () => {
    const life = only(derive([record("edit", [["a", "delivered"]]), record("stop")]))
    expect(life).toMatchObject({ state: "fixed", turnsToFix: 0 })
  })

  test("still there at two stops when the log ends: ignored and repeated", () => {
    const lives = derive([
      record("edit", [["a", "delivered"]]),
      record("stop", [["a", "blocked"]]),
      record("stop", [["a", "delivered"]]),
    ])
    expect(only(lives)).toMatchObject({ state: "ignored", stopsPresent: 2, blocks: 1 })
    expect(ruleStats(lives)[0]).toMatchObject({ fired: 1, ignored: 1, repeated: 1, blocked: 1, fixed: 0 })
  })

  test("a rulecast-ignore added for it: suppressed", () => {
    const life = only(derive([record("edit", [["a", "delivered"]]), record("edit", [], { ign: ["a"] })]))
    expect(life.state).toBe("suppressed")
  })

  test("an inline rulecast-ignore on a whole-line match changes its id, and still reads as suppressed", () => {
    const rule = { id: RULE, detector: { kind: "llm" } }
    const at = { file: FILE, line: 3, endLine: 3, column: 1, captures: {} }
    const idOf = (text: string) => findingIds([{ rule, match: { ...at, text } }], () => [])[0]!
    const before = idOf("    raise HTTPException(404)")
    const after = idOf("    raise HTTPException(404)  # rulecast-ignore: backend/no-httpexception")
    expect(after).not.toBe(before)

    const lives = derive([record("edit", [[before, "delivered"]]), record("edit", [], { ign: [after] })])
    expect(only(lives)).toMatchObject({ id: before, state: "suppressed" })
  })

  test("an ignore on another line, or of another rule, does not suppress it", () => {
    const first = record("edit", [["a", "delivered"]])
    const moved = record("edit", [], { ign: ["z"] })
    moved.ign[0]!.l = 9
    const other = record("edit", [], { ign: ["y"] })
    other.ign[0]!.r = OTHER
    expect(only(derive([first, moved])).state).toBe("fixed")
    expect(only(derive([first, other])).state).toBe("fixed")
  })

  test("a later check where its rule did not run proves nothing", () => {
    const lives = derive([
      record("edit", [["a", "delivered"]]),
      record("edit", [], { ran: [OTHER] }),
      record("edit", [], { ran: [RULE], file: "app/services/orders.py" }),
    ])
    expect(only(lives).state).toBe("open")
  })

  test("refused at the guard, then gone at the edit: fixed, refused once", () => {
    const life = only(derive([record("guard", [["a", "refused"]]), record("edit")]))
    expect(life).toMatchObject({ state: "fixed", turnsToFix: 0, refusals: 1 })
  })

  test("refused, then abandoned: at the agent's next stop it was prevented", () => {
    const lives = derive([
      record("guard", [["a", "refused"]]),
      record("guard", [["a", "refused"]]),
      record("stop", [], { ran: [] }),
    ])
    expect(only(lives)).toMatchObject({ state: "prevented", refusals: 2, turnsToFix: null })
    expect(ruleStats(lives)[0]).toMatchObject({ prevented: 1, open: 0, fixed: 0 })
  })

  test("refused, then written anyway: a stop that finds it keeps it, so it is ignored, not prevented", () => {
    const lives = derive([
      record("guard", [["a", "refused"]]),
      record("edit", [["a", "delivered"]]),
      record("stop", [], { ran: [] }),
    ])
    expect(only(lives).state).toBe("open")
    const kept = derive([record("guard", [["a", "refused"]]), record("stop", [["a", "blocked"]])])
    expect(only(kept).state).toBe("ignored")
  })

  test("another agent's stop does not settle a refusal", () => {
    const lives = derive([record("guard", [["a", "refused"]]), record("stop", [], { a: "sub", ran: [] })])
    expect(only(lives).state).toBe("open")
  })

  test("a guard proves nothing gone: the write it judged has not happened", () => {
    const lives = derive([record("edit", [["a", "delivered"]]), record("guard", [["b", "refused"]])])
    expect(lives.map((life) => [life.id, life.state])).toEqual([
      ["a", "open"],
      ["b", "open"],
    ])
  })

  test("the same id in two sessions is two findings", () => {
    const lives = derive([
      record("edit", [["a", "delivered"]], { s: "s1" }),
      record("edit", [["a", "delivered"]], { s: "s2" }),
      record("edit", [], { s: "s1" }),
    ])
    expect(lives.map((life) => [life.session, life.state])).toEqual([
      ["s1", "fixed"],
      ["s2", "open"],
    ])
  })

  test("turns are the finding's own agent's stops", () => {
    const life = only(
      derive([
        record("edit", [["a", "delivered"]]),
        record("stop", [], { a: "sub", ran: [] }),
        record("stop", [], { a: "sub", ran: [] }),
        record("edit"),
      ]),
    )
    expect(life).toMatchObject({ state: "fixed", turnsToFix: 0 })
  })

  test("--since counts only findings first reported after it, but replays what came before", () => {
    const records = [record("edit", [["a", "delivered"]]), record("edit", [["b", "delivered"]]), record("edit")]
    const lives = derive(records, new Date(records[1]!.at))
    expect(lives.map((life) => [life.id, life.state])).toEqual([["b", "fixed"]])
  })

  test("with no stop yet, a finding is open, never ignored", () => {
    const lives = derive([record("edit", [["a", "delivered"]]), record("edit", [["a", "delivered"]])])
    expect(only(lives)).toMatchObject({ state: "open", deliveries: 2 })
    expect(ruleStats(lives)[0]).toMatchObject({ open: 1, ignored: 0 })
  })

  test("fixed again after it came back is a second finding", () => {
    const lives = derive([record("edit", [["a", "delivered"]]), record("edit"), record("edit", [["a", "delivered"]])])
    expect(lives.map((life) => life.state)).toEqual(["fixed", "open"])
  })
})

describe("ruleStats", () => {
  const life = (overrides: Partial<FindingLife>): FindingLife => ({
    session: "s1",
    agent: "main",
    id: "a",
    rule: RULE,
    file: FILE,
    firstAt: "2026-10-01T00:00:00.000Z",
    state: "fixed",
    deliveries: 1,
    stopsPresent: 0,
    blocks: 0,
    refusals: 0,
    suppressAttempts: 0,
    turnsToFix: 0,
    ...overrides,
  })

  test("the median over an even count is the mean of the middle two; none fixed is null", () => {
    const stats = ruleStats([
      life({ turnsToFix: 0 }),
      life({ turnsToFix: 1 }),
      life({ turnsToFix: 2 }),
      life({ turnsToFix: 5 }),
      life({ rule: OTHER, state: "open", turnsToFix: null }),
    ])
    expect(stats.map((rule) => [rule.rule, rule.medianTurnsToFix])).toEqual([
      [RULE, 1.5],
      [OTHER, null],
    ])
  })

  test("noisy at the thresholds, not below them", () => {
    const fired = 10
    const repeatedAt = Math.round(fired * NOISY_REPEAT_RATE)
    const suppressedAt = Math.round(fired * NOISY_SUPPRESSION_RATE)
    const rule = (name: string, repeated: number, suppressed: number) =>
      Array.from({ length: fired }, (_, index) =>
        life({
          rule: name,
          id: String(index),
          stopsPresent: index < repeated ? 2 : 0,
          state: index >= fired - suppressed ? "suppressed" : "fixed",
        }),
      )
    const stats = ruleStats([
      ...rule("at/both", repeatedAt, suppressedAt),
      ...rule("below/both", repeatedAt - 1, suppressedAt - 1),
    ])
    expect(stats.map((entry) => [entry.rule, entry.noisy, entry.repeatRate, entry.suppressionRate])).toEqual([
      ["at/both", ["repeats", "suppressed"], NOISY_REPEAT_RATE, NOISY_SUPPRESSION_RATE],
      ["below/both", [], 0.2, 0.1],
    ])
  })

  test("a rule that has fired too few times is never noisy, whatever its rates", () => {
    const lives = Array.from({ length: NOISY_MIN_FIRED - 1 }, (_, index) =>
      life({ id: String(index), state: "suppressed", stopsPresent: 3 }),
    )
    expect(ruleStats(lives)[0]).toMatchObject({ repeatRate: 1, suppressionRate: 1, noisy: [] })
  })
})
