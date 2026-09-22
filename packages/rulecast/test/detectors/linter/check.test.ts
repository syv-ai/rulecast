import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { defaultDetectorSettings } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { ToolName } from "../../../src/detectors/linter/schema"
import { linkTool } from "../../helpers/linters"
import { createProject } from "../../helpers/project"

/** A machine with a real ruff or eslint must not turn a "not installed" case green. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

/** A fake binary in the fixture's node_modules/.bin, for tools the workspace does not ship. */
async function fakeBin(root: string, name: string): Promise<void> {
  const dir = path.join(root, "node_modules", ".bin")
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, "#!/bin/sh\nexit 0\n")
  await chmod(file, 0o755)
}

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
    const root = await createProject({})
    await linkTool(root, "oxlint")
    expect(await check(root, [{ id: "a", tool: "oxlint" }])).toEqual([
      { what: "oxlint", level: "ok", detail: "node_modules/.bin/oxlint", rules: [] },
    ])
  })

  test("a python tool with no uv and nothing on the PATH is not installed", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    await fakeBin(root, "uv")
    // resolveTool's uv branch asks core/which for `uv` on the PATH, which is stubbed away here;
    // a uv in the fixture's node_modules/.bin is not what it looks for. describeTool's own test
    // in resolve.test.ts covers the uv branch.
    expect(await check(root, [{ id: "a", tool: "ruff" }])).toEqual([
      { what: "ruff", level: "error", detail: "not installed", rules: ["a"] },
    ])
  })

  test("a tool nothing provides is an error naming every rule that uses it", async () => {
    const root = await createProject({})
    expect(
      await check(root, [
        { id: "a", tool: "eslint" },
        { id: "b", tool: "eslint" },
      ]),
    ).toEqual([{ what: "eslint", level: "error", detail: "not installed", rules: ["a", "b"] }])
  })

  test("one result per tool, in first-use order", async () => {
    const root = await createProject({})
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
