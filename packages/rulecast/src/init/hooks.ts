import { parse } from "yaml"

import { PRE_COMMIT_CONFIG } from "../detectors/hook/resolve"

/** A hook the project already declares, as init offers it. */
export interface DetectedHook {
  /** The rule id init would give it: `hook/mypy`, `hook/pre-commit-typecheck`. */
  id: string
  /** The hook's own name. */
  name: string
  /** The `detect.hook` config that runs it. */
  detect: { "pre-commit": string } | { lefthook: string }
  /**
   * The rule's `files`, relative to the project, from a lefthook job's `root:` and glob; null: every
   * file, and the runner filters.
   */
  files: string | null
  /**
   * true: it looks like a formatter or a fixer, by its name, its flags or the package script it
   * runs. null: it runs a script init cannot see into (`runs`), so it may. false: neither.
   */
  modifies: boolean | null
  /** What a hook whose `modifies` is null runs: "npm run lint:all", "./scripts/generate-client.sh". */
  runs?: string
  /**
   * The config that declares it, relative to the project: `../lefthook.yml` for a project below the
   * git top. The rule cites it until the developer names a convention, when it is inside the project.
   */
  source: string
  /** The hook's own `description`, when its config gives one. */
  description?: string
}

/** A hook the config declares that init does not offer in this project, and why. */
export interface SkippedHook {
  name: string
  /** The config that declares it, as in DetectedHook. */
  source: string
  /** "glob <g> can't be rebased onto <dir>", "files only under <dir>" or "runs outside <dir>". */
  reason: string
  /** It belongs to another directory, not a glob init can't rebase: summarised when there are many. */
  elsewhere: boolean
}

/** What a repository's hook configs hold for one project. */
export interface HookScan {
  offered: DetectedHook[]
  skipped: SkippedHook[]
}

export const LEFTHOOK_CONFIGS = ["lefthook.yml", ".lefthook.yml", "lefthook.yaml", ".lefthook.yaml"]

/** Names that say "I rewrite files": the hook is a formatter or a fixer. */
const FIXER_NAME =
  /format|fmt|fix|prettier|black|isort|autopep8|yapf|trailing-whitespace|end-of-file|mixed-line-ending|pretty/i
