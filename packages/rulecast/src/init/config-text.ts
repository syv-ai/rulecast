import { isMap, isScalar, isSeq, type Node, parseDocument, type YAMLMap, type YAMLSeq } from "yaml"

import type { LocalRule } from "./hooks"

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

function mappingLines(value: Record<string, unknown>): string[] {
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object" && item !== null
      ? [`${key}:`, ...mappingLines(item as Record<string, unknown>).map((line) => `  ${line}`)]
      : [`${key}: ${scalar(String(item))}`],
  )
}

/** A whole rule under `repo: local`, written out in block style. */
function localRuleLines(rule: LocalRule): string[] {
  return [
    `- id: ${rule.id}`,
    `  name: ${scalar(rule.name)}`,
    ...(rule.description === undefined ? [] : [`  description: ${JSON.stringify(rule.description)}`]),
    ...(rule.files === undefined ? [] : [`  files: ${JSON.stringify(rule.files)}`]),
    "  detect:",
    ...mappingLines(rule.detect).map((line) => `    ${line}`),
    `  message: ${JSON.stringify(rule.message)}`,
    ...(rule.context.length === 0 ? [] : ["  context:", ...rule.context.map((ref) => `    - ${JSON.stringify(ref)}`)]),
  ]
}

const indent = (lines: string[], column: number) => lines.map((line) => `${" ".repeat(column)}${line}\n`).join("")

/** The top-level settings init writes from the interview's answers (plan 20). */
export interface ConfigSettings {
  /** Where new conventions are written, relative to the config. */
  conventions?: string | null
  /** The model for llm rules: the developer agreed to llm rules. */
  llmModel?: string | null
  llmProvider?: string | null
}

function settingLines(settings: ConfigSettings): string[] {
  const lines: string[] = []
  if (settings.conventions) lines.push(`conventions: ${scalar(settings.conventions)}`)
  const llm = [
    ...(settings.llmProvider ? [`  provider: ${scalar(settings.llmProvider)}`] : []),
    ...(settings.llmModel ? [`  model: ${scalar(settings.llmModel)}`] : []),
  ]
  if (llm.length > 0) lines.push("llm:", ...llm)
  return lines
}

/** The text of a new config: its settings, then the local repo with any `local` rules. */
export function newConfigText(local: LocalRule[] = [], settings: ConfigSettings = {}): string {
  const lines = [...HEADER, ...settingLines(settings), "repos:"]
  if (local.length === 0) lines.push("  - repo: local", "    rules: []")
  else lines.push("  - repo: local", "    rules:", ...local.flatMap(localRuleLines).map((line) => `      ${line}`))
  return `${lines.join("\n")}\n`
}

/** One setting init changed: `from` is null when the config did not have it. */
export interface SettingChange {
  key: "conventions" | "llm.model" | "llm.provider"
  from: string | null
  to: string
}

/**
 * Sets init's settings in an existing config, changing only those values: every other byte, comments
 * and spacing included, stays as it is. A key that already holds the value is left alone, so a re-run
 * changes nothing; `changes` says what was added and what was replaced, and with what.
 */
