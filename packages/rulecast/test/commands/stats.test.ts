import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"
import { STATS_SCHEMA_VERSION } from "../../src/adapters/cli/contract"
import { parseSince } from "../../src/commands/stats"
import { FINDINGS_LOG, FINDINGS_LOG_ROTATED, FINDINGS_WEEKLY, type FindingsRecord } from "../../src/core/stats/log"
import type { WeekRow } from "../../src/core/stats/weekly"

import { runCli } from "../helpers/cli"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { stateDirFor } from "../helpers/home"

const RULE = "backend/no-httpexception"
const USERS = "app/services/users.py"

const record = (
  at: string,
  ev: FindingsRecord["ev"],
  found: [id: string, rule: string, o: "delivered" | "blocked"][],
  s = "s1",
): FindingsRecord => ({
  v: 1,
  at,
  s,
  a: "main",
  ev,
  files: [USERS],
  ran: { [RULE]: [0], "old/renamed-rule": [0] },
  found: found.map(([id, r, o]) => ({ r, id, f: USERS, l: 3, o })),
  ign: [],
})

/** Two sessions: one fixes its finding after a block, the other stops with one in place. */
const RECORDS = [
  record("2026-10-01T10:00:00.000Z", "edit", [["a1", RULE, "delivered"]]),
  record("2026-10-01T10:01:00.000Z", "stop", [["a1", RULE, "blocked"]]),
  record("2026-10-01T10:02:00.000Z", "edit", []),
  record("2026-10-01T10:03:00.000Z", "stop", []),
  record("2026-10-05T09:00:00.000Z", "edit", [["b1", "old/renamed-rule", "delivered"]], "s2"),
  record("2026-10-05T09:01:00.000Z", "stop", [["b1", "old/renamed-rule", "delivered"]], "s2"),
]

async function projectWithLog(records: FindingsRecord[]): Promise<string> {
  const root = await createFixture()
  const stateDir = stateDirFor(root)
  await mkdir(stateDir, { recursive: true })
  await writeFile(path.join(stateDir, FINDINGS_LOG), records.map((item) => `${JSON.stringify(item)}\n`).join(""))
  return root
}

/** The weekly summary's mark for a log file: a hash of its first line (core/stats/log.ts). */
const fingerprint = (records: FindingsRecord[]) =>
  createHash("sha256").update(JSON.stringify(records[0])).digest("hex").slice(0, 16)

/** A weekly summary counted from the log file `log` (a fingerprint), whose newest record was at `to`. */
async function withSummary(root: string, to: string, rows: Partial<WeekRow>[], log = "an-older-file"): Promise<void> {
  const lines = rows.map((row) => ({
    v: 1,
    log,
    to,
    rule: RULE,
    runs: 0,
    sessions: 1,
    fired: 0,
    files: {},
    first: `${row.week}T00:00:00.000Z`,
    ...row,
  }))
  await writeFile(
    path.join(stateDirFor(root), FINDINGS_WEEKLY),
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  )
}

const SUMMARY_TO = "2026-09-30T12:00:00.000Z"
const SUMMARY_ROWS = [
  { week: "2026-09-21", runs: 30, fired: 3, first: "2026-09-23T08:00:00.000Z" },
  { week: "2026-09-28", runs: 5, fired: 2 },
]

const weekOfRule = (document: { weekly: { rules: { rule: string; weeks: { week: string }[] }[] } }, rule: string) =>
  document.weekly.rules.find((entry) => entry.rule === rule)?.weeks