/** Flags that turn a checker into a fixer. `format` only as a word: `format:check` is a script name. */
const FIXER_FLAG = /(^|\s)(--fix\b|--write\b|-w\b|--in-place\b|--apply(-unsafe)?\b|format(?=\s|$))/
/** In a package script `-w` is as often jest's workers as a write flag: only the long forms count there. */
const FIXER_FLAG_IN_SCRIPT = /(^|\s)(--fix\b|--write\b|--in-place\b|--apply(-unsafe)?\b|format(?=\s|$))/
/** Tools that rewrite files unless told to check. */
const WRITES_BY_DEFAULT = /(^|[\s;&|(])(black|isort|autopep8|yapf|ruff\s+format|cargo\s+fmt|go\s+fmt)(?=\s|$)/
const CHECK_ONLY = /(^|\s)(--check|--diff)\b/
/** Task runners whose tasks init does not read: what they run is unknown. */
const OTHER_RUNNER = /(^|[\s;&|(])(turbo|nx|lerna|npm-run-all|run-s|run-p|concurrently)(?=\s|$)/
/** A script file run directly or by an interpreter: `./scripts/gen.sh`, `uv run python scripts/x.py`. */
const SCRIPT_FILE =
  /(?:^|[;&|(]\s*|\b(?:bash|sh|zsh|python3?|node|tsx|ts-node|ruby|perl|bun|deno\s+run)\s+)((?:\.{0,2}\/)?[\w./-]+\.(?:sh|bash|py|js|mjs|cjs|ts|rb|pl))(?=$|[\s;&|)])/

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"])
/** Package-manager commands that are not scripts. */
const NOT_A_SCRIPT = new Set(["install", "i", "ci", "add", "exec", "dlx", "x", "remove", "update"])
/** Package-manager flags that take a value: `--filter web`, `--prefix web`, `-C dir`. */
const FLAG_WITH_VALUE = new Set(["--filter", "-F", "--prefix", "-C", "--dir", "--cwd", "--workspace", "-w"])

/**
 * The script a package-manager command runs: `npm run lint`, `pnpm --filter web lint`,
 * `yarn workspace web lint`, `pnpm run --silent lint`. `explicit`: it said `run`.
 */
function packageRun(command: string): { manager: string; name: string; explicit: boolean } | null {
  for (const segment of command.split(/[;&|()]+/)) {
    const tokens = segment.trim().split(/\s+/)
    const manager = tokens[0]!
    if (!MANAGERS.has(manager)) continue
    let explicit = false
    let i = 1
    while (i < tokens.length) {
      const token = tokens[i]!
      if (token === "run" || token === "run-script") {
        explicit = true
        i++
      } else if (manager === "yarn" && token === "workspace") i += 2
      else if (FLAG_WITH_VALUE.has(token)) i += 2
      else if (token.startsWith("-")) i++
      else break
    }
    const name = tokens[i]
    if (name !== undefined && !NOT_A_SCRIPT.has(name)) return { manager, name, explicit }
  }
  return null
}

/** The project's package.json scripts, by name. */
export type PackageScripts = Readonly<Record<string, string>>

const writesByItself = (command: string) => WRITES_BY_DEFAULT.test(command) && !CHECK_ONLY.test(command)

/**
 * Whether a hook's command changes files. A package script is looked up one level, in the
 * package.json at the git top, where the hook runs; past that, and for a script file or another
 * task runner, init cannot tell, and says what it runs instead of calling it read-only (plan 21, #5).
 */
function writes(command: string, scripts: PackageScripts): Pick<DetectedHook, "modifies" | "runs"> {
  if (FIXER_FLAG.test(` ${command}`) || writesByItself(command)) return { modifies: true }
  const file = SCRIPT_FILE.exec(command)
  if (file) return { modifies: null, runs: file[1]! }
  const runner = OTHER_RUNNER.exec(command)
  if (runner) return { modifies: null, runs: command.trim() }
  const run = packageRun(command)
  if (run === null) return { modifies: false }
  const body = Object.hasOwn(scripts, run.name) ? scripts[run.name] : undefined
  // `pnpm eslint`: a binary when no script has that name. `npm lint` is not a thing npm runs.
  if (body === undefined && !run.explicit && run.manager !== "npm") return { modifies: false }
  const runs = `${run.manager} run ${run.name}`
  if (body === undefined) return { modifies: null, runs }
  if (FIXER_FLAG_IN_SCRIPT.test(` ${body}`) || writesByItself(body)) return { modifies: true }
  const indirect = packageRun(body) !== null || SCRIPT_FILE.test(body) || OTHER_RUNNER.test(body)
  return indirect ? { modifies: null, runs } : { modifies: false }
}

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** A hook that runs rulecast would run rulecast from inside rulecast. */
const runsRulecast = (command: string) => /(^|[\s/])rulecast(\s|$)/.test(command) || /src\/cli\.ts\s+run/.test(command)

function load(source: string | null): unknown {
  if (source === null) return null
  try {
    return parse(source)
  } catch {
    return null
  }
}

/**
 * The literal start of a pre-commit `files:` regex anchored with `^`, or null when it has none that
 * can be read safely. pre-commit searches the regex in paths relative to the git top.
 */
function anchoredPrefix(regex: string): string | null {
  if (!regex.startsWith("^")) return null
  let literal = ""
  for (let i = 1; i < regex.length; i++) {
    const char = regex[i]!
    if (char === "\\") {
      const next = regex[i + 1]
      if (next === undefined || /[A-Za-z0-9]/.test(next)) break
      literal += next
      i++
    } else if (/[.*+?()[\]{}|^$]/.test(char)) {
      // A quantifier makes the last character optional or repeated: it is not part of the literal.
      if (/[*+?{]/.test(char)) literal = literal.slice(0, -1)
      break
    } else literal += char
  }
  return literal
}

/** Whether one of two literal path prefixes starts the other: some path could have both. */
const overlaps = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

/** The project's directory as init names it: "backend", from "backend/". */
const dirName = (prefix: string) => prefix.replace(/\/$/, "")

function preCommitHooks(
  config: unknown,
  project: string,
  source: string,
  scan: HookScan,
  scripts: PackageScripts,
): void {
  if (!isObject(config) || !Array.isArray(config.repos)) return
  const hooks = scan.offered
  for (const repo of config.repos) {
    // meta hooks check the config itself, not the code.
    if (!isObject(repo) || repo.repo === "meta" || !Array.isArray(repo.hooks)) continue
    for (const hook of repo.hooks) {
      if (!isObject(hook) || typeof hook.id !== "string") continue
      const args = Array.isArray(hook.args) ? hook.args.map(text).join(" ") : ""
      const entry = text(hook.entry)
      if (hook.id === "rulecast" || runsRulecast(entry)) continue
      // The runner applies `files:` itself; it only decides whether the hook can reach this project.
      // Python regexes are not rewritten into the rule's `files`: only a `^literal` start is read.
      const prefix = typeof hook.files === "string" ? anchoredPrefix(hook.files) : null
      const name = text(hook.name) || hook.id
      if (project !== "" && prefix !== null && !overlaps(prefix, project)) {
        // The directory the regex is anchored to: `^frontend/src/.*\.ts` is under frontend/src/.
        const under = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/") + 1) : prefix
        scan.skipped.push({ name, source, reason: `files only under ${under}`, elsewhere: true })
        continue
      }
      const description = text(hook.description)
      hooks.push({
        id: `hook/${idSegment(hook.id)}`,
        name,
        detect: { "pre-commit": hook.id },
        files: null,
        ...(FIXER_NAME.test(hook.id) ? { modifies: true } : writes(`${entry} ${args}`, scripts)),
        source,
        ...(description === "" ? {} : { description }),
      })
    }
  }
}

/** lefthook's glob, where `*` crosses directories, as a rule's `files` pattern. */
export function globToRegex(glob: string): string {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === "*") {
      while (glob[i + 1] === "*") i++
      out += ".*"
    } else if (char === "?") out += "."
    else if (char === "{") out += "("
    else if (char === "}") out += ")"
    else if (char === ",") out += "|"
    else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return `^${out}$`
}

const GLOB_SPECIAL = /[*?{]/

/**
 * A glob over paths relative to the git top, as a `files` regex over paths relative to `project`
 * (the project's directory below the top, "" or ending in "/"). undefined: no file of the project
 * can match, or the glob cannot be rebased exactly, so the job is not offered. null: every file.
 *
 * Exact cases: the glob's literal start names the project or a directory inside it (strip it); or
 * it names a directory above the project, goes on with `*` (which crosses directories) and ends in
 * one path segment, as `*.py`, `**` + `/*.py` or `**` + `/Makefile` do.
 */
export function rebaseGlob(glob: string, project: string): string | null | undefined {
  const special = glob.search(GLOB_SPECIAL)
  const literal = special === -1 ? glob : glob.slice(0, special)
  if (literal.startsWith(project)) {
    const inside = glob.slice(project.length)
    return inside === "" ? undefined : everything(globToRegex(inside))
  }
  if (!project.startsWith(literal) || glob[special] !== "*") return undefined
  const rest = glob.slice(special).replace(/^\*+/, "")
  if (!/[/*?]/.test(rest)) return everything(globToRegex(`*${rest}`))
  if (!rest.startsWith("/")) return undefined
  // `*/` + a name: the slash that ends the project's directory always satisfies the first part.
  const segment = rest.slice(1)
  const name = segment.replace(/^\*+/, "")
  if (/[/*?]/.test(name)) return undefined
  return name === segment ? `^(.*/)?${globToRegex(name).slice(1)}` : everything(globToRegex(`*${name}`))
}

/** `^.*$` matches every file, which no `files` at all says. */
const everything = (regex: string): string | null => (regex === "^.*$" ? null : regex)

/** A lefthook `root:` as a directory prefix relative to the git top: "", or ending in "/". */
function rootPrefix(root: unknown): string {
  const dir = text(root)
    .replace(/^(\.\/)+/, "")
    .replace(/\/*$/, "")
  return dir === "" || dir === "." ? "" : `${dir}/`
}

function lefthookJobs(
  jobs: unknown,
  hook: string,
  source: string,
  project: string,
  scan: HookScan,
  scripts: PackageScripts,
): void {
  const add = (name: string, job: JsonObject) => {
    const run = text(job.run)
    if (run === "" || runsRulecast(run)) return
    const glob = Array.isArray(job.glob) ? text(job.glob[0]) : text(job.glob)
    const root = rootPrefix(job.root)
    // A job's root: limits it to files below it, and its glob is matched under it.
    const full = `${root}${glob === "" ? "*" : glob}`
    const files = glob === "" && root === "" ? null : rebaseGlob(full, project)
    if (files === undefined) {
      // No file of the project can match when the glob's literal start leads elsewhere.
      const special = full.search(GLOB_SPECIAL)
      const literal = special === -1 ? full : full.slice(0, special)
      const elsewhere = !overlaps(literal, project)
      const reason = elsewhere
        ? `runs outside ${dirName(project)}`
        : `glob ${full} can't be rebased onto ${dirName(project)}`
      scan.skipped.push({ name, source, reason, elsewhere })
      return
    }
    scan.offered.push({
      id: `hook/${idSegment(`${hook}-${name}`)}`,
      name,
      detect: { lefthook: `${hook}/${name}` },
      files,
      ...(job.stage_fixed === true ? { modifies: true } : writes(run, scripts)),
      source,
    })
  }
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      if (!isObject(job)) continue
      if (isObject(job.group)) lefthookJobs(job.group.jobs, hook, source, project, scan, scripts)
      else if (typeof job.name === "string") add(job.name, job)
    }
  } else if (isObject(jobs)) {
    for (const [name, job] of Object.entries(jobs)) if (isObject(job)) add(name, job)
  }
}

/**
 * The hooks a repository declares in .pre-commit-config.yaml and lefthook.yml, read as files: init
 * offers them before anything is installed, so no runner is asked. husky's hooks are shell scripts
 * with nothing structured to read, so they are not offered.
 *
 * `read` reads at the git top, where the runners and the hook detector read them. `project` is the
 * project's directory relative to the git top ("" at the top): each hook's files are rebased onto
 * it, and a hook that cannot reach the project is left out.
 */
export async function detectHooks(
  read: (file: string) => Promise<string | null>,
  project = "",
): Promise<DetectedHook[]> {
  return (await scanHooks(read, project)).offered
}

/**
 * A hook's name as one segment of a rule id. A lefthook job's name is free text ("lint typescript")
 * and a local pre-commit id may hold underscores or capitals; a rule id may not (plan 21).
 */
function idSegment(name: string): string {
  const segment = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return segment === "" ? "hook" : segment
}

/**
 * Two names that make the same id: the later ones get -2, -3. The same hook listed twice (one
 * pre-commit id in two entries) is offered once, since its rule runs every entry with that id.
 */
function distinctIds(hooks: DetectedHook[]): DetectedHook[] {
  const seen = new Set<string>()
  const detects = new Set<string>()
  const out: DetectedHook[] = []
  for (const hook of hooks) {
    const detect = JSON.stringify(hook.detect)
    if (detects.has(detect)) continue
    detects.add(detect)
    let id = hook.id
    for (let n = 2; seen.has(id); n++) id = `${hook.id}-${n}`
    seen.add(id)
    out.push(id === hook.id ? hook : { ...hook, id })
  }
  return out
}

function packageScripts(text: string | null): PackageScripts {
  try {
    const scripts = text === null ? null : (JSON.parse(text) as { scripts?: unknown }).scripts
    if (!isObject(scripts)) return {}
    return Object.fromEntries(
      Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
  } catch {
    return {}
  }
}

/** detectHooks, with the hooks left out of this project and why: init says so rather than drop them. */
export async function scanHooks(read: (file: string) => Promise<string | null>, project = ""): Promise<HookScan> {
  const prefix = project === "" || project === "." ? "" : `${project.replace(/\/+$/, "")}/`
  const up = prefix === "" ? "" : "../".repeat(prefix.split("/").length - 1)
  const scan: HookScan = { offered: [], skipped: [] }
  const scripts = packageScripts(await read("package.json"))
  preCommitHooks(load(await read(PRE_COMMIT_CONFIG)), prefix, `${up}${PRE_COMMIT_CONFIG}`, scan, scripts)
  for (const file of LEFTHOOK_CONFIGS) {
    const config = load(await read(file))
    if (!isObject(config)) continue
    for (const [hook, body] of Object.entries(config)) {
      if (!isObject(body)) continue
      lefthookJobs(body.jobs, hook, `${up}${file}`, prefix, scan, scripts)
      lefthookJobs(body.commands, hook, `${up}${file}`, prefix, scan, scripts)
    }
    break
  }
  return { ...scan, offered: distinctIds(scan.offered) }
}

/** Past this many, the hooks of other directories in one config are counted, not listed. */
const LIST_ELSEWHERE = 3

/** The lines init prints for the hooks it does not offer: one per hook, or a count for other directories. */
export function notOfferedLines(skipped: readonly SkippedHook[]): string[] {
  const lines: string[] = []
  for (const source of [...new Set(skipped.map((hook) => hook.source))]) {
    const from = skipped.filter((hook) => hook.source === source)
    const elsewhere = from.filter((hook) => hook.elsewhere)
    const listed = elsewhere.length > LIST_ELSEWHERE ? from.filter((hook) => !hook.elsewhere) : from
    for (const hook of listed) lines.push(`Not offered from ${source}: ${hook.name} (${hook.reason})`)
    if (listed.length < from.length) {
      lines.push(`Not offered from ${source}: ${elsewhere.length} hooks for other directories`)
    }
  }
  return lines
}

/** The local rule init writes for a hook. */
export interface LocalRule {
  id: string
  name: string
  description?: string
  files?: string
  detect: Record<string, unknown>
  message: string
  context: string[]
}

export function hookRule(hook: DetectedHook): LocalRule {
  const runner = "lefthook" in hook.detect ? "lefthook" : "pre-commit"
  const outside = hook.source.startsWith("../")
  // Said in the rule, since its findings come without a doc section.
  const note = outside
    ? `Runs the ${runner === "lefthook" ? "lefthook job" : "pre-commit hook"} ${hook.name} from ${hook.source}. No doc section: the config is outside this project.`
    : ""
  const description = [hook.description ?? "", note].filter((part) => part !== "").join(" ")
  return {
    id: hook.id,
    name: `${hook.name} (${runner})`,
    ...(description === "" ? {} : { description }),
    ...(hook.files === null ? {} : { files: hook.files }),
    detect: { hook: hook.detect },
    message: "{{file}}:{{line}}: {{message}}",
    // A reference cannot leave its project: a config at the git top above it is not cited.
    context: outside ? [] : [`@${hook.source}`],
  }
}
