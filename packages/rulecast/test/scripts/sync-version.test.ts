import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

import { generateVersionFile, withVersion } from "../../scripts/sync-version"

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
})
