import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { generateVersionFile, withVersion } from "../../scripts/sync-version"
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
