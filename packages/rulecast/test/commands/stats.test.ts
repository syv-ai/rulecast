import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { STATS_SCHEMA_VERSION } from "../../src/adapters/cli/contract"
import { parseSince } from "../../src/commands/stats"
import { FINDINGS_LOG, type FindingsRecord } from "../../src/core/stats/log"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
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
          open: 0,
          repeated: 0,
          medianTurnsToFix: null,
          repeatRate: 0,
          suppressionRate: 0,
          noisy: [],
        },
      ],
      neverFired: ["frontend/no-generated-edits"],
      unknownRules: ["old/renamed-rule"],
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
        "rule                      fired  blocked  refused  fixed  ignored  suppressed  open  repeated  turns to fix",
        "backend/no-httpexception      1        1        0      1        0           0     0         0             1",
        "old/renamed-rule              1        0        0      0        1           0     0         0             -",
        "",
        "never fired: frontend/no-generated-edits",
        "",
        "no longer configured: old/renamed-rule",
        "",
      ].join("\n"),
    )
  })

  test("--since counts only findings first reported after it", async () => {
    const root = await projectWithLog(RECORDS)
    const document = JSON.parse((await runCli(root, ["stats", "--since", "2026-10-03", "--format", "json"])).stdout)
    expect(document.window.since).toBe("2026-10-03T00:00:00.000Z")
    expect(document.sessions).toBe(1)
    expect(document.rules.map((rule: { rule: string }) => rule.rule)).toEqual(["old/renamed-rule"])
    expect(document.neverFired).toEqual([RULE, "frontend/no-generated-edits"].sort())
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
  })
})
