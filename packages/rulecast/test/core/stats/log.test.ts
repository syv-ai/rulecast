import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  appendFindingsLog,
  FINDINGS_LOG,
  FINDINGS_LOG_MAX_BYTES,
  FINDINGS_LOG_ROTATED,
  FINDINGS_WEEKLY,
  type FindingsRecord,
  findingsRecord,
  readFindingsLog,
  readWeeklyRollup,
  rollUpDropped,
} from "../../../src/core/stats/log"

const dir = () => mkdtemp(path.join(tmpdir(), "rulecast-findings-log-"))

const record = (at: string): FindingsRecord => ({
  v: 1,
  at,
  s: "s1",
  a: "main",
  ev: "edit",
  files: ["a.py"],
  ran: { rule: [0] },
  found: [],
  ign: [],
})

const line = (value: FindingsRecord) => `${JSON.stringify(value)}\n`

const OFF = { weeklySummary: false }
const ON = { weeklySummary: true }

/** A rotated file with records in two weeks, two sessions and one finding. */
const OLD_ROTATED: FindingsRecord[] = [
  { ...record("2026-09-24T10:00:00.000Z"), found: [{ r: "rule", id: "x", f: "a.py", l: 1, o: "delivered" }] },
  record("2026-09-24T11:00:00.000Z"),
  { ...record("2026-09-29T10:00:00.000Z"), s: "s2" },
]
/** The summary's mark for a log file: a hash of its first line. */
const fingerprint = (records: FindingsRecord[]) =>
  createHash("sha256").update(JSON.stringify(records[0])).digest("hex").slice(0, 16)
const OLD_LOG = fingerprint(OLD_ROTATED)
const OLD_ROWS = [
  {
    v: 1,
    log: OLD_LOG,
    to: "2026-09-29T10:00:00.000Z",
    week: "2026-09-21",
    rule: "rule",
    runs: 2,
    sessions: 1,
    fired: 1,
    files: { "a.py": 1 },
    first: "2026-09-24T10:00:00.000Z",
  },
  {
    v: 1,
    log: OLD_LOG,
    to: "2026-09-29T10:00:00.000Z",
    week: "2026-09-28",
    rule: "rule",
    runs: 1,
    sessions: 1,
    fired: 0,
    files: {},
    first: "2026-09-29T10:00:00.000Z",
  },
]

/** A full current log, and a rotated one that the next rotation drops. */
async function fullLog(stateDir: string, rotated: FindingsRecord[] | null = OLD_ROTATED): Promise<number> {
  const old = line(record("2026-10-01T00:00:00.000Z"))
  const full = Math.ceil(FINDINGS_LOG_MAX_BYTES / old.length)
  await writeFile(path.join(stateDir, FINDINGS_LOG), old.repeat(full))
  if (rotated !== null) await writeFile(path.join(stateDir, FINDINGS_LOG_ROTATED), rotated.map(line).join(""))
  return full
}

