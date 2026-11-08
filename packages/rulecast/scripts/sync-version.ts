import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { installOneLiner } from "../src/core/binary-home"

/**
 * `VERSION` is a literal because it has to survive bundling into dist/ and into a
 * `bun build --compile` binary, so it cannot read package.json at run time. changesets writes only
 * package.json, so the `version` script it runs calls this afterwards. test/core/version.test.ts
 * is what fails if the two ever come apart.
 */
const VERSION_LINE = /^export const VERSION = "[^"]*"$/m

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

async function packageVersion(): Promise<string> {
  const { version } = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
  return version
}

export async function generateVersionFile(): Promise<{ target: string; source: string }> {
  const target = path.join(packageDir, "src/core/version.ts")
  return { target, source: withVersion(await readFile(target, "utf8"), await packageVersion()) }
}

/** The Claude Code plugin's manifest: its `version` is how the marketplace tells users there is an update. */
export async function generatePluginManifest(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "plugins/rulecast/.claude-plugin/plugin.json")
  const manifest = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>
  return { target, source: `${JSON.stringify({ ...manifest, version: await packageVersion() }, null, 2)}\n` }
}

/**
 * Links from the plugin's skills to agents/ docs are pinned to a tag, as every link to them is: the
 * docs on main may describe a CLI the user does not have yet. The tag is this version's.
 */
const PINNED_DOC = /(https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/)v\d+\.\d+\.\d+(\/agents\/)/g

export function withPinnedDocs(source: string, version: string): string {
  return source.replace(PINNED_DOC, `$1v${version}$2`)
}

export async function generateSkillFiles(): Promise<{ target: string; source: string }[]> {
  const skills = path.join(repoRoot, "plugins/rulecast/skills")
  const version = await packageVersion()
  const entries = await readdir(skills, { recursive: true })
  const targets = entries.filter((entry) => entry.endsWith(".md")).map((entry) => path.join(skills, entry))
  return Promise.all(
    targets.sort().map(async (target) => ({ target, source: withPinnedDocs(await readFile(target, "utf8"), version) })),
  )
}

const README_REV = /(- repo: https:\/\/github\.com\/syv-ai\/rulecast\n\s+rev: )v\d+\.\d+\.\d+/g
const README_STATUS = /^\d+\.\d+\.( Everything above works)/gm

/**
 * The README's pre-commit snippet pins this repository by tag, and its Status names the minor
 * version: both said 0.4 at 0.7.0. Throws when either is not there, rather than go stale quietly.
 */
export function withReadmeVersion(source: string, version: string): string {
  const [major, minor] = version.split(".")
  for (const [name, pattern] of [
    ["the pre-commit snippet's rev", README_REV],
    ["the Status line", README_STATUS],
  ] as const) {
    if ((source.match(pattern) ?? []).length !== 1) throw new Error(`README.md: expected one match for ${name}`)
  }
  return source.replace(README_REV, `$1v${version}`).replace(README_STATUS, `${major}.${minor}.$1`)
}

/** installOneLiner for any X.Y.Z, so a stale copy of it is found and rewritten. */
const INSTALL_ONE_LINER = new RegExp(
  installOneLiner("0.0.0")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("0\\.0\\.0", "\\d+\\.\\d+\\.\\d+"),
  "g",
)

/**
 * README.md and agents/SETUP.md show the install one-liner for this version. Throws unless each
 * holds it exactly once, so it cannot go stale or be edited out of step with installOneLiner.
 */
export function withInstallVersion(source: string, version: string): string {
  const found = (source.match(INSTALL_ONE_LINER) ?? []).length
  if (found !== 1) throw new Error(`expected the install one-liner exactly once, found ${found}`)
  return source.replace(INSTALL_ONE_LINER, () => installOneLiner(version))
}

/** The root README; `pnpm readme` mirrors it into the package afterwards. */
export async function generateReadme(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "README.md")
  const version = await packageVersion()
  return { target, source: withInstallVersion(withReadmeVersion(await readFile(target, "utf8"), version), version) }
}

export async function generateSetup(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "agents/SETUP.md")
  return { target, source: withInstallVersion(await readFile(target, "utf8"), await packageVersion()) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = [
    await generateVersionFile(),
    await generatePluginManifest(),
    ...(await generateSkillFiles()),
    await generateReadme(),
    await generateSetup(),
  ]
  if (process.argv.includes("--check")) {
    for (const { target, source } of files) {
      if ((await readFile(target, "utf8")) !== source) {
        process.stderr.write(`${path.relative(repoRoot, target)} is stale: run pnpm sync-version\n`)
        process.exitCode = 1
      }
    }
  } else {
    for (const { target, source } of files) await writeFile(target, source)
    process.stdout.write(`wrote ${files.map(({ target }) => path.relative(repoRoot, target)).join(", ")}\n`)
  }
}
