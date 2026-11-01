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
  /** It looks like a formatter or a fixer: offered, never ticked, since it would change files. */
  modifies: boolean
  /**
   * The config that declares it, relative to the project: `../lefthook.yml` for a project below the
   * git top. The rule cites it until the developer names a convention, when it is inside the project.
   */
  source: string
}

const LEFTHOOK_CONFIGS = ["lefthook.yml", ".lefthook.yml", "lefthook.yaml", ".lefthook.yaml"]

/** Names that say "I rewrite files": the hook is a formatter or a fixer. */
const FIXER_NAME =
  /format|fmt|fix|prettier|black|isort|autopep8|yapf|trailing-whitespace|end-of-file|mixed-line-ending|pretty/i
/** Flags that turn a checker into a fixer. */
const FIXER_FLAG = /(^|\s)(--fix\b|--write\b|-w\b|--in-place\b|format\b)/

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

function preCommitHooks(config: unknown, project: string, source: string): DetectedHook[] {
  if (!isObject(config) || !Array.isArray(config.repos)) return []
  const hooks: DetectedHook[] = []
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
      if (project !== "" && prefix !== null && !overlaps(prefix, project)) continue
      hooks.push({
        id: `hook/${hook.id}`,
        name: text(hook.name) || hook.id,
        detect: { "pre-commit": hook.id },
        files: null,
        modifies: FIXER_NAME.test(hook.id) || FIXER_FLAG.test(` ${entry} ${args}`),
        source,
      })
    }
  }
  return hooks
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

function lefthookJobs(jobs: unknown, hook: string, source: string, project: string, into: DetectedHook[]): void {
  const add = (name: string, job: JsonObject) => {
    const run = text(job.run)
    if (run === "" || runsRulecast(run)) return
    const glob = Array.isArray(job.glob) ? text(job.glob[0]) : text(job.glob)
    const root = rootPrefix(job.root)
    // A job's root: limits it to files below it, and its glob is matched under it.
    const files = glob === "" && root === "" ? null : rebaseGlob(`${root}${glob === "" ? "*" : glob}`, project)
    if (files === undefined) return
    into.push({
      id: `hook/${hook}-${name}`,
      name,
      detect: { lefthook: `${hook}/${name}` },
      files,
      modifies: job.stage_fixed === true || FIXER_FLAG.test(` ${run}`),
      source,
    })
  }
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      if (!isObject(job)) continue
      if (isObject(job.group)) lefthookJobs(job.group.jobs, hook, source, project, into)
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
  const prefix = project === "" || project === "." ? "" : `${project.replace(/\/+$/, "")}/`
  const up = prefix === "" ? "" : "../".repeat(prefix.split("/").length - 1)
  const hooks = preCommitHooks(load(await read(PRE_COMMIT_CONFIG)), prefix, `${up}${PRE_COMMIT_CONFIG}`)
  for (const file of LEFTHOOK_CONFIGS) {
    const config = load(await read(file))
    if (!isObject(config)) continue
    for (const [hook, body] of Object.entries(config)) {
      if (!isObject(body)) continue
      lefthookJobs(body.jobs, hook, `${up}${file}`, prefix, hooks)
      lefthookJobs(body.commands, hook, `${up}${file}`, prefix, hooks)
    }
    break
  }
  return hooks
}

/** The local rule init writes for a hook. */
export interface LocalRule {
  id: string
  name: string
  files?: string
  detect: Record<string, unknown>
  message: string
  context: string[]
}

export function hookRule(hook: DetectedHook): LocalRule {
  const runner = "lefthook" in hook.detect ? "lefthook" : "pre-commit"
  return {
    id: hook.id,
    name: `${hook.name} (${runner})`,
    ...(hook.files === null ? {} : { files: hook.files }),
    detect: { hook: hook.detect },
    message: "{{file}}:{{line}}: {{message}}",
    // A reference cannot leave its project: a config at the git top above it is not cited.
    context: hook.source.startsWith("../") ? [] : [`@${hook.source}`],
  }
}