describe("rulecast stats", () => {
  test("--format json: the documented shape", async () => {
    const root = await projectWithLog(RECORDS)
    const result = await runCli(root, ["stats", "--format", "json"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: STATS_SCHEMA_VERSION,
      window: {
        since: null,
        firstRecord: "2026-10-01T10:00:00.000Z",
        lastRecord: "2026-10-05T09:01:00.000Z",
        truncated: false,
      },
      sessions: 2,
      rules: [
        {
          rule: RULE,
          fired: 1,
          blocked: 1,
          refused: 0,
          fixed: 1,
          ignored: 0,
          suppressed: 0,
          suppressAttempted: 0,
          prevented: 0,
          open: 0,
          repeated: 0,
          medianTurnsToFix: 1,
          repeatRate: 0,
          suppressionRate: 0,
          noisy: [],
        },
        {
          rule: "old/renamed-rule",
          fired: 1,
          blocked: 0,
          refused: 0,
          fixed: 0,
          ignored: 1,
          suppressed: 0,
          suppressAttempted: 0,
          prevented: 0,
          open: 0,
          repeated: 0,
          medianTurnsToFix: null,
          repeatRate: 0,
          suppressionRate: 0,
          noisy: [],
        },
      ],
      neverFired: ["frontend/no-generated-edits"],
      neverRan: ["frontend/no-generated-edits"],
      runs: { [RULE]: 6, "frontend/no-generated-edits": 0 },
      stopBlocks: [
        {
          rule: RULE,
          byFiles: [
            { files: "1", stops: 3, blocked: 1 },
            { files: "2-5", stops: 0, blocked: 0 },
            { files: "6+", stops: 0, blocked: 0 },
          ],
        },
      ],
      unknownRules: ["old/renamed-rule"],
      weekly: {
        from: "2026-10-01T10:00:00.000Z",
        rolledUpTo: null,
        summary: "off",
        rules: [RULE, "old/renamed-rule"].map((rule) => ({
          rule,
          fired: 1,
          enoughFindings: false,
          weeks: [
            {
              week: "2026-09-28",
              runs: 4,
              sessions: 1,
              fired: rule === RULE ? 1 : 0,
              firedPer100Runs: null,
              partial: true,
            },
            {
              week: "2026-10-05",
              runs: 2,
              sessions: 1,
              fired: rule === RULE ? 0 : 1,
              firedPer100Runs: null,
              partial: true,
            },
          ],
          recurringFiles: [],
          recurringFileCount: 0,
        })),
      },
    })
  })

  test("the terminal table", async () => {
    const root = await projectWithLog(RECORDS)
    const result = await runCli(root, ["stats"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        "2 sessions since 2026-10-01T10:00:00.000Z",
        "",
        "rule                      fired  blocked  refused  fixed  ignored  suppressed  prevented  open  repeated  turns to fix",
        "backend/no-httpexception      1        1        0      1        0           0          0     0         0             1",
        "old/renamed-rule              1        0        0      0        1           0          0     0         0             -",
        "",
        "blocks at stops, by the files a rule checked there:",
        "  backend/no-httpexception  1 file: 1 of 3  ·  2-5 files: -  ·  6+ files: -",
        "",
        "too few findings for a trend (under 10): backend/no-httpexception, old/renamed-rule",
        "the weekly summary is off: the trend covers only the log, from 2026-10-01. stats.weekly_summary: true in .rulecast-config.yaml keeps 26 weeks",
        "",
        "never ran (no file the agents changed matched): frontend/no-generated-edits",
        "",
        "no longer configured: old/renamed-rule",
        "",
      ].join("\n"),
    )
  })

  test("a rule that ran and found nothing is told apart from one that never ran", async () => {
    const quiet = (at: string): FindingsRecord => ({
      ...record(at, "edit", []),
      files: [USERS, "src/client/api.ts"],
      ran: { [RULE]: [0], "frontend/no-generated-edits": [1] },
    })
    const root = await projectWithLog([quiet("2026-10-01T10:00:00.000Z"), quiet("2026-10-01T10:01:00.000Z")])
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.neverRan).toEqual([])
    expect(document.runs).toEqual({ [RULE]: 2, "frontend/no-generated-edits": 2 })
    const terminal = (await runCli(root, ["stats"])).stdout
    expect(terminal).toContain(`ran but never fired: ${RULE} (2 checks), frontend/no-generated-edits (2 checks)`)
  })

  test("--since counts only findings first reported after it", async () => {
    const root = await projectWithLog(RECORDS)
    const document = JSON.parse((await runCli(root, ["stats", "--since", "2026-10-03", "--format", "json"])).stdout)
    expect(document.window.since).toBe("2026-10-03T00:00:00.000Z")
    expect(document.sessions).toBe(1)
    expect(document.rules.map((rule: { rule: string }) => rule.rule)).toEqual(["old/renamed-rule"])
    expect(document.neverFired).toEqual([RULE, "frontend/no-generated-edits"].sort())
  })

  test("a rule repo that did not compile: errors on stderr, and no never-fired or unknown rules", async () => {
    const root = await projectWithLog(RECORDS)
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      stringify({
        repos: [
          { repo: "local", rules: fixtureRules },
          { repo: "https://example.invalid/rules", rev: "v1.0.0", rules: [{ id: "old/renamed-rule" }] },
        ],
      }),
    )
    const result = await runCli(root, ["stats", "--format", "json"])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain("rulecast stats: not compiled: https://example.invalid/rules@v1.0.0")
    const document = JSON.parse(result.stdout)
    expect(document).not.toHaveProperty("neverFired")
    expect(document).not.toHaveProperty("unknownRules")
    expect(document.notCompiled).toEqual([expect.stringContaining("https://example.invalid/rules@v1.0.0")])
    expect(document.rules).toHaveLength(2)

    const terminal = await runCli(root, ["stats"])
    expect(terminal.stdout).not.toContain("never fired")
    expect(terminal.stdout).not.toContain("no longer configured")
    expect(terminal.stdout).toContain("some rules did not compile")
  })

  test("unreadable lines are skipped and counted", async () => {
    const root = await projectWithLog(RECORDS)
    await writeFile(path.join(stateDirFor(root), FINDINGS_LOG), `not json\n${JSON.stringify(RECORDS[0])}\n`)
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.skippedLines).toBe(1)
    expect(document.rules[0]).toMatchObject({ rule: RULE, open: 1 })
  })

  test("with no log yet it says so and exits 0", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["stats"])).toMatchObject({
      code: 0,
      stdout: "no findings recorded yet (the log fills as agent hooks run)\n",
    })
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document).toMatchObject({ sessions: 0, rules: [], window: { firstRecord: null } })
  })

  test("a bad --since or --format is a usage error", async () => {
    const root = await createFixture()
    for (const args of [
      ["--since", "a month"],
      ["--since", "30m"],
      ["--since", "2026-02-30"],
      ["--since", "2026-09-01T10:00"],
      ["--format", "sarif"],
    ]) {
      const result = await runCli(root, ["stats", ...args])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe("")
    }
  })

  test("--since takes days, hours and dates", () => {
    const now = new Date("2026-10-16T12:00:00.000Z")
    expect(parseSince("30d", now).toISOString()).toBe("2026-09-16T12:00:00.000Z")
    expect(parseSince("12h", now).toISOString()).toBe("2026-10-16T00:00:00.000Z")
    expect(parseSince("2026-09-01", now).toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(parseSince("2026-09-01T10:00:00Z", now).toISOString()).toBe("2026-09-01T10:00:00.000Z")
    expect(parseSince("2026-09-01T10:00+02:00", now).toISOString()).toBe("2026-09-01T08:00:00.000Z")
  })

  test("--since rejects a date that does not exist, and a time with no offset", () => {
    const now = new Date("2026-10-16T12:00:00.000Z")
    for (const value of ["2026-02-30", "2026-13-01", "2026-09-01T25:00Z", "2026-09-01T10:00", "2026-09-01x"]) {
      expect(() => parseSince(value, now), value).toThrow(/--since/)
    }
  })

  test("a trend across weeks adds the summary to the live log, which is counted whole whatever its times", async () => {
    // A live record older than the summary's newest: the hook that won a rotation writes its record
    // after the others (the rotation race). It is in no summarised file, so it is counted.
    const before = record("2026-09-30T11:00:00.000Z", "edit", [["z1", RULE, "delivered"]])
    const root = await projectWithLog([before, ...RECORDS])
    await withSummary(root, SUMMARY_TO, SUMMARY_ROWS)
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.weekly.rolledUpTo).toBe(SUMMARY_TO)
    expect(document.weekly.from).toBe("2026-09-23T08:00:00.000Z")
    expect(weekOfRule(document, RULE)).toEqual([
      { week: "2026-09-21", runs: 30, sessions: 1, fired: 3, firedPer100Runs: 10, partial: true },
      { week: "2026-09-28", runs: 10, sessions: 2, fired: 4, firedPer100Runs: null, partial: false },
      { week: "2026-10-05", runs: 2, sessions: 1, fired: 0, firedPer100Runs: null, partial: true },
    ])
    expect(document.rules.find((rule: { rule: string }) => rule.rule === RULE).fired).toBe(2)
  })

  test("a findings.1.jsonl the summary has counted already (a crash before the rename) is not counted twice", async () => {
    const rotated = [record("2026-09-29T10:00:00.000Z", "edit", [["r1", RULE, "delivered"]], "s0")]
    const root = await projectWithLog(RECORDS)
    await writeFile(
      path.join(stateDirFor(root), FINDINGS_LOG_ROTATED),
      rotated.map((item) => `${JSON.stringify(item)}\n`).join(""),
    )
    await withSummary(root, rotated[0]!.at, [{ week: "2026-09-28", runs: 1, fired: 1 }], fingerprint(rotated))
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    // The summary's 1 run, and the current file's 4 in that week; not .1's run a second time.
    expect(weekOfRule(document, RULE)?.[0]).toMatchObject({ week: "2026-09-28", runs: 5, fired: 2 })
    // The table still reads the whole log.
    expect(document.rules.find((rule: { rule: string }) => rule.rule === RULE).fired).toBe(2)
  })

  test("with the summary off but one written while it was on, stats says where the weeks come from", async () => {
    const root = await projectWithLog(RECORDS)
    await withSummary(root, SUMMARY_TO, SUMMARY_ROWS)
    const terminal = (await runCli(root, ["stats"])).stdout
    expect(terminal).toContain(
      "the weekly summary is off: weeks up to 2026-09-30 come from the summary written while it was on, later ones from the log",
    )
    expect(terminal).not.toContain("covers only the log")
  })

  test("with the summary on, stats says nothing about it and reports summary: on", async () => {
    const root = await projectWithLog(RECORDS)
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      stringify({ stats: { weekly_summary: true }, repos: [{ repo: "local", rules: fixtureRules }] }),
    )
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.weekly.summary).toBe("on")
    const terminal = (await runCli(root, ["stats"])).stdout
    expect(terminal).toContain("too few findings for a trend")
    expect(terminal).not.toContain("weekly summary")
  })

  test("with only a summary, stats still shows its weeks", async () => {
    const root = await projectWithLog([])
    await withSummary(root, SUMMARY_TO, SUMMARY_ROWS)
    const terminal = (await runCli(root, ["stats"])).stdout
    expect(terminal).not.toContain("no findings recorded yet")
    expect(terminal).toContain("0 sessions in the log")
    expect(terminal).toContain("too few findings for a trend (under 10): backend/no-httpexception")
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(weekOfRule(document, RULE)?.map((week) => week.week)).toEqual(["2026-09-21", "2026-09-28"])
    expect(document.weekly.rules[0].fired).toBe(5)
  })

  test("--since keeps the trend to whole weeks from its week", async () => {
    const root = await projectWithLog(RECORDS)
    await withSummary(root, SUMMARY_TO, SUMMARY_ROWS)
    const document = JSON.parse((await runCli(root, ["stats", "--since", "2026-10-07", "--format", "json"])).stdout)
    expect(document.weekly.from).toBe("2026-10-05T09:00:00.000Z")
    expect(document.weekly.rules.map((rule: { rule: string }) => rule.rule)).toEqual(["old/renamed-rule"])
    expect(weekOfRule(document, "old/renamed-rule")).toEqual([
      { week: "2026-10-05", runs: 2, sessions: 1, fired: 1, firedPer100Runs: null, partial: true },
    ])
  })

  test("a rule with enough findings gets a row of rates, and recurring files are listed", async () => {
    // 30 checks in each of two weeks; 12 findings in the first, over 3 sessions, all in one file.
    const records: FindingsRecord[] = []
    for (const [week, findings] of [
      ["2026-10-06", true],
      ["2026-10-12", false],
    ] as const) {
      for (let i = 0; i < 30; i++) {
        const at = new Date(Date.parse(`${week}T08:00:00.000Z`) + i * 60_000).toISOString()
        const found: [string, string, "delivered"][] = findings && i % 5 < 2 ? [[`f${i}`, RULE, "delivered"]] : []
        records.push(record(at, "edit", found, `s${(i % 3) + 1}`))
      }
    }
    const root = await projectWithLog(records)
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    const trend = document.weekly.rules[0]
    expect(trend).toMatchObject({ rule: RULE, fired: 12, enoughFindings: true, recurringFileCount: 1 })
    expect(trend.weeks.map((week: { firedPer100Runs: number | null }) => week.firedPer100Runs)).toEqual([40, 0])
    expect(trend.recurringFiles).toEqual([{ file: USERS, sessions: 3 }])

    const terminal = (await runCli(root, ["stats"])).stdout
    expect(terminal).toContain(
      [
        "findings per 100 checks that ran the rule, by week (from Monday, UTC; * partial; - fewer than 20 checks):",
        "  rule                      10-05*  10-12*",
        "  backend/no-httpexception      40       0",
        "fired in the same file in 3 or more sessions:",
        `  ${RULE}: ${USERS} (3 sessions)`,
      ].join("\n"),
    )
  })
})

