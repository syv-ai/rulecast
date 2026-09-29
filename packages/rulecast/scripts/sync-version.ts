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

/**
 * The tag in a rulecast raw URL. The README hands developers a prompt to paste into their agent,
 * and it names `agents/SETUP.md` at a tag — the same tag `init` prints for the drafting prompt, and
 * for the same reason (spec §12): a URL on a branch resolves only as long as that branch still has
 * the file. A tag nobody bumps is worse than no tag, so it is bumped here with everything else.
 */
const README_TAG = /(https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/)v\d+\.\d+\.\d+(\/)/g

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

/** The contents version.ts should have for `version`. Throws when its VERSION line is not there. */
export function withVersion(source: string, version: string): string {
  const matches = source.match(new RegExp(VERSION_LINE.source, "gm")) ?? []
  if (matches.length !== 1) {
    throw new Error(`expected exactly one \`export const VERSION = "…"\` line, found ${matches.length}`)
  }
  return source.replace(VERSION_LINE, `export const VERSION = "${version}"`)
}

/** The contents README.md should have for `version`. A README naming no tag is left alone. */
export function withReadmeTag(source: string, version: string): string {
  return source.replace(README_TAG, `$1v${version}$2`)
}

async function packageVersion(): Promise<string> {
  const { version } = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
  return version
}

export async function generateVersionFile(): Promise<{ target: string; source: string }> {
  const target = path.join(packageDir, "src/core/version.ts")
  return { target, source: withVersion(await readFile(target, "utf8"), await packageVersion()) }
}

export async function generateReadme(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "README.md")
  return { target, source: withReadmeTag(await readFile(target, "utf8"), await packageVersion()) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = [await generateVersionFile(), await generateReadme()]
  if (process.argv.includes("--check")) {
    for (const { target, source } of files) {
      if ((await readFile(target, "utf8")) !== source) {
        process.stderr.write(`${path.relative(repoRoot, target)} is stale: run pnpm sync-version\n`)
        process.exitCode = 1
      }
    }
  } else {
    for (const { target, source } of files) await writeFile(target, source)
    process.stdout.write("wrote src/core/version.ts and README.md\n")
  }
}