const summaryLines = async (stateDir: string) =>
  (await readFile(path.join(stateDir, FINDINGS_WEEKLY), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((text) => JSON.parse(text))

describe("findings log", () => {
  test("an append to a full log rotates it, and the reader returns the rotated records first", async () => {
    const stateDir = await dir()
    const old = line(record("2026-10-01T00:00:00.000Z"))
    await writeFile(path.join(stateDir, FINDINGS_LOG), old.repeat(Math.ceil(FINDINGS_LOG_MAX_BYTES / old.length)))
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, OFF)

    expect((await stat(path.join(stateDir, FINDINGS_LOG_ROTATED))).size).toBeGreaterThanOrEqual(FINDINGS_LOG_MAX_BYTES)
    expect(await readFile(path.join(stateDir, FINDINGS_LOG), "utf8")).toBe(line(record("2026-10-02T00:00:00.000Z")))
    const read = await readFindingsLog(stateDir)
    expect(read.rotated).toBe(true)
    expect(read.records.at(0)?.at).toBe("2026-10-01T00:00:00.000Z")
    expect(read.records.at(-1)?.at).toBe("2026-10-02T00:00:00.000Z")

    // A second rotation replaces the first: the two files never hold more than about twice the cap.
    const fresh = line(record("2026-10-03T00:00:00.000Z"))
    await writeFile(path.join(stateDir, FINDINGS_LOG), fresh.repeat(Math.ceil(FINDINGS_LOG_MAX_BYTES / fresh.length)))
    await appendFindingsLog(stateDir, record("2026-10-04T00:00:00.000Z"), () => {}, OFF)
    const again = await readFindingsLog(stateDir)
    expect(again.records.at(0)?.at).toBe("2026-10-03T00:00:00.000Z")
  })

  test("hooks that reach the cap together rotate once and lose no history", async () => {
    const stateDir = await dir()
    const old = line(record("2026-10-01T00:00:00.000Z"))
    const full = Math.ceil(FINDINGS_LOG_MAX_BYTES / old.length)
    await writeFile(path.join(stateDir, FINDINGS_LOG), old.repeat(full))
    const writers = 8
    await Promise.all(
      Array.from({ length: writers }, (_, index) =>
        appendFindingsLog(stateDir, record(`2026-10-02T00:00:0${index}.000Z`), () => {}, OFF),
      ),
    )
    const read = await readFindingsLog(stateDir)
    expect(read.records.filter(({ at }) => at === "2026-10-01T00:00:00.000Z")).toHaveLength(full)
    expect(read.records.filter(({ at }) => at.startsWith("2026-10-02"))).toHaveLength(writers)
  })

  test("a partial last line is left in place, never truncated: the next record starts on a line of its own", async () => {
    const stateDir = await dir()
    const partial = '{"v":1,"at":"2026-10-01T00:00:00.000Z","s":"s1"'
    await writeFile(path.join(stateDir, FINDINGS_LOG), `${line(record("2026-10-01T00:00:00.000Z"))}${partial}`)
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, OFF)
    expect(await readFile(path.join(stateDir, FINDINGS_LOG), "utf8")).toBe(
      `${line(record("2026-10-01T00:00:00.000Z"))}${partial}\n${line(record("2026-10-02T00:00:00.000Z"))}`,
    )
    const read = await readFindingsLog(stateDir)
    expect(read.skipped).toBe(1)
    expect(read.records).toHaveLength(2)
  })

  test("a record of this version with the wrong shape is skipped and counted", async () => {
    const stateDir = await dir()
    const { found: _, ...noFound } = record("2026-10-01T00:00:00.000Z")
    await writeFile(
      path.join(stateDir, FINDINGS_LOG),
      [
        JSON.stringify({ v: 1 }),
        JSON.stringify(noFound),
        JSON.stringify({ ...record("2026-10-01T00:00:00.000Z"), found: [{ r: "x", id: 3 }] }),
        "null",
        JSON.stringify(record("2026-10-02T00:00:00.000Z")),
        "",
      ].join("\n"),
    )
    const read = await readFindingsLog(stateDir)
    expect(read.skipped).toBe(4)
    expect(read.records.map(({ at }) => at)).toEqual(["2026-10-02T00:00:00.000Z"])
  })

  test("below the cap it appends in place", async () => {
    const stateDir = await dir()
    await appendFindingsLog(stateDir, record("2026-10-01T00:00:00.000Z"), () => {}, OFF)
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, OFF)
    const read = await readFindingsLog(stateDir)
    expect(read).toMatchObject({ rotated: false, skipped: 0 })
    expect(read.records.map(({ at }) => at)).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"])
  })

  test("a corrupt line anywhere, or another version's record, is skipped and counted", async () => {
    const stateDir = await dir()
    await writeFile(
      path.join(stateDir, FINDINGS_LOG),
      `${line(record("2026-10-01T00:00:00.000Z"))}{"v":1,"at":\n${JSON.stringify({ v: 2 })}\n${line(record("2026-10-02T00:00:00.000Z"))}`,
    )
    const read = await readFindingsLog(stateDir)
    expect(read.skipped).toBe(2)
    expect(read.records).toHaveLength(2)
  })

  test("no log is no records", async () => {
    expect(await readFindingsLog(await dir())).toEqual({
      records: [],
      skipped: 0,
      rotated: false,
      rotatedFingerprint: null,
      rotatedRecords: 0,
    })
  })

  test.skipIf(process.getuid?.() === 0)(
    "a state directory that cannot be written is logged, never thrown",
    async () => {
      const stateDir = await dir()
      await chmod(stateDir, 0o500)
      const lines: string[] = []
      try {
        await expect(
          appendFindingsLog(stateDir, record("2026-10-01T00:00:00.000Z"), (text) => lines.push(text), OFF),
        ).resolves.toBeUndefined()
      } finally {
        await chmod(stateDir, 0o700)
      }
      expect(lines.join("\n")).toContain("findings log not written")
    },
  )

  test("a record holds ids and locations, files once, and nothing when nothing ran or was found, unless it is a stop", () => {
    const match = { file: "a.py", line: 3, endLine: 3, column: 1, text: "print(secret)", captures: { x: "secret" } }
    const built = findingsRecord({
      session: "s1",
      agent: "main",
      ev: "edit",
      at: new Date("2026-10-01T00:00:00.000Z"),
      findings: [{ id: "f1", rule: { id: "r1" }, match, outcome: "delivered" }],
      ignored: [{ id: "f2", rule: { id: "r2" }, match }],
      ran: new Map([
        ["r1", ["a.py", "b.py"]],
        ["r2", ["a.py"]],
      ]),
    })
    expect(built).toEqual({
      v: 1,
      at: "2026-10-01T00:00:00.000Z",
      s: "s1",
      a: "main",
      ev: "edit",
      files: ["a.py", "b.py"],
      ran: { r1: [0, 1], r2: [0] },
      found: [{ r: "r1", id: "f1", f: "a.py", l: 3, o: "delivered" }],
      ign: [{ r: "r2", id: "f2", f: "a.py", l: 3 }],
    })
    expect(
      findingsRecord({
        session: "s1",
        agent: "main",
        ev: "edit",
        at: new Date(),
        findings: [],
        ignored: [],
        ran: new Map(),
      }),
    ).toBeNull()
    expect(
      findingsRecord({
        session: "s1",
        agent: "main",
        ev: "stop",
        at: new Date(),
        findings: [],
        ignored: [],
        ran: new Map(),
      }),
    ).toMatchObject({ ev: "stop", files: [], found: [] })
  })
})