export function setSettings(text: string, settings: ConfigSettings): { text: string; changes: SettingChange[] } {
  const doc = parseDocument(text, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new ConfigTextError(doc.errors[0]!.message)
  const root = doc.contents
  if (!isMap(root) || root.flow) throw new ConfigTextError("the config must be a block mapping")
  const edits: Edit[] = []
  const changes: SettingChange[] = []
  const before: string[] = []

  const replace = (node: Node, value: string) => {
    const [start, end] = node.range!
    edits.push({ start, end, insert: scalar(value) })
  }
  const current = (node: unknown): string | null => (isScalar(node) ? String(node.value) : null)

  if (settings.conventions) {
    const node = root.get("conventions", true)
    const from = current(node)
    if (from !== settings.conventions) {
      if (node === undefined || node === null) before.push(`conventions: ${scalar(settings.conventions)}`)
      else if (isScalar(node)) replace(node, settings.conventions)
      else throw new ConfigTextError("conventions must be a path")
      changes.push({ key: "conventions", from, to: settings.conventions })
    }
  }

  const llmKeys = (
    [
      ["provider", settings.llmProvider],
      ["model", settings.llmModel],
    ] as const
  ).filter((entry): entry is readonly ["provider" | "model", string] => Boolean(entry[1]))
  if (llmKeys.length > 0) {
    const llm = root.get("llm", true)
    if (llm === undefined || llm === null) {
      before.push("llm:", ...llmKeys.map(([key, value]) => `  ${key}: ${scalar(value)}`))
      for (const [key, value] of llmKeys) changes.push({ key: `llm.${key}`, from: null, to: value })
    } else {
      if (!isMap(llm) || llm.flow || llm.items.length === 0) {
        throw new ConfigTextError("write llm in block style, one key per line, so rulecast can add to it")
      }
      const column = columnOf(text, (llm.items[0]!.key as Node).range![0])
      const added: string[] = []
      for (const [key, value] of llmKeys) {
        const node = llm.get(key, true)
        const from = current(node)
        if (from === value) continue
        if (node === undefined || node === null) added.push(`${" ".repeat(column)}${key}: ${scalar(value)}`)
        else replace(node as Node, value)
        changes.push({ key: `llm.${key}`, from, to: value })
      }
      if (added.length > 0) {
        const at = lineEndAfter(text, pairKey(root, "llm")!.range![0])
        edits.push({ start: at, end: at, insert: added.map((line) => `${line}\n`).join("") })
      }
    }
  }

  if (before.length > 0) {
    // New top-level keys go above repos, where a new config has them.
    const repos = pairKey(root, "repos")
    const at = repos === null ? text.length : repos.range![0] - columnOf(text, repos.range![0])
    const prefix = at === text.length && text !== "" && !text.endsWith("\n") ? "\n" : ""
    edits.push({ start: at, end: at, insert: `${prefix}${before.map((line) => `${line}\n`).join("")}` })
  }

  let updated = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    updated = updated.slice(0, edit.start) + edit.insert + updated.slice(edit.end)
  }
  const check = parseDocument(updated)
  if (check.errors.length > 0) throw new ConfigTextError(`could not update the config: ${check.errors[0]!.message}`)
  return { text: updated, changes }
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
      throw new ConfigTextError("write repos and their rules in block style so rulecast can add to them")
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

/**
 * Adds whole rules to the config's `repo: local` entry, changing nothing else; a local entry is
 * appended to `repos` when there is none. Rules whose id the entry already lists are skipped.
 */
export function addLocalRules(text: string, rules: LocalRule[]): string {
  const doc = parseDocument(text, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new ConfigTextError(doc.errors[0]!.message)
  const root = doc.contents
  if (!isMap(root)) throw new ConfigTextError("the config must be a mapping")
  const reposKey = pairKey(root, "repos")
  const repos = root.get("repos", true)
  if (reposKey === null || !isSeq(repos)) throw new ConfigTextError("the config has no repos list")

  const entry = repos.items.find((item): item is YAMLMap => isMap(item) && item.get("repo") === "local")
  let edit: Edit
  if (entry) {
    const listed = entry.get("rules", true)
    const rulesKey = pairKey(entry, "rules")
    if (!isSeq(listed) || rulesKey === null) throw new ConfigTextError("repo: local has no rules list")
    const present = new Set(listed.items.map((item) => (isMap(item) ? item.get("id") : undefined)))
    const added = rules.filter((rule) => !present.has(rule.id))
    if (added.length === 0) return text
    edit = appendToSeq(text, listed, rulesKey, added.flatMap(localRuleLines))
  } else {
    if (rules.length === 0) return text
    const lines = ["- repo: local", "  rules:", ...rules.flatMap(localRuleLines).map((line) => `    ${line}`)]
    edit = appendToSeq(text, repos, reposKey, lines)
  }
  const updated = text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
  const check = parseDocument(updated)
  if (check.errors.length > 0) throw new ConfigTextError(`could not update the config: ${check.errors[0]!.message}`)
  return updated
}
