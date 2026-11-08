import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { VERSION } from "../../../src/core/version"
import { unpack } from "../../../src/detectors/ast-grep/embedded"

async function source(bytes = "parser bytes"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rulecast-embedded-src-"))
  const file = path.join(dir, "parser.so")
  await writeFile(file, bytes)
  return file
}

const native = (home: string) => path.join(home, "native", `${VERSION}-${process.platform}-${process.arch}`)

describe("unpack", () => {
  test("copies the embedded file into the cache home once, and reuses it", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-embedded-home-"))
    const file = await source()
    const first = await unpack(file, "python", { RULECAST_HOME: home })
    expect(first).toBe(path.join(native(home), "python.so"))
    expect(await readFile(first, "utf8")).toBe("parser bytes")
    const written = (await stat(first)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await unpack(file, "python", { RULECAST_HOME: home })).toBe(first)
    expect((await stat(first)).mtimeMs).toBe(written)
    expect(await readdir(native(home))).toEqual(["python.so"])
  })

  test("replaces a file of the wrong size", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-embedded-home-"))
    const file = await source("the whole parser")
    const target = await unpack(file, "python", { RULECAST_HOME: home })
    await writeFile(target, "cut")
    await unpack(file, "python", { RULECAST_HOME: home })
    expect(await readFile(target, "utf8")).toBe("the whole parser")
  })

  test("falls back to the temp directory when the cache home cannot be written", async () => {
    const blocker = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-embedded-")), "a-file")
    await writeFile(blocker, "")
    const file = await source()
    const target = await unpack(file, "python", { RULECAST_HOME: path.join(blocker, "home") })
    expect(target.startsWith(tmpdir()) || target.startsWith(await realTmp())).toBe(true)
    expect(target).not.toContain(blocker)
    expect(await readFile(target, "utf8")).toBe("parser bytes")
  })
})

async function realTmp(): Promise<string> {
  const { realpath } = await import("node:fs/promises")
  return realpath(tmpdir())
}
