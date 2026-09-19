import { isMap, isScalar, isSeq, type Node, parseDocument, type YAMLMap, type YAMLSeq } from "yaml"

export interface CatalogRef {
  url: string
  rev: string
}

export interface RuleSelection {
  id: string
  /** null: keep the rule's own context; otherwise a `context` override. */
  context: string[] | null
}

export class ConfigTextError extends Error {}

const HEADER = [
  "# rulecast config: https://github.com/syv-ai/rulecast",
  "# Rules from rule repos are pinned by rev; add your own rules under repo: local.",
]

/** A plain YAML scalar when that is safe, a double-quoted one otherwise (e.g. a local path with spaces). */
const scalar = (value: string) => (/^[A-Za-z0-9_./:@~+-]+$/.test(value) ? value : JSON.stringify(value))

function ruleLines(rule: RuleSelection): string[] {
  const lines = [`- id: ${rule.id}`]
  if (rule.context !== null) lines.push("  context:", ...rule.context.map((ref) => `    - ${JSON.stringify(ref)}`))
  return lines
}

function repoLines(catalog: CatalogRef, rules: RuleSelection[]): string[] {
  return [
    `- repo: ${scalar(catalog.url)}`,
    `  rev: ${scalar(catalog.rev)}`,
    "  rules:",
    ...rules.flatMap(ruleLines).map((line) => `    ${line}`),
  ]
}

const indent = (lines: string[], column: number) => lines.map((line) => `${" ".repeat(column)}${line}\n`).join("")

/** The text of a new config: the catalog repo (when it has rules) and an empty local repo. */
export function newConfigText(catalog: CatalogRef | null, rules: RuleSelection[]): string {
  const lines = [...HEADER, "repos:"]
  if (catalog !== null && rules.length > 0) lines.push(...repoLines(catalog, rules).map((line) => `  ${line}`))
  lines.push("  - repo: local", "    rules: []")
  return `${lines.join("\n")}\n`
}

function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf("\n", offset - 1) + 1)
}

function lineEndAfter(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset)
  return newline === -1 ? text.length : newline + 1
}

interface Edit {
  start: number
  end: number
  insert: string
}

/** Inserts block-style items into a sequence: after its last item, or in place of an empty flow `[]`. */
function appendToSeq(text: string, seq: YAMLSeq, keyNode: Node, items: string[]): Edit {
  const [start, valueEnd] = seq.range!
  if (seq.flow) {
    const at = lineEndAfter(text, valueEnd)
    const rest = text.slice(valueEnd, at).trim()
    if (seq.items.length > 0 || (rest !== "" && !rest.startsWith("#"))) {
      throw new ConfigTextError("write repos and their rules in block style so rulecast init can add to them")
    }
    let from = start
    while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--
    const column = columnOf(text, keyNode.range![0]) + 2
    return { start: from, end: at, insert: `${rest === "" ? "" : ` ${rest}`}\n${indent(items, column)}` }
  }
  const column = columnOf(text, start)
  const prefix = valueEnd === 0 || text[valueEnd - 1] === "\n" ? "" : "\n"
  return { start: valueEnd, end: valueEnd, insert: `${prefix}${indent(items, column)}` }
}

function pairKey(map: YAMLMap, key: string): Node | null {
  const pair = map.items.find((item) => isScalar(item.key) && item.key.value === key)
  return pair && isScalar(pair.key) ? pair.key : null
}

/**
 * Adds catalog rules to an existing config, changing nothing else: new rules are appended to the catalog's
 * repo entry (rules already listed there are skipped), or a new entry for the catalog is appended to `repos`.
 */
export function addCatalogRules(text: string, catalog: CatalogRef, rules: RuleSelection[]): string {
  const doc = parseDocument(text, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new ConfigTextError(doc.errors[0]!.message)
  const root = doc.contents
  if (!isMap(root)) throw new ConfigTextError("the config must be a mapping")
  const reposKey = pairKey(root, "repos")
  const repos = root.get("repos", true)
  if (reposKey === null || !isSeq(repos)) throw new ConfigTextError("the config has no repos list")

  const entry = repos.items.find((item): item is YAMLMap => isMap(item) && item.get("repo") === catalog.url)
  let edit: Edit
  if (entry) {
    const listed = entry.get("rules", true)
    const rulesKey = pairKey(entry, "rules")
    if (!isSeq(listed) || rulesKey === null) throw new ConfigTextError(`${catalog.url} has no rules list`)
    const present = new Set(listed.items.map((item) => (isMap(item) ? item.get("id") : undefined)))
    const added = rules.filter((rule) => !present.has(rule.id))
    if (added.length === 0) return text
    edit = appendToSeq(text, listed, rulesKey, added.flatMap(ruleLines))
  } else {
    if (rules.length === 0) return text
    edit = appendToSeq(text, repos, reposKey, repoLines(catalog, rules))
  }
  const updated = text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
  const check = parseDocument(updated)
  if (check.errors.length > 0) throw new ConfigTextError(`could not update the config: ${check.errors[0]!.message}`)
  return updated
}
