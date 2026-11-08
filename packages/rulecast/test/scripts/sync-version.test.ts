import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import {
  generateReadme,
  generateSetup,
  generateVersionFile,
  withInstallVersion,
  withReadmeVersion,
  withVersion,
} from "../../scripts/sync-version"
import { installOneLiner } from "../../src/core/binary-home"
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
  test("withInstallVersion pins the one-liner and throws without exactly one", () => {
    const doc = `Install:\n\n\`\`\`sh\n${installOneLiner("0.1.0")}\n\`\`\`\n`
    expect(withInstallVersion(doc, "1.2.3")).toBe(`Install:\n\n\`\`\`sh\n${installOneLiner("1.2.3")}\n\`\`\`\n`)
    expect(() => withInstallVersion("no one-liner\n", "1.2.3")).toThrow(/found 0/)
    expect(() => withInstallVersion(`${doc}${doc}`, "1.2.3")).toThrow(/found 2/)
  })

  test("the committed SETUP.md already matches package.json", async () => {
    const { target, source } = await generateSetup()
    expect(await readFile(target, "utf8")).toBe(source)
  })

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

  test("the README's pre-commit rev and status follow the version (plan 21, #7)", () => {
    // Both said 0.4 at 0.7.0: nothing kept them in step.
    const readme = [
      "repos:",
      "  - repo: https://github.com/syv-ai/rulecast",
      "    rev: v0.4.0",
      "  - repo: https://github.com/other/tool",
      "    rev: v0.4.0",
      "",
      "## Status",
      "",
      "0.4. Everything above works and is tested.",
      "",
    ].join("\n")
    const result = withReadmeVersion(readme, "1.2.3")
    expect(result).toContain("  - repo: https://github.com/syv-ai/rulecast\n    rev: v1.2.3\n")
    expect(result).toContain("  - repo: https://github.com/other/tool\n    rev: v0.4.0\n")
    expect(result).toContain("\n1.2. Everything above works and is tested.\n")
    expect(() => withReadmeVersion("# no snippet\n", "1.2.3")).toThrow(/rev/)
  })

  test("the committed README already matches package.json", async () => {
    const { target, source } = await generateReadme()
    expect(await readFile(target, "utf8"), "README.md is stale: run pnpm sync-version").toBe(source)
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
