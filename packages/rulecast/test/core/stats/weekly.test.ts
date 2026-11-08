import { describe, expect, test } from "vitest"

import { derive } from "../../../src/core/stats/derive"
import type { FindingsRecord } from "../../../src/core/stats/log"
import { addWeeks, RECUR_LIST, type WeekRow, weeklyTrend, weekOf, weekRows } from "../../../src/core/stats/weekly"

const RULE = "backend/no-httpexception"
const FILE = "app/services/users.py"

function record(
  at: string,
  options: { s?: string; ev?: FindingsRecord["ev"]; ran?: string[]; found?: string[]; file?: string } = {},
): FindingsRecord {
  const ev = options.ev ?? "edit"
  const ran = options.ran ?? (ev === "guard" ? [] : [RULE])
  const file = options.file ?? FILE
  return {
    v: 1,
    at,
    s: options.s ?? "s1",
    a: "main",
    ev,
    files: [file],
    ran: Object.fromEntries((ev === "guard" ? [RULE] : ran).map((rule) => [rule, ev === "guard" ? [] : [0]])),
    found: (options.found ?? []).map((id) => ({ r: RULE, id, f: file, l: 3, o: "delivered" as const })),
    ign: [],
  }
}

const row = (week: string, counts: Partial<WeekRow> = {}): WeekRow => ({
  week,
  rule: RULE,
  runs: 0,
  sessions: 1,
  fired: 0,
  files: {},
  first: `${week}T00:00:00.000Z`,
  ...counts,
})

const window = (last: string | null, since: string | null = null) => ({ since, last, rolledUpTo: null })

describe("weekOf", () => {
  test("weekOf is the Monday, UTC", () => {
    expect(weekOf("2026-10-04T23:59:59.999Z")).toBe("2026-09-28")
    expect(weekOf("2026-10-05T00:00:00.000Z")).toBe("2026-10-05")
    expect(weekOf("2026-10-05T01:00:00+02:00")).toBe("2026-09-28")
    expect(addWeeks("2026-09-28", -26)).toBe("2026-03-30")
  })
})

describe("weekRows", () => {
  test("weekRows counts runs and sessions per week from rulesRun, and fired from lives", () => {
    const records = [
      record("2026-10-01T10:00:00.000Z", { found: ["a"] }),
      record("2026-10-01T10:01:00.000Z"), // fixes a
      record("2026-10-01T10:02:00.000Z", { found: ["a"] }), // a again: a second life
      record("2026-10-01T10:03:00.000Z", { ev: "guard", found: ["g"] }),
      record("2026-10-02T10:00:00.000Z", { s: "s2" }),
      record("2026-10-06T10:00:00.000Z", { s: "s2", found: ["b"] }),
    ]
    const lives = derive(records)
    const rows = weekRows(records, lives, null)
    expect(rows).toEqual([
      {
        week: "2026-09-28",
        rule: RULE,
        runs: 4,
        sessions: 2,
        fired: lives.filter((life) => weekOf(life.firstAt) === "2026-09-28").length,
        files: { [FILE]: 1 },
        first: "2026-10-01T10:00:00.000Z",
      },
      {
        week: "2026-10-05",
        rule: RULE,
        runs: 1,
        sessions: 1,
        fired: 1,
        files: { [FILE]: 1 },
        first: "2026-10-06T10:00:00.000Z",
      },
    ])
    // a twice and the guard's g: the guard ran nothing, but its finding is a life.
    expect(rows[0]!.fired).toBe(3)
  })

  test("weekRows leaves out records and lives at or before after", () => {
    const records = [
      record("2026-10-01T10:00:00.000Z", { found: ["a"] }),
      record("2026-10-01T11:00:00.000Z", { found: ["a", "b"] }),
    ]
    const rows = weekRows(records, derive(records), "2026-10-01T10:00:00.000Z")
    expect(rows).toEqual([
      {
        week: "2026-09-28",
        rule: RULE,
        runs: 1,
        sessions: 1,
        fired: 1,
        files: { [FILE]: 1 },
        first: "2026-10-01T11:00:00.000Z",
      },
    ])
  })
})

