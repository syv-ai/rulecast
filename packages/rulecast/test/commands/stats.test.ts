import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"
import { STATS_SCHEMA_VERSION } from "../../src/adapters/cli/contract"
import { parseSince } from "../../src/commands/stats"
import { FINDINGS_LOG, type FindingsRecord } from "../../src/core/stats/log"

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
})
