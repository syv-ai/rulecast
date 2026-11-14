import { parse } from "yaml"

import {
  FILE_TEMPLATE,
  globsOf,
  HK_CONFIGS,
  HK_PRE_PUSH_UNREAD,
  type HkPlan,
  hkStepNeverRuns,
  LEFTHOOK_CONFIGS,
  PRE_COMMIT_CONFIG,
  preCommitScope,
} from "../detectors/hook/resolve"
import { filesSaid, type RuleFilter, verdictOf } from "../detectors/hook/scope"

/** A hook the project already declares, as init offers it. */
export interface DetectedHook {
  /** The rule id init would give it: `hook/mypy`, `hook/pre-commit-typecheck`. */
  id: string
  /** The hook's own name. */
  name: string
  /** The `detect.hook` config that runs it. */
  detect: { "pre-commit": string } | { lefthook: string } | { hk: string }
  /**
   * The rule's `files`, relative to the project, from a lefthook job's `root:` and glob; null: every
   * file, and the runner filters.
   */
  files: string | null
  /**
   * The rule's type tags, from an always_run pre-commit hook's own `types`, `types_or` and
   * `exclude_types`: pre-commit would run it on every commit, so the rule says when it matters.
   */
  types?: string[]
  types_or?: string[]
  exclude_types?: string[]
  /** Why the rule has the filter above (or `files`) that the runner would not apply, said in its description. */
  scoped?: string
  /**
   * Why it runs on every change, when no filter could be given it: "always_run, and it names no
   * files or types". Said where init offers it.
   */
  everyChange?: string
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
  /** It runs a linter init also offers as a rule (`linter/ruff`): that rule is offered instead. */
  sameAs?: string
  /**
   * What makes it exit 0 whatever it finds, as written: "|| true", "; exit 0", "set +e". A rule on
   * it never fires (#77).
   */
  neverFails?: string
  /**
   * The git stages it runs at: pre-commit's `stages` (else the config's `default_stages`), or the
   * lefthook hook it is under. Absent: pre-commit's default, every stage that runs on commit.
   * `commit-msg` checks the message, not the code; `manual` runs only when asked for (#78).
   */
  stages?: string[]
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

export { LEFTHOOK_CONFIGS }

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

/** `bash -c '…'` (or sh, zsh, dash, with flags such as -e): what follows is a script. */
const SHELL_C = /^\s*(?:(?:\S*\/)?env\s+)?(?:\S*\/)?(?:ba|z|da)?sh\s+(?:-\w+\s+)*?-\w*c\s+(['"])/

/**
 * The script a `bash -c '…'` command runs, or the command itself when it is not one, and whether
 * the shell was started with -e (`sh -ec '…'`, `bash -e -c '…'`).
 */
function shellBody(command: string): { body: string; errexit: boolean } {
  const match = SHELL_C.exec(command)
  if (!match) return { body: command, errexit: false }
  const quote = match[1]!
  let body = ""
  for (let i = match.index + match[0].length; i < command.length; i++) {
    const char = command[i]!
    if (quote === '"' && char === "\\" && i + 1 < command.length) body += char + command[++i]!
    else if (char !== quote) body += char
    // `'\''` closes the quote, adds a quote and opens it again.
    else if (quote === "'" && command.startsWith("\\''", i + 1)) {
      body += "'"
      i += 3
    } else break
  }
  return { body, errexit: /\s-[a-z]*e[a-z]*\s/.test(match[0]) }
}

/** `set -e`, `set -euo pipefail`, `set -o errexit`: a failing command ends the script with its code. */
const ERREXIT = /\bset\s+(?:-[a-z]*e[a-z]*\b|(?:-[a-z]+\s+)*-o\s+errexit\b)/
/** An exit with a code that may not be 0: `exit 1`, `exit $?`, `exit $status`. */
const FAILING_EXIT = /\bexit\s+(?:0*[1-9]|\$)/

/** One part of a shell script's top level: a command's text, or the operator after it. */
type Piece = { op: null; text: string } | { op: ";" | "&" | "&&" | "||" | "|" }

/**
 * A script's top level as commands and operators, leaving out comments and what is inside quotes,
 * `$(…)`, `(…)` and `{…}`: `rm -f x || true; mypy .` is `rm -f x`, `||`, `true`, `;`, `mypy .`.
 * A newline separates commands as `;` does, unless a backslash continues the line.
 */
function topLevel(script: string): Piece[] {
  const pieces: Piece[] = []
  let text = ""
  // The last character added, kept apart: reading it off `text` makes V8 flatten the growing string
  // every time, which turns a long command quadratic.
  let prev = ""
  const add = (part: string) => {
    text += part
    prev = part.at(-1) ?? prev
  }
  let quote: string | null = null
  let depth = 0
  const end = (op: Piece["op"]) => {
    pieces.push({ op: null, text: text.trim() })
    if (op !== null) pieces.push({ op } as Piece)
    text = ""
    prev = ""
  }
  for (let i = 0; i < script.length; i++) {
    const char = script[i]!
    if (quote !== null) {
      if (char === "\\" && quote !== "'") add(char + (script[++i] ?? ""))
      else {
        add(char)
        if (char === quote) quote = null
      }
      continue
    }
    if (char === "\\") {
      if (script[i + 1] === "\n") i++
      else add(char + (script[++i] ?? ""))
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char
      add(char)
    } else if (char === "(" || char === "{") {
      depth++
      add(char)
    } else if (char === ")" || char === "}") {
      depth = Math.max(0, depth - 1)
      add(char)
    } else if (char === "#" && depth === 0 && (prev === "" || /[\s;&|]/.test(prev))) {
      while (i + 1 < script.length && script[i + 1] !== "\n") i++
    } else if (depth > 0 || (char === "&" && (prev === "<" || prev === ">" || script[i + 1] === ">"))) add(char)
    else if (char === "\n" || char === ";") end(";")
    else if (char === "&" || char === "|") {
      const double = script[i + 1] === char
      if (double) i++
      end(double ? (char === "&" ? "&&" : "||") : char)
    } else add(char)
  }
  end(null)
  // Blank lines and a trailing `;` leave empty commands and repeated separators: they say nothing.
  const out: Piece[] = []
  for (const piece of pieces) {
    if (piece.op === null ? piece.text === "" : out.length === 0 || out.at(-1)!.op !== null) continue
    out.push(piece)
  }
  while (out.length > 0 && out.at(-1)!.op !== null) out.pop()
  return out
}

/** A command that always succeeds: `true`, `:`, `exit 0`, `{ true; }`, or one that only prints. */
const ALWAYS_ZERO = /^(?:true|:|exit\s+0|\{\s*(?:true|:)\s*;?\s*\}|(?:echo|printf)(?:\s.*)?)$/s

/**
 * How a script exits 0 whatever its checks find, as written: its last command list ends in
 * `|| true` (or `|| :`, `|| exit 0`, `|| echo …`), is `exit 0` or `true` on its own, or pipes into
 * `tee` without pipefail. Only the end counts: `rm -f x || true; mypy .` fails when mypy does, and
 * so does `set +e; mypy .; status=$?; exit $status`. A bare `exit 0` at the end counts only when
 * nothing could stop the script before it (no set -e, no earlier `exit 1`). `tail`: its last command.
 */
function exitSwallowed(script: string, shellErrexit = false): { evidence: string | null; tail: string } {
  const pieces = topLevel(script)
  let from = pieces.length
  while (from > 0 && pieces[from - 1]!.op !== ";" && pieces[from - 1]!.op !== "&") from--
  const list = pieces.slice(from)
  const tail = list.at(-1)
  const op = list.at(-2)
  if (tail === undefined || tail.op !== null) return { evidence: null, tail: "" }
  // A `sh -c '…'` that is the last command exits as its script does: the script decides.
  if (SHELL_C.test(tail.text)) {
    const shell = shellBody(tail.text)
    return exitSwallowed(shell.body, shell.errexit)
  }
  const command = tail.text.replace(/\s+/g, " ")
  if (op === undefined) {
    // A bare `exit 0` at the end is reached only when nothing before it stopped the script: under
    // set -e a failing check does, and so does an earlier `exit 1` or `exit $?`.
    const earlier = pieces.slice(0, from)
    const fails =
      shellErrexit ||
      ERREXIT.test(script) ||
      earlier.some((piece) => piece.op === null && FAILING_EXIT.test(piece.text))
    const alone = !fails && /^(?:true|:|exit 0)$/.test(command)
    return { evidence: alone ? (from > 0 ? `; ${command}` : command) : null, tail: command }
  }
  if (op.op === "||" && ALWAYS_ZERO.test(command)) return { evidence: `|| ${command}`, tail: command }
  if (op.op === "|" && /^tee\b/.test(command) && !/\bpipefail\b/.test(script)) {
    return { evidence: "| tee", tail: command }
  }
  return { evidence: null, tail: command }
}

/**
 * Whether a hook's command can never fail, and the part that says so. The package script its last
 * command runs is looked at too, one level down, as for `modifies`: in `npm run prep && npm run
 * lint`, lint's.
 */
function swallowsExit(command: string, scripts: PackageScripts): string | undefined {
  const own = exitSwallowed(command)
  if (own.evidence !== null) return own.evidence
  const run = packageRun(own.tail)
  const body = run !== null && Object.hasOwn(scripts, run.name) ? scripts[run.name] : undefined
  const inScript = body === undefined ? null : exitSwallowed(body).evidence
  return inScript === null ? undefined : `${inScript} (in ${run!.manager} run ${run!.name})`
}

/** A hook's `stages`, when they are a list of names. */
function stagesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((stage): stage is string => typeof stage === "string")
  return names.length === 0 ? undefined : names
}

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

/**
 * What an always_run or pass_filenames: false pre-commit hook needs in its rule. pre-commit runs an
 * always_run hook whatever changed; a pass_filenames: false one it still skips when no file matches
 * its filter, so only one with no filter at all runs on every change.
 */
async function wholeProject(
  repo: Record<string, unknown>,
  hook: Record<string, unknown>,
  project: string,
): Promise<Pick<DetectedHook, "types" | "types_or" | "exclude_types" | "scoped" | "everyChange"> & RuleFilter> {
  const scope = await preCommitScope(repo, hook)
  const why = scope.alwaysRun === true ? "always_run" : scope.passFilenames === false ? "pass_filenames: false" : null
  if (why === null) return {}
  if (scope.filter === null) {
    // A remote hook with no clone and no filter of its own in the config.
    return why === "always_run"
      ? { everyChange: `${why}, and its manifest isn't on disk, so its filter is unknown` }
      : {}
  }
  const verdict = verdictOf(scope.filter, project)
  if (verdict.kind === "none") return { everyChange: `${why}, and it names no files or types` }
  // pre-commit takes in every file here too, so it runs a pass_filenames: false hook on every change.
  if (verdict.kind === "whole")
    return { everyChange: `${why}, and its files and types take in every file in this project` }
  if (why !== "always_run") return {}
  if (verdict.kind === "left")
    return { everyChange: `${why}, and its ${verdict.parts} can't be carried over (${verdict.why})` }
  const rule = verdict.rule
  const scoped =
    `Runs only when ${filesSaid(rule)} changed: the hook is always_run, so pre-commit would run it on every commit. ` +
    `Changing only a config file it reads${configExample(rule)} doesn't run it.` +
    (verdict.left === null ? "" : ` Left out of the hook's filter: ${verdict.left.parts} (${verdict.left.why}).`)
  return { ...rule, scoped }
}

/** The config file a tool for these types usually reads, when they all name the same one. */
const CONFIG_FOR: Readonly<Record<string, string>> = {
  python: "pyproject.toml",
  pyi: "pyproject.toml",
  ts: "tsconfig.json",
  tsx: "tsconfig.json",
  javascript: "package.json",
  jsx: "package.json",
  rust: "Cargo.toml",
  go: "go.mod",
}

/** ", such as pyproject.toml,", or "" when the rule's types don't say which config. */
function configExample(rule: RuleFilter): string {
  const tags = [...(rule.types ?? []), ...(rule.types_or ?? [])]
  const configs = new Set(tags.map((tag) => CONFIG_FOR[tag]))
  const [config] = configs
  return configs.size === 1 && config !== undefined ? `, such as ${config},` : ""
}

async function preCommitHooks(
  config: unknown,
  project: string,
  source: string,
  scan: HookScan,
  scripts: PackageScripts,
): Promise<void> {
  if (!isObject(config) || !Array.isArray(config.repos)) return
  const hooks = scan.offered
  const defaultStages = stagesOf(config.default_stages)
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
      const neverFails = swallowsExit(`${entry} ${args}`, scripts)
      const stages = stagesOf(hook.stages) ?? defaultStages
      const { files, ...scope } = await wholeProject(repo, hook, project)
      hooks.push({
        id: `hook/${idSegment(hook.id)}`,
        name,
        detect: { "pre-commit": hook.id },
        files: files ?? null,
        ...scope,
        ...(FIXER_NAME.test(hook.id) ? { modifies: true } : writes(`${entry} ${args}`, scripts)),
        source,
        ...(description === "" ? {} : { description }),
        ...(neverFails === undefined ? {} : { neverFails }),
        ...(stages === undefined ? {} : { stages }),
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
    else if (char === "[" && glob.indexOf("]", i + 2) !== -1) {
      // A class, `[!…]` negated; `]` right after the opening is part of it.
      const close = glob.indexOf("]", i + 2)
      const body = glob.slice(i + 1, close)
      const negated = body.startsWith("!")
      out += `[${negated ? "^" : ""}${(negated ? body.slice(1) : body).replace(/[\\^]/g, "\\$&")}]`
      i = close
    } else if (char === "{") out += "("
    else if (char === "}") out += ")"
    else if (char === ",") out += "|"
    else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return `^${out}$`
}

const GLOB_SPECIAL = /[*?{[]/

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

/**
 * A lefthook job's globs and root (a prefix: "" or ending in "/"), as one `files` regex over paths
 * from `project`. lefthook runs the job when any glob matches a file's path from the git top, and
 * keeps the files under its root (lefthook 2.1). null: every file. `skip`: why the job is not
 * offered: no glob reaches the project, its root is elsewhere, or a glob that reaches the project
 * can't be rebased exactly, and the others alone would be narrower than the job.
 */
export function rebaseJob(
  globs: readonly string[],
  root: string,
  project: string,
): { files: string | null } | { skip: string; elsewhere: boolean } {
  if (root !== "" && !overlaps(root, project)) return { skip: `runs outside ${dirName(project)}`, elsewhere: true }
  // The root's part below the project, which a file's path from the project must start with.
  const under = root.startsWith(project) ? root.slice(project.length) : ""
  const prefix = under.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (globs.length === 0) return { files: under === "" ? null : `^${prefix}` }
  const rebased: string[] = []
  let every = false
  for (const glob of globs) {
    const one = rebaseGlob(glob, project)
    if (one === null) every = true
    else if (one !== undefined) rebased.push(one)
    else {
      // No file of the project can match when the glob's literal start leads elsewhere.
      const special = glob.search(GLOB_SPECIAL)
      const literal = special === -1 ? glob : glob.slice(0, special)
      if (overlaps(literal, project)) {
        return { skip: `glob ${glob} can't be rebased onto ${dirName(project)}`, elsewhere: false }
      }
    }
  }
  if (!every && rebased.length === 0) return { skip: `runs outside ${dirName(project)}`, elsewhere: true }
  if (under === "") return { files: every ? null : rebased.join("|") }
  // Under the root, and matching a glob: each glob's regex starts with ^, which the root's lookahead follows.
  if (every) return { files: `^${prefix}` }
  return { files: rebased.map((one) => `^(?=${prefix})${one.slice(1)}`).join("|") }
}

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
    const globs = globsOf(job.glob)
    const root = rootPrefix(job.root)
    const rebased = rebaseJob(globs, root, project)
    if ("skip" in rebased) {
      scan.skipped.push({ name, source, reason: rebased.skip, elsewhere: rebased.elsewhere })
      return
    }
    const files = rebased.files
    const neverFails = swallowsExit(run, scripts)
    // rulecast runs the job's command itself: one with no files template checks what it likes.
    const everyChange =
      globs.length === 0 && root === "" && !FILE_TEMPLATE.test(run)
        ? "its command is given no files, and it names no glob or root"
        : undefined
    scan.offered.push({
      id: `hook/${idSegment(`${hook}-${name}`)}`,
      name,
      detect: { lefthook: `${hook}/${name}` },
      files,
      ...(everyChange === undefined ? {} : { everyChange }),
      ...(job.stage_fixed === true ? { modifies: true } : writes(run, scripts)),
      source,
      ...(neverFails === undefined ? {} : { neverFails }),
      stages: [hook],
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

/**
 * The hk hooks whose steps init reads, in this order: a step in several is offered from the first,
 * with every hook it is in as its stages. `check` is hk's own hook for `hk check`. commit-msg steps
 * are read to say why they are not offered. pre-push is never planned: hk asks the git remote.
 */
const HK_HOOKS = ["pre-commit", "check", "commit-msg"]

/**
 * How init reads hk's steps: `plan` asks hk for one hook's plan; `unread` says why hk is not asked
 * (asking would download its Pkl package). Absent: hk is not installed.
 */
export type HkReader = { plan: (hook: string) => Promise<HkPlan> } | { unread: string }

async function hkHooks(
  read: (file: string) => Promise<string | null>,
  up: string,
  scan: HookScan,
  hk: HkReader | undefined,
): Promise<void> {
  let config: string | undefined
  let text = ""
  for (const file of HK_CONFIGS) {
    const found = await read(file)
    if (found === null) continue
    config = file
    text = found
    break
  }
  if (config === undefined) return
  const source = `${up}${config}`
  const skip = (name: string, reason: string) => scan.skipped.push({ name, source, reason, elsewhere: false })
  if (hk === undefined) return void skip("hk steps", "hk is not installed, so its steps can't be read")
  if ("unread" in hk)
    return void skip("hk steps", `not read: ${hk.unread}; \`hk run pre-commit --plan\` downloads it and lists them`)
  const offered = new Map<string, DetectedHook>()
  const seen = new Set<string>()
  for (const hook of HK_HOOKS) {
    const plan = await hk.plan(hook)
    if ("missing" in plan) continue
    if ("error" in plan) return void skip("hk steps", `hk could not read them: ${plan.error}`)
    for (const step of plan.steps) {
      const known = offered.get(step.name)
      if (known !== undefined) known.stages = [...(known.stages ?? []), hook]
      if (seen.has(step.name)) continue
      seen.add(step.name)
      if (hook === "commit-msg") {
        skip(step.name, "commit-msg: checks the commit message, and a hook rule runs on files")
        continue
      }
      const never = hkStepNeverRuns(step)
      if (never !== null) {
        skip(step.name, `hk never runs it to check: ${never}`)
        continue
      }
      // Run with --check, the step never fixes: hk runs its check command only.
      const detected: DetectedHook = {
        id: `hook/${idSegment(`${hook}-${step.name}`)}`,
        name: step.name,
        detect: { hk: `${hook}/${step.name}` },
        files: null,
        modifies: false,
        source,
        stages: [hook],
      }
      offered.set(step.name, detected)
      scan.offered.push(detected)
    }
  }
  if (/["']pre-push["']/.test(text)) skip("hk pre-push steps", HK_PRE_PUSH_UNREAD)
}

/** detectHooks, with the hooks left out of this project and why: init says so rather than drop them. */
export async function scanHooks(
  read: (file: string) => Promise<string | null>,
  project = "",
  hk?: HkReader,
): Promise<HookScan> {
  const prefix = project === "" || project === "." ? "" : `${project.replace(/\/+$/, "")}/`
  const up = prefix === "" ? "" : "../".repeat(prefix.split("/").length - 1)
  const scan: HookScan = { offered: [], skipped: [] }
  const scripts = packageScripts(await read("package.json"))
  await preCommitHooks(load(await read(PRE_COMMIT_CONFIG)), prefix, `${up}${PRE_COMMIT_CONFIG}`, scan, scripts)
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
  await hkHooks(read, up, scan, hk)
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
  types?: string[]
  types_or?: string[]
  exclude_types?: string[]
  detect: Record<string, unknown>
  message: string
  context: string[]
  context_by_rule?: Record<string, string[]>
}

export function hookRule(hook: DetectedHook): LocalRule {
  const runner = "lefthook" in hook.detect ? "lefthook" : "hk" in hook.detect ? "hk" : "pre-commit"
  const what = { lefthook: "lefthook job", hk: "hk step", "pre-commit": "pre-commit hook" }[runner]
  const outside = hook.source.startsWith("../")
  // Said in the rule, since its findings come without a doc section.
  const note = outside
    ? `Runs the ${what} ${hook.name} from ${hook.source}. No doc section: the config is outside this project.`
    : ""
  const description = [hook.description ?? "", hook.scoped ?? "", note].filter((part) => part !== "").join(" ")
  return {
    id: hook.id,
    name: `${hook.name} (${runner})`,
    ...(description === "" ? {} : { description }),
    ...(hook.files === null ? {} : { files: hook.files }),
    ...(hook.types === undefined ? {} : { types: hook.types }),
    ...(hook.types_or === undefined ? {} : { types_or: hook.types_or }),
    ...(hook.exclude_types === undefined ? {} : { exclude_types: hook.exclude_types }),
    detect: { hook: hook.detect },
    message: "{{file}}:{{line}}: {{message}}",
    // A reference cannot leave its project: a config at the git top above it is not cited.
    context: outside ? [] : [`@${hook.source}`],
  }
}
