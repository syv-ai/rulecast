import { templateBindings, templateLiteralLength, templateSkeleton, templateVariables } from "../template"
import type { DeliveredReference, Delivery, Finding, Omitted } from "../types"

export interface RenderOptions {
  maxMatchesPerRule: number
}

/**
 * Grouping prints a rule's `message` once and lists the sites under it. Two conditions decide
 * whether that is an improvement on repeating the whole message per site:
 *
 * - Below three findings the skeleton costs about what the repeats do, and the repeats read better.
 * - A template that is nearly all variables — "{{file}}:{{line}} {{text}}", which is how a linter or
 *   command rule passes its detector's own wording through — has no prose to factor out.
 */
const GROUP_FROM = 3
const GROUP_MIN_LITERAL = 40

/** Past this the location column is padding more than it is aligning. */
const MAX_LOCATION_PAD = 40

/** Where a packed list of locations wraps. */
const WRAP = 96

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function header(delivery: Delivery): string | null {
  if (delivery.findings.length > 0) {
    const rules = new Set(delivery.findings.map((finding) => finding.rule)).size + delivery.omitted.rules
    const files = new Set(delivery.findings.map((finding) => finding.file))
    const where = files.size === 1 && delivery.omitted.rules === 0 ? ` in ${[...files][0]}` : ""
    return `rulecast: ${plural(rules, "rule")} violated${where}`
  }
  if (delivery.references.length > 0 || delivery.preexistingSummary.length > 0) {
    return "rulecast: conventions for the files you are working on"
  }
  return null
}

const repeatOf = (finding: Finding) => (finding.count > 1 ? ` (×${finding.count})` : "")

function findingLines(finding: Finding): string[] {
  const lines = finding.message.split("\n").map((line) => `  ${line}`)
  lines[lines.length - 1] += repeatOf(finding)
  return lines
}

/** A `path` rule's message never says {{line}}, and every one of its matches is line 1. */
const locationOf = (finding: Finding, withLine: boolean) =>
  withLine ? `${finding.file}:${finding.line}` : finding.file

/** One site's value for one template variable: on its own line, so what contains a space is quoted. */
function bindingValue(value: string | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (text === "") return "—"
  return /\s/.test(text) && !/^".*"$/.test(text) ? `"${text}"` : text
}

/** Locations with nothing to say per site: as many to a line as fit. */
function packed(items: string[]): string[] {
  const lines: string[] = []
  for (const item of items) {
    const last = lines.at(-1)
    if (last !== undefined && last.length + 2 + item.length <= WRAP) lines[lines.length - 1] = `${last}, ${item}`
    else lines.push(`  ${item}`)
  }
  return lines
}

function groupedLines(findings: Finding[], template: string): string[] {
  const names = templateBindings(template)
  const withLine = templateVariables(template).includes("line")
  const at = (finding: Finding) => locationOf(finding, withLine)
  const out = templateSkeleton(template)
    .split("\n")
    .map((line) => `  ${line}`)
  out.push("")
  if (names.length === 0) {
    out.push(...packed(findings.map((finding) => `${at(finding)}${repeatOf(finding)}`)))
    return out
  }
  const width = Math.min(MAX_LOCATION_PAD, Math.max(...findings.map((finding) => at(finding).length)))
  for (const finding of findings) {
    const values = names.map((name) => bindingValue(finding.captures?.[name])).join("  ")
    out.push(`  ${at(finding).padEnd(width)}  ${values}${repeatOf(finding)}`.trimEnd())
  }
  return out
}

function referenceLines(reference: DeliveredReference): string[] {
  switch (reference.state) {
    case "full":
      return [`--- ${reference.ref} ---`, ...(reference.content ?? "").split("\n"), ""]
    case "pointer":
      return [`--- ${reference.ref} (provided earlier in this session) ---`]
    case "missing":
      return [`--- ${reference.ref} (missing) ---`]
    case "read": {
      const what = reference.location === undefined ? "read this" : `read ${reference.location}`
      return reference.reason === "mode"
        ? [`--- ${reference.ref}: ${what} before continuing ---`]
        : [`--- ${reference.ref}: ${what} before continuing (not included, too long for this message) ---`]
    }
  }
}

