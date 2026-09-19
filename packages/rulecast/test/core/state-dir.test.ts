import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { debugLogger, ensureStateDir } from "../../src/core/state-dir"
import { createProject } from "../helpers/project"

describe("state directory", () => {
  test("ensureStateDir creates .rulecast/.state with a .gitignore, and never rewrites it", async () => {
    const root = await createProject({ ".rulecast/config.yml": "" })
    const dir = ensureStateDir(root)
    expect(dir).toBe(path.join(root, ".rulecast", ".state"))
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("*\n")

    writeFileSync(path.join(dir, ".gitignore"), "custom\n")
    ensureStateDir(root)
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("custom\n")
  })

  test("debugLogger appends timestamped lines", async () => {
    const root = await createProject({})
    ensureStateDir(root)
    const log = debugLogger(root, () => new Date("2026-09-16T12:00:00.000Z"))
    log("first")
    log("second")
    expect(readFileSync(path.join(root, ".rulecast/.state/debug.log"), "utf8")).toBe(
      "2026-09-16T12:00:00.000Z first\n2026-09-16T12:00:00.000Z second\n",
    )
  })

  test("debugLogger never throws", () => {
    expect(() => debugLogger("/nonexistent/rulecast-root")("line")).not.toThrow()
  })
})
