import { KNOWN_TAGS } from "../../core/files"
import type { PreCommitFilter } from "./resolve"

/** The part of a rule that picks its files, as init writes it and doctor suggests it. */
export interface RuleFilter {
  types?: string[]
  types_or?: string[]
  exclude_types?: string[]
  files?: string
}

/** A part of a hook's filter that is not carried over into its rule, and why. */
export interface LeftOut {
  /** As the config writes it: "types [python]", "files ^app/". */
  part: string
  why: string
}

/**
 * Tags rulecast gives every file identify (2.6) does: identify takes them from the extensions and
 * file names core/files.ts has too, and from a shebang rulecast also reads. A rule's `types` or
 * `types_or` of these takes in every file the hook's does. Not `text`, which identify decides from
 * a file's content.
 */
const NO_NARROWER = new Set([...KNOWN_TAGS].filter((tag) => tag !== "text" && tag !== "file"))
/**
 * Tags whose files in rulecast all have the tag in identify too: a rule's `exclude_types` of these
 * leaves out no file the hook checks. A symlink has none of them in either (core/files.ts
 * `tagsAt`). Not `python` (rulecast's takes .pyi), `ts` (.mts, .cts), tags a shebang gives
 * (rulecast reads more of them than identify), or `text`.
 */
const NO_WIDER = new Set([
  ...["pyi", "tsx", "jsx", "markdown", "mdx", "yaml", "json", "toml"],
  ...["css", "scss", "html", "sql", "go", "rust", "plain-text"],
])

const PYTHON_REGEX = "JavaScript does not read it as pre-commit's Python does"

/** Why each tag can't be carried, grouped: "python, ts: rulecast's takes in …; dockerfile: …". */
function tagReasons(tags: readonly string[], exclude: boolean): string {
  const reasons = new Map<string, string[]>()
  for (const tag of tags) {
    const why = !KNOWN_TAGS.has(tag)
      ? "rulecast has no such file type"
      : tag === "text"
        ? "pre-commit decides text from a file's content"
        : exclude
          ? "rulecast's takes in files pre-commit's does not"
          : "rulecast's takes in fewer files than pre-commit's"
    reasons.set(why, [...(reasons.get(why) ?? []), tag])
  }
  return [...reasons].map(([why, named]) => `${named.join(", ")}: ${why}`).join("; ")
}

/**
 * A pre-commit hook's filter as a rule's, for a project `project` below the git top ("" or ending
 * in "/"). Only what makes the rule the same as the hook's filter or wider is carried over, so the
 * rule never skips a change the hook checks. `stated`: the hook names any filter at all. `left`:
 * the parts left out, and why.
 */
export function ruleFilterOf(
  filter: PreCommitFilter,
  project: string,
): { rule: RuleFilter; stated: boolean; left: LeftOut[] } {
  const rule: RuleFilter = {}
  const left: LeftOut[] = []
  // `file` is every file. Leaving a tag out of `types` (all of them) only widens the rule.
  const all = filter.types.filter((tag) => tag !== "file")
  const kept = all.filter((tag) => NO_NARROWER.has(tag))
  if (kept.length > 0) rule.types = kept
  else if (all.length > 0) left.push({ part: `types [${all.join(", ")}]`, why: tagReasons(all, false) })
  if (filter.typesOr.length > 0 && !filter.typesOr.includes("file")) {
    const unsafe = filter.typesOr.filter((tag) => !NO_NARROWER.has(tag))
    if (unsafe.length === 0) rule.types_or = filter.typesOr
    else left.push({ part: `types_or [${filter.typesOr.join(", ")}]`, why: tagReasons(unsafe, false) })
  }
  // Excluding fewer files than the hook does only widens the rule.
  const excluded = filter.excludeTypes.filter((tag) => tag !== "file")
  const safe = excluded.filter((tag) => NO_WIDER.has(tag))
  if (safe.length > 0) rule.exclude_types = safe
  const unsafe = excluded.filter((tag) => !NO_WIDER.has(tag))
  if (unsafe.length > 0) left.push({ part: `exclude_types [${unsafe.join(", ")}]`, why: tagReasons(unsafe, true) })
  if (filter.files !== "") {
    const files = rebaseRegex(filter.files, project)
    if (typeof files === "object" && files !== null) left.push({ part: `files ${filter.files}`, why: files.why })
    else if (files !== null) rule.files = files
  }
  const stated = all.length > 0 || filter.typesOr.length > 0 || excluded.length > 0 || filter.files !== ""
  return { rule, stated, left }
}

/**
 * How a regex reads at its top level: whether JavaScript reads it as Python does, and whether it
 * has a top-level `|`. JavaScript reads it the same only when it compiles with the `u` flag (which
 * refuses Python's `\Z`, `\A` and `{,n}`, literal without it) and has no `\w`, `\d` or `\b`,
 * which match Unicode in Python and ASCII only in JavaScript.
 */
