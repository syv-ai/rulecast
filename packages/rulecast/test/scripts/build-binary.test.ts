import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { BINARY_RUNNERS, BINARY_TARGETS, hostTarget } from "../../scripts/build-binary"

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))

/** The os → target pairs a workflow's matrix declares. */
async function matrixPairs(workflow: string, job: string): Promise<Record<string, string>> {
  const parsed = parse(await readFile(path.join(repoRoot, ".github/workflows", workflow), "utf8"))
  const include = parsed.jobs?.[job]?.strategy?.matrix?.include as { os: string; target: string }[] | undefined
  expect(include, `${workflow} must have a ${job} job with a matrix include`).toBeDefined()
  return Object.fromEntries(include!.map((entry) => [entry.target, entry.os]))
}

describe("hostTarget", () => {
  test("names the target for each platform 0.1 ships", () => {
    expect(hostTarget("linux", "x64")).toBe("linux-x64")
    expect(hostTarget("darwin", "arm64")).toBe("darwin-arm64")
  })

  test("throws on a platform with no binary rather than naming one that would not work", () => {
    expect(() => hostTarget("win32", "x64")).toThrow(/does not ship a binary for win32-x64/)
  })

  test("every target has a runner, and no runner is used twice", () => {
    expect(Object.keys(BINARY_RUNNERS).sort()).toEqual([...BINARY_TARGETS].sort())
    expect(new Set(Object.values(BINARY_RUNNERS)).size).toBe(BINARY_TARGETS.length)
  })
})

describe("the workflows build the targets the script knows", () => {
  // The one place a typo stays invisible until release day: ci.yml proves a target builds,
  // binaries.yml names the file it uploads, and build-binary.ts derives the name from the host.
  // A mismatch means a release with a missing or misnamed asset.
  // The pairing, not just the set: swapping two runners between entries would leave the set
  // identical while building each binary on the wrong machine — and bun embeds the building
  // machine's native module, so the result is a binary that dies at the first ast-grep rule.
  test.each([
    ["ci.yml", "binary"],
    ["binaries.yml", "attach"],
  ])("%s's %s job builds each target on its own runner", async (workflow, job) => {
    expect(await matrixPairs(workflow, job)).toEqual(BINARY_RUNNERS)
  })
})
