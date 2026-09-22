import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * `VERSION` is a literal because it has to survive bundling into dist/ and into a
 * `bun build --compile` binary, so it cannot read package.json at run time. changesets writes only
 * package.json, so the `version` script it runs calls this afterwards. test/core/version.test.ts
 * is what fails if the two ever come apart.
 */
const VERSION_LINE = /^export const VERSION = "[^"]*"$/m

const packageDir = fileURLToPath(new URL("../", import.meta.url))

/** The contents version.ts should have for `version`. Throws when its VERSION line is not there. */
export function withVersion(source: string, version: string): string {
  const matches = source.match(new RegExp(VERSION_LINE.source, "gm")) ?? []
  if (matches.length !== 1) {
    throw new Error(`expected exactly one \`export const VERSION = "…"\` line, found ${matches.length}`)
  }
  return source.replace(VERSION_LINE, `export const VERSION = "${version}"`)
}

export async function generateVersionFile(): Promise<{ target: string; source: string }> {
  const target = path.join(packageDir, "src/core/version.ts")
  const { version } = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
  return { target, source: withVersion(await readFile(target, "utf8"), version) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { target, source } = await generateVersionFile()
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== source) {
      process.stderr.write("src/core/version.ts is stale: run pnpm sync-version\n")
      process.exitCode = 1
    }
  } else {
    await writeFile(target, source)
    process.stdout.write("wrote src/core/version.ts\n")
  }
}