describe("rulecast stats --worktrees (#71)", () => {
  const writeLog = async (stateDir: string, records: FindingsRecord[], root: string) => {
    await mkdir(stateDir, { recursive: true })
    await writeFile(path.join(stateDir, "root"), `${root}\n`)
    await writeFile(path.join(stateDir, FINDINGS_LOG), records.map((item) => `${JSON.stringify(item)}\n`).join(""))
  }

  test("merges the checkouts a glob picks, removed ones included, keeping one session's checkouts apart", async () => {
    const root = await realpath(await projectWithLog(RECORDS.slice(0, 4)))
    const trees = path.join(root, ".claude", "worktrees")
    const w1 = path.join(trees, "w1")
    execFileSync("git", ["worktree", "add", "-q", "-b", "w1", w1], { cwd: root })
    // The same session, the same finding id and file, in another checkout: left open there.
    await writeLog(stateDirFor(w1), [record("2026-10-01T11:00:00.000Z", "stop", [["a1", RULE, "delivered"]])], w1)
    // A checkout removed since: its log is still in the cache, beside w1.
    const gone = path.join(trees, "w2")
    const goneState = path.join(path.dirname(stateDirFor(root)), "0000000000gone00")
    await writeLog(goneState, [record("2026-10-02T09:00:00.000Z", "edit", [], "s3")], gone)
    const hashed = path.join(
      path.dirname(stateDirFor(root)),
      createHash("sha256").update(gone).digest("hex").slice(0, 16),
    )
    await mkdir(path.dirname(hashed), { recursive: true })
    execFileSync("cp", ["-R", goneState, hashed])

    const all = await runCli(w1, ["stats", "--worktrees", "w*", "--format", "json"])
    const document = JSON.parse(all.stdout)
    expect(
      document.checkouts.map((checkout: { name: string; exists: boolean; records: number }) => [
        checkout.name,
        checkout.exists,
        checkout.records,
      ]),
    ).toEqual([
      ["w1", true, 1],
      ["w2", false, 1],
    ])
    expect(document.sessions).toBe(2)

    const both = JSON.parse((await runCli(root, ["stats", "--worktrees", "*", "--format", "json"])).stdout)
    expect(both.checkouts.map((checkout: { name: string }) => checkout.name)).toContain(path.basename(root))
    // s1 fixed a1 in the main checkout and left it open in w1: two lives, not one.
    const rule = both.rules.find((entry: { rule: string }) => entry.rule === RULE)
    expect([rule.fired, rule.fixed, rule.ignored]).toEqual([2, 1, 1])
    expect(both.sessions).toBe(2)

    const text = (await runCli(root, ["stats", "--worktrees", "w*"])).stdout
    expect(text).toContain("2 checkouts: w1, w2 (removed)")
  })

  test("a glob that matches no checkout is a usage error", async () => {
    const root = await projectWithLog(RECORDS)
    const result = await runCli(root, ["stats", "--worktrees", "nope-*"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no checkout of this repository matches nope-*")
  })
})
