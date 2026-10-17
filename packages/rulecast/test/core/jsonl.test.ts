import { appendFile, utimes } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { appendRecords, CorruptStoreError, readRecords } from "../../src/core/jsonl"
import { createProject } from "../helpers/project"

/** A partial line nobody is writing any more: the file has not changed for a minute. */
async function crashed(file: string, partial: string): Promise<void> {
  await appendFile(file, partial)
  const minuteAgo = new Date(Date.now() - 60_000)
  await utimes(file, minuteAgo, minuteAgo)
}

describe("jsonl", () => {
  test("a missing file reads as empty", async () => {
    const root = await createProject({})
    expect(await readRecords(path.join(root, "nope.jsonl"))).toEqual([])
  })

  test("appends create directories and preserve order", async () => {
    const file = path.join(await createProject({}), "sessions", "s1", "work.jsonl")
    await appendRecords(file, [{ t: "a" }, { t: "b" }])
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "b" }, { t: "c" }])
  })

  test("an unparseable final line is ignored", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await appendFile(file, '{"t":"b"')
    expect(await readRecords(file)).toEqual([{ t: "a" }])
  })

  test("appending after a crash mid-append drops the partial record", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await crashed(file, '{"t":"b"')
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "c" }])
  })

  test("appending after a crash on the first record drops the partial record", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await crashed(file, '{"t":"b"')
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "c" }])
  })

  test("a partial record longer than one read chunk is dropped whole", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await crashed(file, `{"t":"${"x".repeat(200_000)}`)
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "c" }])
  })

  test("a partial line still being written is waited for, not cut", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await appendFile(file, '{"t":"b"')
    const finishing = new Promise<void>((resolve) => setTimeout(() => void appendFile(file, "}\n").then(resolve), 100))
    await appendRecords(file, [{ t: "c" }])
    await finishing
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "b" }, { t: "c" }])
  })

  test("large and small records appended at once all arrive whole", async () => {
    // A multi-megabyte append reaches the file in several writes; unlocked, small records from other
    // writers landed inside it, and a writer that saw its unfinished line cut it away.
    const file = path.join(await createProject({}), "work.jsonl")
    const big = "x".repeat(4_000_000)
    await Promise.all([
      ...[1, 2].map((n) => appendRecords(file, [{ t: `big${n}`, big }])),
      ...Array.from({ length: 30 }, (_, n) => appendRecords(file, [{ t: `small${n}` }])),
    ])
    const records = await readRecords<{ t: string }>(file)
    expect(records.map((record) => record.t).sort()).toEqual(
      ["big1", "big2", ...Array.from({ length: 30 }, (_, n) => `small${n}`)].sort(),
    )
  })

  test("an unparseable line before the end is corruption", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendFile(file, 'garbage\n{"t":"a"}\n')
    await expect(readRecords(file)).rejects.toBeInstanceOf(CorruptStoreError)
  })
})