/** What the budget dropped for a rule before the renderer saw it. */
function omittedFor(omitted: Omitted, rule: string): { count: number; files: number } {
  const entry = omitted.findings.find((finding) => finding.rule === rule)
  return { count: entry?.count ?? 0, files: entry?.files ?? 0 }
}

function ruleBlock(
  rule: string,
  findings: Finding[],
  template: string | undefined,
  dropped: { count: number; files: number },
  options: RenderOptions,
): string[] {
  const shown = findings.slice(0, options.maxMatchesPerRule)
  const hidden = findings.slice(options.maxMatchesPerRule)
  const total = findings.length + dropped.count
  const grouped = template !== undefined && total >= GROUP_FROM && templateLiteralLength(template) >= GROUP_MIN_LITERAL

  const severity = findings[0]!.severity
  const files = new Set(findings.map((finding) => finding.file)).size + dropped.files
  const out = [grouped ? `${severity} ${rule} — ${total} in ${plural(files, "file")}` : `${severity} ${rule}`]
  if (grouped && template !== undefined) out.push(...groupedLines(shown, template))
  else for (const finding of shown) out.push(...findingLines(finding))

  const more = hidden.length + dropped.count
  if (more > 0) {
    const moreFiles = new Set(hidden.map((finding) => finding.file)).size + dropped.files
    out.push(`  …and ${more} more in ${plural(moreFiles, "file")}`)
  }
  return out
}

/**
 * What this rule's block will cost, so the budget in decide() spends the characters the renderer
 * actually uses. Measuring by rendering is the only way the two cannot drift apart.
 */
export function measureRuleBlock(
  rule: string,
  findings: Finding[],
  template: string | undefined,
  options: RenderOptions,
): number {
  return ruleBlock(rule, findings, template, { count: 0, files: 0 }, options).join("\n").length + 1
}

export function renderAgentText(delivery: Delivery, options: RenderOptions): string {
  const title = header(delivery)
  if (title === null && delivery.warnings.length === 0) return ""
  const out: string[] = []
  if (title !== null) out.push(title, "")

  // Appended in place: rebuilding the array per finding is quadratic in one rule's matches, and a
  // json or sarif delivery is never trimmed, so this sees every match the detector found.
  const byRule = new Map<string, Finding[]>()
  for (const finding of delivery.findings) {
    const group = byRule.get(finding.rule)
    if (group === undefined) byRule.set(finding.rule, [finding])
    else group.push(finding)
  }
  for (const [rule, findings] of byRule) {
    out.push(...ruleBlock(rule, findings, delivery.templates[rule], omittedFor(delivery.omitted, rule), options))
    out.push("")
  }

  for (const summary of delivery.preexistingSummary) {
    out.push(`pre-existing (not blocking): ${summary.rule} ×${summary.count} in ${summary.file}`)
  }
  if (delivery.omitted.preexisting > 0) {
    out.push(`…and ${delivery.omitted.preexisting} more pre-existing (not blocking)`)
  }
  if (delivery.preexistingSummary.length > 0 || delivery.omitted.preexisting > 0) out.push("")

  for (const reference of delivery.references) out.push(...referenceLines(reference))
  if (out.length > 0 && out.at(-1) !== "") out.push("")

  if (delivery.warnings.length > 0) {
    out.push("rulecast warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`))
  }

  if (delivery.overflowPath !== null) {
    if (out.at(-1) !== "") out.push("")
    out.push(
      `…${plural(delivery.omitted.rules, "rule")} and the conventions they cite did not fit here.`,
      "Every finding, with the doc sections it cites, is in:",
      `  ${delivery.overflowPath}`,
    )
  }

  while (out.at(-1) === "") out.pop()
  return out.join("\n")
}
