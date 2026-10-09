import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"

import { repoRelative, repoRelativeTo } from "../../../src/core/detection/paths"
import { sourceReader } from "../../../src/core/detection/per-rule"
import { runTool } from "../../../src/core/detection/tool"

/**
 * The helpers `command` and `linter` each carried their own copies of until plan 9 Task 6. Their
 * real coverage is those detectors' contract suites; these pin the edges the copies were written
 * for, so the shared version cannot quietly lose one.
 */

describe("repoRelative", () => {
  test("an absolute path under the root comes back repo-relative with forward slashes", () => {
    expect(repoRelative(path.join("/repo", "src", "a.ts"), "/repo")).toBe("src/a.ts")
  })

  test("a relative path is taken as already repo-relative", () => {
    expect(repoRelative("src/a.ts", "/repo")).toBe("src/a.ts")
  })

  test("a SARIF file:// URI is decoded, not sliced", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "rulecast-paths-")))
    const file = path.join(root, "dir with space", "a.ts")
    // pathToFileURL percent-encodes the space, which is what SARIF requires a tool to emit.
    expect(pathToFileURL(file).href).toContain("%20")
    expect(repoRelative(pathToFileURL(file).href, root)).toBe("dir with space/a.ts")
  })

  test("a tool that resolved the root's symlink still lands on the repo-relative path", async () => {
    // Every macOS temp directory is under a symlink, and eslint and Path.resolve() both follow it.
    const real = await realpath(await mkdtemp(path.join(tmpdir(), "rulecast-real-")))
    const linked = path.join(await realpath(await mkdtemp(path.join(tmpdir(), "rulecast-link-"))), "project")
    await symlink(real, linked)
    expect(repoRelative(path.join(real, "src", "a.ts"), linked)).toBe("src/a.ts")
  })

  test("a path outside the root stays relative to it rather than being dropped", () => {
    expect(repoRelative("/elsewhere/a.ts", "/repo")).toBe("../elsewhere/a.ts")
  })

  test("the factory gives the same answers as the one-off form", () => {
    const relative = repoRelativeTo("/repo")
    for (const file of ["/repo/a.ts", "a.ts", "/elsewhere/b.ts"])
      expect(relative(file)).toBe(repoRelative(file, "/repo"))
  })
})

describe("sourceReader", () => {
  test("reads a file once however many times it is asked for", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-reader-"))
    await writeFile(path.join(root, "a.ts"), "first")
    const read = sourceReader(root)
    expect(await read("a.ts")).toBe("first")
    // Changed on disk after the first read: the reader answers from what it already has.
    await writeFile(path.join(root, "a.ts"), "second")
    expect(await read("a.ts")).toBe("first")
  })

  test("a file that is not there is null, not an error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-reader-"))
    expect(await sourceReader(root)("missing.ts")).toBeNull()
  })
})

describe("runTool", () => {
  const node = process.execPath
  const options = () => ({ cwd: tmpdir(), signal: new AbortController().signal, notFound: "the tool is not installed" })

  test("a clean exit returns what it printed", async () => {
    expect(await runTool(node, ["-e", "process.stdout.write('clean')"], options())).toBe("clean")
  })

  test("a non-zero exit is an answer, not a failure: a checker exits 1 when it found something", async () => {
    expect(await runTool(node, ["-e", "process.stdout.write('found'); process.exit(1)"], options())).toBe("found")
  })

  test("a binary that is not there is the caller's own message", async () => {
    await expect(runTool("rulecast-no-such-binary-for-tests", [], options())).rejects.toThrow(
      "the tool is not installed",
    )
  })

  test("an abort is rethrown untouched, so the caller can tell the clock from the rule", async () => {
    const controller = new AbortController()
    const running = runTool(node, ["-e", "setTimeout(() => {}, 10000)"], { ...options(), signal: controller.signal })
    controller.abort()
    await expect(running).rejects.toThrow(/abort/i)
  })
})
