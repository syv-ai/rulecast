import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { generateReadme, generateVersionFile, withReadmeTag, withVersion } from "../../scripts/sync-version"
import { run } from "../helpers/script"

const packageDir = fileURLToPath(new URL("../../", import.meta.url))

const SOURCE = [
  "/** A comment that must survive. */",
  'export const VERSION = "0.0.0"',
  "",
  "export function parseVersion(text: string) {",
  "  return text",
  "}",
  "",
].join("\n")

describe("sync-version", () => {
  test("replaces only the VERSION line", () => {
    const result = withVersion(SOURCE, "1.2.3")
    expect(result).toContain('export const VERSION = "1.2.3"')
    expect(result).toContain("/** A comment that must survive. */")
    expect(result).toContain("export function parseVersion")
    expect(result.split("\n")).toHaveLength(SOURCE.split("\n").length)
  })

  test("a file with no VERSION line is an error, not a silent no-op", () => {
    expect(() => withVersion("export const OTHER = 1\n", "1.2.3")).toThrow(/found 0/)
  })

  test("a file with two VERSION lines is an error too", () => {
    expect(() => withVersion(`${SOURCE}\n${SOURCE}`, "1.2.3")).toThrow(/found 2/)
  })

  test("the committed version.ts already matches package.json", async () => {
    const { target, source } = await generateVersionFile()
    expect(await readFile(target, "utf8"), "src/core/version.ts is stale: run pnpm sync-version").toBe(source)
  })

  test("the README's agent prompt is pinned to the package's own tag", async () => {
    const { target, source } = await generateReadme()
    const committed = await readFile(target, "utf8")
    expect(committed, "README.md is stale: run pnpm sync-version").toBe(source)
    // Not a vacuous pass: the README really does carry a tagged URL for sync-version to bump.
    expect(committed).toMatch(/https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/v\d+\.\d+\.\d+\//)
  })
})

describe("withReadmeTag", () => {
  const url = (tag: string) => `https://raw.githubusercontent.com/syv-ai/rulecast/${tag}/agents/SETUP.md`

  test("bumps every rulecast raw URL and leaves the prose alone", () => {
    const source = `Read\n${url("v0.2.0")}\nand ${url("v0.2.0")} — rulecast v0.2.0 is not a URL.\n`
    const result = withReadmeTag(source, "1.2.3")
    expect(result).toBe(`Read\n${url("v1.2.3")}\nand ${url("v1.2.3")} — rulecast v0.2.0 is not a URL.\n`)
  })

  test("a README naming no tag is left exactly as it is", () => {
    const source = "# rulecast\n\nNothing to pin here.\n"
    expect(withReadmeTag(source, "1.2.3")).toBe(source)
  })
})

test("--check exits 1 when version.ts is stale, and 0 when it is not", async () => {
  // The CI gate that keeps a published binary from reporting the wrong version rests on this.
  const script = path.join(packageDir, "scripts/sync-version.ts")
  await expect(run(script)).resolves.toBe(0)
  const target = path.join(packageDir, "src/core/version.ts")
  const original = await readFile(target, "utf8")
  try {
    await writeFile(target, withVersion(original, "9.9.9"))
    await expect(run(script)).resolves.toBe(1)
  } finally {
    await writeFile(target, original)
  }
  await expect(run(script)).resolves.toBe(0)
})
