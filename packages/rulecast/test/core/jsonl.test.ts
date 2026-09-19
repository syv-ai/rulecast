import { appendFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { appendRecords, CorruptStoreError, readRecords } from "../../src/core/jsonl"
import { createProject } from "../helpers/project"

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
    await appendFile(file, '{"t":"b"')
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "c" }])
  })

  test("appending after a crash on the first record drops the partial record", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendFile(file, '{"t":"b"')
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "c" }])
  })

  test("a partial record longer than one read chunk is dropped whole", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await appendFile(file, `{"t":"${"x".repeat(200_000)}`)
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "c" }])
  })

  test("an unparseable line before the end is corruption", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendFile(file, 'garbage\n{"t":"a"}\n')
    await expect(readRecords(file)).rejects.toBeInstanceOf(CorruptStoreError)
  })
})