describe("the weekly summary", () => {
  test("a rotation summarises the file it drops, by week", async () => {
    const stateDir = await dir()
    const full = await fullLog(stateDir)
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, ON)
    expect(await summaryLines(stateDir)).toEqual(OLD_ROWS)
    const rotated = await readFile(path.join(stateDir, FINDINGS_LOG_ROTATED), "utf8")
    expect(rotated).toBe(line(record("2026-10-01T00:00:00.000Z")).repeat(full))
    expect(await readWeeklyRollup(stateDir)).toEqual({
      rows: OLD_ROWS.map(({ v: _, log: __, to: ___, ...row }) => row),
      rolledUpTo: "2026-09-29T10:00:00.000Z",
      logs: new Set([OLD_LOG]),
      skipped: 0,
    })
  })

  test("with the summary off, a rotation writes no summary", async () => {
    const stateDir = await dir()
    const full = await fullLog(stateDir)
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, OFF)
    expect(existsSync(path.join(stateDir, FINDINGS_WEEKLY))).toBe(false)
    const read = await readFindingsLog(stateDir)
    expect(read.records).toHaveLength(full + 1)
  })

  test("the first rotation has nothing to summarise", async () => {
    const stateDir = await dir()
    await fullLog(stateDir, null)
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {}, ON)
    expect(existsSync(path.join(stateDir, FINDINGS_LOG_ROTATED))).toBe(true)
    expect(existsSync(path.join(stateDir, FINDINGS_WEEKLY))).toBe(false)
  })

  test("a file summarised twice is counted once", async () => {
    const stateDir = await dir()
    const dropped = path.join(stateDir, FINDINGS_LOG_ROTATED)
    await writeFile(dropped, OLD_ROTATED.map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {})
    await rollUpDropped(stateDir, dropped, () => {})
    expect(await summaryLines(stateDir)).toEqual(OLD_ROWS)
  })

  test("weeks more than 26 before now are pruned", async () => {
    const stateDir = await dir()
    const old = (week: string) => ({
      ...OLD_ROWS[1]!,
      log: `old-${week}`,
      to: `${week}T01:00:00.000Z`,
      week,
      first: `${week}T01:00:00.000Z`,
    })
    // 27 and 26 weeks before the week of now, 2026-09-28.
    await writeFile(
      path.join(stateDir, FINDINGS_WEEKLY),
      [old("2026-03-23"), old("2026-03-30")].map((row) => `${JSON.stringify(row)}\n`).join(""),
    )
    const dropped = path.join(stateDir, FINDINGS_LOG_ROTATED)
    await writeFile(dropped, OLD_ROTATED.map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {}, new Date("2026-09-30T00:00:00.000Z"))
    expect((await summaryLines(stateDir)).map((row) => row.week)).toEqual(["2026-03-30", "2026-09-21", "2026-09-28"])
  })

  test("a file whose records are older than the summary's newest is still counted (the rotation race)", async () => {
    // The hook that wins the rotate lock writes its record after the rollup, while others append
    // newer ones to the file that becomes .1: a time cutoff then dropped the winner's record.
    const stateDir = await dir()
    const dropped = path.join(stateDir, FINDINGS_LOG_ROTATED)
    await writeFile(dropped, OLD_ROTATED.map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {})
    const older = [{ ...record("2026-09-29T09:00:00.000Z"), s: "winner" }]
    await writeFile(dropped, older.map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {})
    const lines = await summaryLines(stateDir)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatchObject({ log: fingerprint(older), week: "2026-09-28", runs: 1, sessions: 1 })
  })

  test("a future-dated record neither freezes the summary nor prunes real weeks", async () => {
    const stateDir = await dir()
    const dropped = path.join(stateDir, FINDINGS_LOG_ROTATED)
    const now = new Date("2026-10-02T00:00:00.000Z")
    // A clock a year ahead.
    await writeFile(dropped, [...OLD_ROTATED, record("2027-10-01T00:00:00.000Z")].map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {}, now)
    const next = [record("2026-09-30T00:00:00.000Z"), record("2026-10-01T00:00:00.000Z")]
    await writeFile(dropped, next.map(line).join(""))
    await rollUpDropped(stateDir, dropped, () => {}, now)
    const weeks = (await summaryLines(stateDir)).map((row) => `${row.week} ${row.runs}`)
    expect(weeks).toEqual(["2026-09-21 2", "2026-09-28 1", "2027-09-27 1", "2026-09-28 2"])
  })

  test("hooks that reach the cap together summarise once", async () => {
    const stateDir = await dir()
    const full = await fullLog(stateDir)
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendFindingsLog(stateDir, record(`2026-10-02T00:00:0${index}.000Z`), () => {}, ON),
      ),
    )
    expect(await summaryLines(stateDir)).toEqual(OLD_ROWS)
    const read = await readFindingsLog(stateDir)
    expect(read.records.filter(({ at }) => at === "2026-10-01T00:00:00.000Z")).toHaveLength(full)
    expect(read.records.filter(({ at }) => at.startsWith("2026-10-02"))).toHaveLength(8)
  })

  test("a summary that cannot be written does not stop the rotation or the record", async () => {
    const stateDir = await dir()
    const full = await fullLog(stateDir)
    await mkdir(path.join(stateDir, `${FINDINGS_WEEKLY}.tmp`))
    const lines: string[] = []
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), (text) => lines.push(text), ON)
    expect(await readFile(path.join(stateDir, FINDINGS_LOG), "utf8")).toBe(line(record("2026-10-02T00:00:00.000Z")))
    expect((await readFindingsLog(stateDir)).records).toHaveLength(full + 1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("weekly summary not written")
  })

  test("a bad summary line is skipped and counted", async () => {
    const stateDir = await dir()
    await writeFile(
      path.join(stateDir, FINDINGS_WEEKLY),
      [JSON.stringify(OLD_ROWS[0]), "{nope", JSON.stringify({ ...OLD_ROWS[1], runs: -1 }), ""].join("\n"),
    )
    const rollup = await readWeeklyRollup(stateDir)
    expect(rollup.skipped).toBe(2)
    expect(rollup.rows.map((row) => row.week)).toEqual(["2026-09-21"])
  })

  test("no summary is no rows", async () => {
    expect(await readWeeklyRollup(await dir())).toEqual({ rows: [], rolledUpTo: null, logs: new Set(), skipped: 0 })
  })
})
