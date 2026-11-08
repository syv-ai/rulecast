import { readdir } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

import { readSourceFile } from "../core/detection/per-rule"
import { git, isShallow, repositoryTop } from "../core/git"
import type { Adapter } from "../core/types"
import { PRE_COMMIT_CONFIG } from "../detectors/hook/resolve"
import { detectStack } from "./detect"
import { VENDORED_DIR } from "./generated"
import { globToRegex, LEFTHOOK_CONFIGS } from "./hooks"

/** What setup needs to know about a project that a few lines of code find the same way every time (plan 24). */
export interface SetupFacts {
  /** Distinct author emails in the last six months, for this directory; bots left out. null: none, or a shallow clone. */
  committers: { count: number; since: "6 months" } | null
  /** Declared workspaces, plus top-level dirs holding a manifest. Relative to the project, "/"-terminated. */
  packages: { dir: string; manifest: string; stack: string[]; agentDoc: boolean; config: boolean }[]
  /** Dirs below the project holding an adapter's install marker (e.g. ".claude/"). */
  sessions: string[]
  /** The git hook managers at the git top, relative to the project, and whether rulecast is already in each. */
  gitHooks: { manager: "pre-commit" | "lefthook" | "husky"; file: string; rulecast: boolean }[]
  /** Workflow files that run a coding agent. */
  ci: { file: string; agent: string }[]
}

export interface FactsInput {
  /** The project: where init runs. */
  root: string
  /** Every project file, relative to `root`. */
  files: readonly string[]
  /** Reads a project-relative file; null when missing. */
  read(file: string): Promise<string | null>
  /** Whether a project-relative marker exists; a trailing "/" asks for a directory. */
  exists(marker: string): boolean
  adapters: readonly Adapter[]
}

const MANIFESTS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml"]
const isManifest = (name: string) => MANIFESTS.includes(name) || name.endsWith(".csproj")
const BOT = /\[bot\]$/
const BOT_EMAIL = /\[bot\]@users\.noreply\.github\.com$/

/** rulecast's pre-commit repo, a hook or job named rulecast, or a `rulecast run` command. */
const MENTIONS_RULECAST = /syv-ai\/rulecast|\brulecast\s+run\b|^\s*-?\s*(id|name):\s*["']?rulecast["']?\s*$/m

/** A workflow step that runs a coding agent, and which. */
const CI_AGENTS: readonly { agent: string; pattern: RegExp }[] = [
  { agent: "claude-code", pattern: /anthropics\/claude-code-action|\bclaude\s+(-p|--print)\b/ },
  { agent: "codex", pattern: /openai\/codex-action|\bcodex\s+exec\b/ },
]

/**
 * null when the history can't say: no commits, none in six months, or a shallow clone (CI's
 * checkout, a `--depth 1` clone), whose few commits undercount the people.
 */
async function committers(root: string): Promise<SetupFacts["committers"]> {
  if (await isShallow(root)) return null
  const log = await git(root, ["log", "--since=6 months ago", "--format=%ae%x09%an", "--", "."])
  if (!log.ok) return null
  const emails = new Set<string>()
  for (const line of log.stdout.split("\n")) {
    const [email = "", name = ""] = line.split("\t")
    if (email === "" || BOT.test(name) || BOT_EMAIL.test(email)) continue
    emails.add(email.toLowerCase())
  }
  return emails.size === 0 ? null : { count: emails.size, since: "6 months" }
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

function loadYaml(text: string | null): unknown {
  if (text === null) return null
  try {
    return parse(text)
  } catch {
    return null
  }
}

/** A TOML section's `members = [...]` strings; enough TOML for a workspace list, not a parser. */
function tomlMembers(text: string | null, section: string): string[] {
  if (text === null) return []
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `[${section}]`)
  if (start === -1) return []
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break
    body.push(line)
  }
  const members = /(^|\n)\s*members\s*=\s*\[([^\]]*)\]/.exec(body.join("\n"))
  if (members === null) return []
  return [...members[2]!.matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2]!)
}

/** The workspace globs a project declares, from each package manager that has a list of them. */
async function workspaceGlobs(read: FactsInput["read"]): Promise<string[]> {
  const globs: string[] = []
  const manifest = loadJson(await read("package.json"))
  const workspaces = (manifest as { workspaces?: unknown } | null)?.workspaces
  globs.push(...asStrings(workspaces), ...asStrings((workspaces as { packages?: unknown } | null)?.packages))
  globs.push(...asStrings((loadYaml(await read("pnpm-workspace.yaml")) as { packages?: unknown } | null)?.packages))
  globs.push(...tomlMembers(await read("Cargo.toml"), "workspace"))
  globs.push(...tomlMembers(await read("pyproject.toml"), "tool.uv.workspace"))
  return globs
}

function loadJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const dirOf = (file: string) => path.posix.dirname(file)
const inNodeModules = (file: string) => file.split("/").includes("node_modules")