function readRegex(regex: string): { same: boolean; alternatives: boolean } {
  let alternatives = false
  let depth = 0
  let inClass = false
  for (let i = 0; i < regex.length; i++) {
    const char = regex[i]!
    if (char === "\\") {
      if (/[wWdDbB]/.test(regex[i + 1] ?? "")) return { same: false, alternatives }
      i++
    } else if (inClass) inClass = char !== "]"
    else if (char === "[") inClass = true
    else if (char === "(") depth++
    else if (char === ")") depth--
    else if (char === "|" && depth === 0) alternatives = true
  }
  try {
    new RegExp(regex, "u")
  } catch {
    return { same: false, alternatives }
  }
  return { same: true, alternatives }
}

/**
 * A pre-commit `files:` regex over paths from the git top, over paths from `project` instead. At
 * the top it is kept, when JavaScript reads it as Python does. Below, it must start with `^` and
 * the project's directory, which is taken off, and have no top-level `|`, whose other alternatives
 * would keep the directory. `{ why }`: it can't be carried over; null: every file.
 */
function rebaseRegex(regex: string, project: string): string | null | { why: string } {
  const read = readRegex(regex)
  if (!read.same) return { why: PYTHON_REGEX }
  if (project === "") return regex
  const cannot = { why: `it can't be made relative to ${project.replace(/\/$/, "")}` }
  // A lookbehind could look at the directory taken off.
  if (read.alternatives || !regex.startsWith("^") || /\(\?<[=!]/.test(regex)) return cannot
  let i = 1
  for (const char of project) {
    if (regex[i] === char) i++
    else if (regex[i] === "\\" && regex[i + 1] === char && !/[A-Za-z0-9]/.test(char)) i += 2
    else return cannot
  }
  // A quantifier on the directory's last character: it is not all literal.
  if (/^[*+?{]/.test(regex.slice(i))) return cannot
  const rest = regex.slice(i)
  return rest === "" ? null : `^${rest}`
}

/**
 * What a hook's filter makes of its rule in a project: `filter`, the rule's own; `none`, the hook
 * names none; `whole`, what it names takes in every file of the project; `left`, none of it can be
 * carried over.
 */
export type ScopeVerdict =
  | { kind: "filter"; rule: RuleFilter; left: { parts: string; why: string } | null }
  | { kind: "none" }
  | { kind: "whole" }
  | { kind: "left"; parts: string; why: string }

export function verdictOf(filter: PreCommitFilter, project: string): ScopeVerdict {
  const { rule, stated, left } = ruleFilterOf(filter, project)
  const said =
    left.length === 0
      ? null
      : { parts: left.map((one) => one.part).join(" and "), why: left.map((one) => one.why).join("; ") }
  if (!isEmptyFilter(rule)) return { kind: "filter", rule, left: said }
  if (!stated) return { kind: "none" }
  if (said === null) return { kind: "whole" }
  return { kind: "left", ...said }
}

/** How people name a file type: "Python", "TypeScript". */
const LABEL: Readonly<Record<string, string>> = {
  python: "Python",
  pyi: "Python stub",
  ts: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  jsx: "JSX",
  markdown: "Markdown",
  mdx: "MDX",
  yaml: "YAML",
  json: "JSON",
  toml: "TOML",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  shell: "shell",
  sql: "SQL",
  go: "Go",
  rust: "Rust",
  "plain-text": "plain-text",
  text: "text",
}
const label = (tag: string) => LABEL[tag] ?? tag

/**
 * The files a rule filter picks, said plainly: "a Python file", "Python or Python stub files",
 * "a file matching ^app/", "a file other than Markdown". `many`: plural.
 */
export function filesSaid(rule: RuleFilter, many = false): string {
  const kinds = [...(rule.types ?? []).map(label), ...(rule.types_or === undefined ? [] : [orList(rule.types_or)])]
  const noun = many ? "files" : "file"
  const head = kinds.length === 0 ? noun : `${kinds.join(" ")} ${noun}`
  const other = rule.exclude_types === undefined ? "" : ` other than ${orList(rule.exclude_types)}`
  const matching = rule.files === undefined ? "" : ` matching ${rule.files}`
  const said = `${head}${other}${matching}`
  return many ? said : `${/^[AEIOU]/i.test(said) ? "an" : "a"} ${said}`
}

const orList = (tags: readonly string[]) => {
  const labels = tags.map(label)
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`
}

/** A rule filter as YAML keys on one line: "`types: [python]`", "`files: "^app/"`". */
export function filterText(rule: RuleFilter): string {
  const keys = [
    ...(rule.types === undefined ? [] : [`types: [${rule.types.join(", ")}]`]),
    ...(rule.types_or === undefined ? [] : [`types_or: [${rule.types_or.join(", ")}]`]),
    ...(rule.exclude_types === undefined ? [] : [`exclude_types: [${rule.exclude_types.join(", ")}]`]),
    ...(rule.files === undefined ? [] : [`files: ${JSON.stringify(rule.files)}`]),
  ]
  return keys.map((key) => `\`${key}\``).join(" and ")
}

export const isEmptyFilter = (rule: RuleFilter) => Object.keys(rule).length === 0
