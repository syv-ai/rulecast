import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { BINARY_TARGETS, hostTarget } from "../../scripts/build-binary"

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))

async function matrixTargets(workflow: string, job: string): Promise<string[]> {
  const parsed = parse(await readFile(path.join(repoRoot, ".github/workflows", workflow), "utf8"))
  const include = parsed.jobs?.[job]?.strategy?.matrix?.include as { target: string }[] | undefined
  expect(include, `${workflow} must have a ${job} job with a matrix include`).toBeDefined()
  return include!.map((entry) => entry.target).sort()
}

describe("hostTarget", () => {
  test("names the target for each platform 0.1 ships", () => {
    expect(hostTarget("linux", "x64")).toBe("linux-x64")
    expect(hostTarget("darwin", "arm64")).toBe("darwin-arm64")
  })

  test("throws on a platform with no binary rather than naming one that would not work", () => {
    expect(() => hostTarget("win32", "x64")).toThrow(/does not ship a binary for win32-x64/)
  })

  test("this machine is one of them", () => {
    expect(BINARY_TARGETS).toContain(hostTarget())
  })
})

describe("the workflows build the targets the script knows", () => {
  // The one place a typo stays invisible until release day: ci.yml proves a target builds,
  // binaries.yml names the file it uploads, and build-binary.ts derives the name from the host.
  // A mismatch means a release with a missing or misnamed asset.
  test.each([
    ["ci.yml", "binary"],
    ["binaries.yml", "attach"],
  ])("%s's %s job", async (workflow, job) => {
    expect(await matrixTargets(workflow, job)).toEqual([...BINARY_TARGETS].sort())
  })
})
