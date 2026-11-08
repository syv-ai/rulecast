import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir, userInfo } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

import { VERSION } from "../../../src/core/version"
import { EMBEDDED_KEY, isStandaloneBinary, privateTempDir, unpack } from "../../../src/detectors/ast-grep/embedded"

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

  test("a file already unpacked is not read again", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-embedded-home-"))
    const file = await source()
    const first = await unpack(file, "napi", { RULECAST_HOME: home })
    // Unreadable now: a second read would throw. stat still works.
    await chmod(file, 0o000)
    try {
      expect(await unpack(file, "napi", { RULECAST_HOME: home })).toBe(first)
    } finally {
      await chmod(file, 0o644)
    }
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

describe("privateTempDir", () => {
  const dirName = `${VERSION}-${process.platform}-${process.arch}`

  async function tmp(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "rulecast-tmpdir-"))
    vi.stubEnv("TMPDIR", dir)
    return dir
  }
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("uses <tmp>/rulecast-native-<uid> when this user owns it and nobody else can write it", async () => {
    const dir = await tmp()
    const shared = path.join(dir, `rulecast-native-${userInfo().uid}`)
    expect(await privateTempDir()).toBe(path.join(shared, dirName))
    expect((await lstat(shared)).mode & 0o077).toBe(0)
  })

  test("a shared directory others can write, or a link, is not used: a fresh private one is", async () => {
    for (const plant of ["writable", "link"] as const) {
      const dir = await tmp()
      const shared = path.join(dir, `rulecast-native-${userInfo().uid}`)
      if (plant === "writable") {
        await mkdir(shared)
        await chmod(shared, 0o777)
      } else {
        await mkdir(path.join(dir, "elsewhere"))
        await symlink(path.join(dir, "elsewhere"), shared)
      }
      const chosen = await privateTempDir()
      expect(chosen.startsWith(`${shared}${path.sep}`), plant).toBe(false)
      expect(path.dirname(chosen).startsWith(path.join(dir, "rulecast-native-")), plant).toBe(true)
      expect((await lstat(path.dirname(chosen))).mode & 0o077, plant).toBe(0)
    }
  })

  test("unpack never loads a planted file from a directory others can write", async () => {
    const dir = await tmp()
    const shared = path.join(dir, `rulecast-native-${userInfo().uid}`)
    await mkdir(path.join(shared, dirName), { recursive: true })
    await chmod(shared, 0o777)
    // Same size as the real file: the size check alone would take it.
    await writeFile(path.join(shared, dirName, "napi.so"), "planted bytes")
    const blocker = path.join(dir, "a-file")
    await writeFile(blocker, "")
    const target = await unpack(await source("parser bytes!"), "napi", { RULECAST_HOME: path.join(blocker, "home") })
    expect(target.startsWith(shared)).toBe(false)
    expect(await readFile(target, "utf8")).toBe("parser bytes!")
  })
})

describe("isStandaloneBinary", () => {
  test("isStandaloneBinary follows the embedded global", () => {
    const global = globalThis as Record<string, unknown>
    expect(isStandaloneBinary()).toBe(false)
    global[EMBEDDED_KEY] = {}
    try {
      expect(isStandaloneBinary()).toBe(true)
    } finally {
      delete global[EMBEDDED_KEY]
    }
    expect(isStandaloneBinary()).toBe(false)
  })
})

async function realTmp(): Promise<string> {
  const { realpath } = await import("node:fs/promises")
  return realpath(tmpdir())
}