describe("weeklyTrend", () => {
  test("weeklyTrend: the rate, its floor and the weeks between", () => {
    const trend = weeklyTrend(
      [
        row("2026-09-28", { runs: 40, fired: 3 }),
        row("2026-10-12", { runs: 19, fired: 1 }),
        row("2026-10-12", { rule: "other", runs: 25 }),
      ],
      window("2026-10-14T00:00:00.000Z"),
    )
    expect(trend.rules.map((rule) => rule.rule)).toEqual([RULE])
    expect(trend.rules[0]!.weeks).toEqual([
      { week: "2026-09-28", runs: 40, sessions: 1, fired: 3, firedPer100Runs: 7.5, partial: false },
      { week: "2026-10-05", runs: 0, sessions: 0, fired: 0, firedPer100Runs: null, partial: false },
      { week: "2026-10-12", runs: 19, sessions: 1, fired: 1, firedPer100Runs: null, partial: true },
    ])
  })

  test("weeklyTrend sums rows of the same week and rule", () => {
    const trend = weeklyTrend(
      [
        row("2026-10-05", { runs: 10, sessions: 2, fired: 2, files: { a: 1, b: 2 } }),
        row("2026-10-05", { runs: 15, sessions: 1, fired: 1, files: { a: 2 } }),
      ],
      window("2026-10-11T00:00:00.000Z"),
    )
    expect(trend.rules[0]!.weeks).toEqual([
      { week: "2026-10-05", runs: 25, sessions: 3, fired: 3, firedPer100Runs: 12, partial: true },
    ])
    expect(trend.rules[0]!.recurringFiles).toEqual([{ file: "a", sessions: 3 }])
  })

  test("enoughFindings at 10, recurring files at 3 sessions, at most 10 listed", () => {
    const last = "2026-10-11T00:00:00.000Z"
    expect(weeklyTrend([row("2026-10-05", { fired: 9 })], window(last)).rules[0]!.enoughFindings).toBe(false)
    expect(weeklyTrend([row("2026-10-05", { fired: 10 })], window(last)).rules[0]!.enoughFindings).toBe(true)

    const files = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`f${String(n).padStart(2, "0")}.py`, 3]))
    const trend = weeklyTrend([row("2026-10-05", { fired: 12, files: { ...files, two: 2 } })], window(last))
    expect(trend.rules[0]!.recurringFiles).toHaveLength(RECUR_LIST)
    expect(trend.rules[0]!.recurringFiles[0]).toEqual({ file: "f00.py", sessions: 3 })
    expect(trend.rules[0]!.recurringFiles.some((file) => file.file === "two")).toBe(false)
    expect(trend.rules[0]!.recurringFileCount).toBe(12)
  })

  test("since keeps whole weeks, and partial marks the edges", () => {
    const rows = [
      row("2026-09-28", { fired: 1, first: "2026-09-29T00:00:00.000Z" }),
      row("2026-10-05", { fired: 1, first: "2026-10-05T09:00:00.000Z" }),
      row("2026-10-12", { fired: 1, first: "2026-10-12T00:00:00.000Z" }),
    ]
    const since = weeklyTrend(rows, window("2026-10-25T23:00:00.000Z", "2026-10-07T00:00:00.000Z"))
    expect(since.from).toBe("2026-10-05T09:00:00.000Z")
    expect(since.rules[0]!.weeks.map((week) => [week.week, week.partial])).toEqual([
      ["2026-10-05", true],
      ["2026-10-12", false],
      ["2026-10-19", true],
    ])
    const sunday = weeklyTrend([rows[2]!], window("2026-10-18T23:00:00.000Z"))
    expect(sunday.from).toBe("2026-10-12T00:00:00.000Z")
    expect(sunday.rules[0]!.weeks).toMatchObject([{ week: "2026-10-12", partial: true }])
    const lastInstant = weeklyTrend([rows[2]!], window("2026-10-18T23:59:59.999Z"))
    expect(lastInstant.rules[0]!.weeks).toMatchObject([{ week: "2026-10-12", partial: true }])
  })

  test("no rows: no trend", () => {
    expect(weeklyTrend([], window(null))).toEqual({ from: null, rolledUpTo: null, rules: [] })
  })
})
