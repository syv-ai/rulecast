import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { defaultDetectorSettings } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { ToolName } from "../../../src/detectors/linter/schema"
import { createRepo } from "../../helpers/git"
import { linkTool } from "../../helpers/linters"

/** A machine with a real ruff or eslint must not turn a "not installed" case green. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

function check(root: string, rules: { id: string; tool: ToolName }[]) {
  return linterDetector.check!({
    rules: rules.map((rule) => ({ id: rule.id, config: { tool: rule.tool } })),
    settings: defaultDetectorSettings(),
    env: process.env,
    cwd: root,
    signal: AbortSignal.timeout(5000),
  })
}

describe("linter detector check", () => {
  test("a tool in the project's node_modules/.bin is ok, reported repo-relative", async () => {
    const root = await createRepo({})
    await linkTool(root, "oxlint")
    expect(await check(root, [{ id: "a", tool: "oxlint" }])).toEqual([
      { what: "oxlint", level: "ok", detail: "node_modules/.bin/oxlint", rules: [] },
    ])
  })

  test("a python tool in a uv project is reported as the command a person would type", async () => {
    const root = await createRepo({ "pyproject.toml": "[project]\nname = 'x'\n" })
    // PATH is stubbed, so the only uv reachable is the one this test puts there.
    const bin = path.join(root, "fake-path")
    await mkdir(bin, { recursive: true })
    await writeFile(path.join(bin, "uv"), "#!/bin/sh\nexit 0\n")
    await chmod(path.join(bin, "uv"), 0o755)
    vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`)
    expect(await check(root, [{ id: "a", tool: "ruff" }])).toEqual([
      { what: "ruff", level: "ok", detail: "uv run -- ruff", rules: [] },
    ])
  })

  test("a python tool with no uv and nothing on the PATH is not installed", async () => {
    const root = await createRepo({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await check(root, [{ id: "a", tool: "ruff" }])).toEqual([
      { what: "ruff", level: "error", detail: "not installed", rules: ["a"] },
    ])
  })

  test("a tool nothing provides is an error naming every rule that uses it", async () => {
    const root = await createRepo({})
    expect(
      await check(root, [
        { id: "a", tool: "eslint" },
        { id: "b", tool: "eslint" },
      ]),
    ).toEqual([{ what: "eslint", level: "error", detail: "not installed", rules: ["a", "b"] }])
  })

  test("one result per tool, in first-use order", async () => {
    const root = await createRepo({})
    await linkTool(root, "oxlint")
    expect(
      await check(root, [
        { id: "a", tool: "eslint" },
        { id: "b", tool: "oxlint" },
        { id: "c", tool: "eslint" },
      ]),
    ).toEqual([
      { what: "eslint", level: "error", detail: "not installed", rules: ["a", "c"] },
      { what: "oxlint", level: "ok", detail: "node_modules/.bin/oxlint", rules: [] },
    ])
  })
})
