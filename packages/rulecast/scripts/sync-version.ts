import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { gitHookCommand } from "../src/core/binary-home"

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

const PRE_COMMIT_REV = /(- repo: https:\/\/github\.com\/syv-ai\/rulecast\n\s+rev: )v\d+\.\d+\.\d+/g
const README_STATUS = /^\d+\.\d+\.( Everything above works)/gm

/** Throws unless `pattern` matches `source` exactly once, rather than go stale quietly. */
function once(source: string, pattern: RegExp, file: string, name: string): void {
  if ((source.match(pattern) ?? []).length !== 1) throw new Error(`${file}: expected one match for ${name}`)
}

/** The README's Status names the minor version: it said 0.4 at 0.7.0. */
export function withReadmeVersion(source: string, version: string): string {
  const [major, minor] = version.split(".")
  once(source, README_STATUS, "README.md", "the Status line")
  return source.replace(README_STATUS, `${major}.${minor}.$1`)
}

/** The Git hooks guide's pre-commit snippet pins this repository by tag: it said v0.4.0 at 0.7.0. */
export function withPreCommitRev(source: string, version: string): string {
  return withRepoRev(source, version, GIT_HOOKS_GUIDE, "the pre-commit snippet's rev")
}

/** A `repo:` entry for this repository and the `rev:` under it, pinned to this version's tag. */
export function withRepoRev(source: string, version: string, file: string, name = "the rulecast repo's rev"): string {
  once(source, PRE_COMMIT_REV, file, name)
  return source.replace(PRE_COMMIT_REV, `$1v${version}`)
}

/** The rule format's example config pins the catalog by tag: it said v0.2.0 at 0.12.0. */
export const RULE_FORMAT = "agents/reference/rule-format.md"

export async function generateRuleFormat(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, RULE_FORMAT)
  return { target, source: withRepoRev(await readFile(target, "utf8"), await packageVersion(), RULE_FORMAT) }
}

/** DRAFT-RULES.md's catalog-override example keeps init's entry, rev and all: it said v0.3.0 at 0.12.0. */
export const DRAFT_RULES = "agents/DRAFT-RULES.md"

export async function generateDraftRules(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, DRAFT_RULES)
  return { target, source: withRepoRev(await readFile(target, "utf8"), await packageVersion(), DRAFT_RULES) }
}

/** The git-hook commands' arguments, by where they appear. */
export const GIT_HOOK_ARGS = {
  preCommit: "run",
  prePush: 'run --from-ref "$PRE_COMMIT_FROM_REF" --to-ref "$PRE_COMMIT_TO_REF"',
  lefthookPush: 'run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD',
} as const

/** Rewrites each `<prefix>sh -c '…' --` line in `source` with the next of `commands`. Throws on a count mismatch. */
function withCommandLines(source: string, prefix: string, commands: string[], what: string): string {
  const pattern = new RegExp(`^(${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})sh -c '.*' --$`, "gm")
  const found = (source.match(pattern) ?? []).length
  if (found !== commands.length)
    throw new Error(`${what}: expected ${commands.length} git-hook commands, found ${found}`)
  let next = 0
  return source.replace(pattern, (_, start: string) => `${start}${commands[next++]}`)
}

/** The Git hooks guide's lefthook snippet runs gitHookCommand, the order the agent hooks use. */
export function withLefthookCommands(source: string): string {
  return withCommandLines(
    source,
    "      run: ",
    [gitHookCommand(GIT_HOOK_ARGS.preCommit), gitHookCommand(GIT_HOOK_ARGS.lefthookPush)],
    GIT_HOOKS_GUIDE,
  )
}

/** .pre-commit-hooks.yaml's two entries are gitHookCommand. */
export async function generatePreCommitHooks(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, ".pre-commit-hooks.yaml")
  const commands = [gitHookCommand(GIT_HOOK_ARGS.preCommit), gitHookCommand(GIT_HOOK_ARGS.prePush)]
  return {
    target,
    source: withCommandLines(await readFile(target, "utf8"), "  entry: ", commands, ".pre-commit-hooks.yaml"),
  }
}

/** The root README; `pnpm readme` mirrors it into the package afterwards. */
export async function generateReadme(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "README.md")
  return { target, source: withReadmeVersion(await readFile(target, "utf8"), await packageVersion()) }
}

const INSTALL_SCRIPT_VERSION = /^VERSION="\d+\.\d+\.\d+"$/gm

/** install.sh downloads the release it names in its one `VERSION="x.y.z"` line. */
export function withInstallScriptVersion(source: string, version: string): string {
  once(source, INSTALL_SCRIPT_VERSION, "install.sh", 'the VERSION="…" line')
  return source.replace(INSTALL_SCRIPT_VERSION, `VERSION="${version}"`)
}

export async function generateInstallScript(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, "install.sh")
  return { target, source: withInstallScriptVersion(await readFile(target, "utf8"), await packageVersion()) }
}

/** The guide with the pre-commit and lefthook snippets. */
export const GIT_HOOKS_GUIDE = "guides/git-hooks-ci.md"

export async function generateGitHooksGuide(): Promise<{ target: string; source: string }> {
  const target = path.join(repoRoot, GIT_HOOKS_GUIDE)
  const source = withPreCommitRev(await readFile(target, "utf8"), await packageVersion())
  return { target, source: withLefthookCommands(source) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = [
    await generateVersionFile(),
    await generatePluginManifest(),
    ...(await generateSkillFiles()),
    await generateReadme(),
    await generateGitHooksGuide(),
    await generateRuleFormat(),
    await generateDraftRules(),
    await generateInstallScript(),
    await generatePreCommitHooks(),
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
