import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createProject } from "./helpers/project"

// Fixtures left in the shared temp directory slowed every oxlint run, and with it `pnpm perf`.
describe("the test run's temp directory", () => {
  it("holds every fixture, so the run removes them when it ends", async () => {
    const run = process.env.RULECAST_TEST_TMPDIR
    expect(run).toMatch(/rulecast-tests-/)
    expect(tmpdir()).toBe(run)
    expect(path.dirname(await createProject({}))).toBe(run)
  })

  it("is the temp directory of the processes a test spawns too", () => {
    const child = execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:os').tmpdir())"], {
      encoding: "utf8",
    })
    expect(child).toBe(process.env.RULECAST_TEST_TMPDIR)
  })
})
