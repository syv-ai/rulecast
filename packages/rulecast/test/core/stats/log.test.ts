import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  appendFindingsLog,
  FINDINGS_LOG,
  FINDINGS_LOG_MAX_BYTES,
  FINDINGS_LOG_ROTATED,
  type FindingsRecord,
  findingsRecord,
  readFindingsLog,
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

describe("findings log", () => {
  test("an append to a full log rotates it, and the reader returns the rotated records first", async () => {
    const stateDir = await dir()
    const old = line(record("2026-10-01T00:00:00.000Z"))
    await writeFile(path.join(stateDir, FINDINGS_LOG), old.repeat(Math.ceil(FINDINGS_LOG_MAX_BYTES / old.length)))
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {})

    expect((await stat(path.join(stateDir, FINDINGS_LOG_ROTATED))).size).toBeGreaterThanOrEqual(FINDINGS_LOG_MAX_BYTES)
    expect(await readFile(path.join(stateDir, FINDINGS_LOG), "utf8")).toBe(line(record("2026-10-02T00:00:00.000Z")))
    const read = await readFindingsLog(stateDir)
    expect(read.rotated).toBe(true)
    expect(read.records.at(0)?.at).toBe("2026-10-01T00:00:00.000Z")
    expect(read.records.at(-1)?.at).toBe("2026-10-02T00:00:00.000Z")

    // A second rotation replaces the first: the two files never hold more than about twice the cap.
    const fresh = line(record("2026-10-03T00:00:00.000Z"))
    await writeFile(path.join(stateDir, FINDINGS_LOG), fresh.repeat(Math.ceil(FINDINGS_LOG_MAX_BYTES / fresh.length)))
    await appendFindingsLog(stateDir, record("2026-10-04T00:00:00.000Z"), () => {})
    const again = await readFindingsLog(stateDir)
    expect(again.records.at(0)?.at).toBe("2026-10-03T00:00:00.000Z")
  })

  test("below the cap it appends in place", async () => {
    const stateDir = await dir()
    await appendFindingsLog(stateDir, record("2026-10-01T00:00:00.000Z"), () => {})
    await appendFindingsLog(stateDir, record("2026-10-02T00:00:00.000Z"), () => {})
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
    expect(await readFindingsLog(await dir())).toEqual({ records: [], skipped: 0, rotated: false })
  })

  test.skipIf(process.getuid?.() === 0)(
    "a state directory that cannot be written is logged, never thrown",
    async () => {
      const stateDir = await dir()
      await chmod(stateDir, 0o500)
      const lines: string[] = []
      try {
        await expect(
          appendFindingsLog(stateDir, record("2026-10-01T00:00:00.000Z"), (text) => lines.push(text)),
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