async function packages(input: FactsInput): Promise<SetupFacts["packages"]> {
  const files = input.files.filter((file) => !inNodeModules(file))
  // Each dir holding a manifest, with the first one found there.
  const manifests = new Map<string, string>()
  for (const file of files) {
    const name = path.posix.basename(file)
    const dir = dirOf(file)
    if (dir !== "." && isManifest(name) && !manifests.has(dir)) manifests.set(dir, name)
  }
  const globs = await workspaceGlobs(input.read)
  const declared = globs
    .filter((glob) => !glob.startsWith("!"))
    .map((glob) => new RegExp(globToRegex(glob.replace(/^\.\//, "").replace(/\/+$/, ""))))
  const excluded = globs
    .filter((glob) => glob.startsWith("!"))
    .map((glob) => new RegExp(globToRegex(glob.slice(1).replace(/^\.\//, "").replace(/\/+$/, ""))))
  const dirs = [...manifests.keys()].filter((dir) => {
    if (VENDORED_DIR.test(`${dir}/`) || dir.split("/").some((segment) => segment.startsWith("."))) return false
    if (!dir.includes("/")) return true
    return declared.some((glob) => glob.test(dir)) && !excluded.some((glob) => glob.test(dir))
  })
  const present = new Set(files)
  const found: SetupFacts["packages"] = []
  for (const dir of dirs.sort()) {
    const prefix = `${dir}/`
    const inside = files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length))
    found.push({
      dir: prefix,
      manifest: manifests.get(dir)!,
      stack: await detectStack(inside, (file) => input.read(`${prefix}${file}`)),
      agentDoc: present.has(`${prefix}AGENTS.md`) || present.has(`${prefix}CLAUDE.md`),
      config: present.has(`${prefix}.rulecast-config.yaml`),
    })
  }
  return found
}

/** Dirs below the project, in a package or beside an AGENTS.md, where an agent's install marker is. */
function sessions(input: FactsInput, packageDirs: readonly string[]): string[] {
  const docDirs = input.files
    .filter((file) => path.posix.basename(file) === "AGENTS.md" && file.includes("/") && !inNodeModules(file))
    .map((file) => `${dirOf(file)}/`)
  const dirs = [...new Set([...packageDirs, ...docDirs])].sort()
  const markers = input.adapters.flatMap((adapter) => adapter.install?.markers ?? [])
  return dirs.filter((dir) => markers.some((marker) => input.exists(`${dir}${marker}`)))
}

async function gitHooks(root: string, top: string): Promise<SetupFacts["gitHooks"]> {
  const project = path.relative(top, root)
  const up = project === "" ? "" : "../".repeat(project.split(path.sep).length)
  const read = (file: string) => readSourceFile(top, file).catch(() => null)
  const hooks: SetupFacts["gitHooks"] = []
  const preCommit = await read(PRE_COMMIT_CONFIG)
  if (preCommit !== null) {
    hooks.push({
      manager: "pre-commit",
      file: `${up}${PRE_COMMIT_CONFIG}`,
      rulecast: MENTIONS_RULECAST.test(preCommit),
    })
  }
  for (const file of LEFTHOOK_CONFIGS) {
    const text = await read(file)
    if (text === null) continue
    hooks.push({ manager: "lefthook", file: `${up}${file}`, rulecast: MENTIONS_RULECAST.test(text) })
    break
  }
  const husky = await readdir(path.join(top, ".husky")).catch(() => null)
  if (husky !== null) {
    const scripts = await Promise.all(
      husky.map((name) => readSourceFile(path.join(top, ".husky"), name).catch(() => null)),
    )
    const rulecast = scripts.some((text) => text !== null && /\brulecast\b/.test(text))
    hooks.push({ manager: "husky", file: `${up}.husky/`, rulecast })
  }
  return hooks
}

async function ci(root: string, top: string): Promise<SetupFacts["ci"]> {
  const project = path.relative(top, root)
  const up = project === "" ? "" : "../".repeat(project.split(path.sep).length)
  const dir = path.join(top, ".github", "workflows")
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => /\.ya?ml$/.test(name)).sort()
  const found: SetupFacts["ci"] = []
  for (const name of names) {
    const text = await readSourceFile(dir, name).catch(() => null)
    if (text === null) continue
    for (const { agent, pattern } of CI_AGENTS) {
      if (pattern.test(text)) found.push({ file: `${up}.github/workflows/${name}`, agent })
    }
  }
  return found
}

/** The facts setup's page of defaults is drawn from (plan 24). Nothing here writes. */
export async function setupFacts(input: FactsInput): Promise<SetupFacts> {
  const top = await repositoryTop(input.root)
  // A file that can't be read (a broken symlink, a device, no permission) reads as missing: these
  // facts are defaults, and none of them is worth failing the dry run over.
  const safe: FactsInput = { ...input, read: (file) => input.read(file).catch(() => null) }
  const found = await packages(safe)
  return {
    committers: await committers(input.root),
    packages: found,
    sessions: sessions(
      safe,
      found.map((entry) => entry.dir),
    ),
    gitHooks: await gitHooks(input.root, top),
    ci: await ci(input.root, top),
  }
}
