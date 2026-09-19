import { mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { cacheHome, debugLogger, ensureProjectState, projectStateDir } from "../../src/core/home"
import { createProject } from "../helpers/project"

const tempDir = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix))

describe("cache home", () => {
  test("RULECAST_HOME wins, then XDG_CACHE_HOME, then ~/.cache", () => {
    expect(cacheHome({ RULECAST_HOME: "/r", XDG_CACHE_HOME: "/x" })).toBe("/r")
    expect(cacheHome({ XDG_CACHE_HOME: "/x" })).toBe("/x/rulecast")
    expect(cacheHome({})).toBe(path.join(homedir(), ".cache", "rulecast"))
  })

  test("empty values count as unset", () => {
    expect(cacheHome({ RULECAST_HOME: "", XDG_CACHE_HOME: "/x" })).toBe("/x/rulecast")
    expect(cacheHome({ RULECAST_HOME: "", XDG_CACHE_HOME: "" })).toBe(path.join(homedir(), ".cache", "rulecast"))
  })
})

describe("project state", () => {
  test("a project's directory is keyed by its real path", async () => {
    const root = await createProject({})
    const link = path.join(tempDir("rulecast-link-"), "project")
    symlinkSync(root, link)
    const dir = projectStateDir("/home", root)
    expect(dir).toMatch(/^\/home\/projects\/[0-9a-f]{16}$/)
    expect(projectStateDir("/home", link)).toBe(dir)
    expect(projectStateDir("/home", await createProject({}))).not.toBe(dir)
  })

  test("ensureProjectState creates the directory and records the project path once", async () => {
    const home = tempDir("rulecast-home-")
    const root = await createProject({})
    const dir = ensureProjectState(home, root)
    expect(dir).toBe(projectStateDir(home, root))
    expect(readFileSync(path.join(dir, "root"), "utf8")).toBe(`${realpathSync(root)}\n`)

    writeFileSync(path.join(dir, "root"), "custom\n")
    expect(ensureProjectState(home, root)).toBe(dir)
    expect(readFileSync(path.join(dir, "root"), "utf8")).toBe("custom\n")
  })

  test("nothing is written inside the project", async () => {
    const root = await createProject({})
    ensureProjectState(tempDir("rulecast-home-"), root)
    expect(readdirSync(root)).toEqual([])
  })
})

describe("debug log", () => {
  test("appends timestamped lines to the state directory's debug.log", async () => {
    const dir = ensureProjectState(tempDir("rulecast-home-"), await createProject({}))
    const log = debugLogger(dir, () => new Date("2026-09-16T12:00:00.000Z"))
    log("first")
    log("second")
    expect(readFileSync(path.join(dir, "debug.log"), "utf8")).toBe(
      "2026-09-16T12:00:00.000Z first\n2026-09-16T12:00:00.000Z second\n",
    )
  })

  test("never throws", () => {
    expect(() => debugLogger("/nonexistent/rulecast-state")("line")).not.toThrow()
  })
})
