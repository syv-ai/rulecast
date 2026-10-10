import { templateBindings, templateLiteralLength, templateSkeleton, templateVariables } from "../template"
import type { DeliveredReference, Delivery, Finding, Omitted } from "../types"

export interface RenderOptions {
  maxMatchesPerRule: number
  /**
   * Print `delivery.notices` (default true). A hook adapter passes false and shows them to the user
   * itself; `--format agent` serves agents without hooks, where nobody else would see them. Notices
   * are attached after the budget is spent, so they are never priced: no budgeted delivery has any.
   */
  notices?: boolean
  /**
   * Print `delivery.warnings` (default true). Rule and detector problems are the human's to fix; a
   * hook adapter that can reach the user passes false and shows them there. Not printing them only
   * ever spends less than the budget reserved for them.
   */
  warnings?: boolean
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

/** The one line that turns a summary into something the reader can act on. */
export const BACKLOG_HINT = "  see all of it: rulecast run --all-files --summary"

const BACKLOG_HEADING = "backlog in files you touched (not from your edit; leave it unless asked):"
const WARNINGS_HEADING = "rulecast warnings:"
const CONVENTIONS_TITLE = "rulecast: conventions for the files you are working on"
const NOTICES_HEADING = "rulecast notices (for the user):"
/** Said in the title of a delivery for files the agent's shell command changed, not its edit tools. */
const SHELL_TRIGGER = "changed by your Bash command"

const backlogLine = (summary: { rule: string; file: string; count: number }) =>
  `  ${summary.rule} ×${summary.count} in ${summary.file}`
const backlogMoreLine = (count: number) => `  …and ${count} more`
const warningLine = (warning: string) => `  - ${warning}`
const overflowLines = (rules: number, path: string) => [
  `…${plural(rules, "rule")} and the conventions they cite did not fit here.`,
  "Every finding, with the doc sections it cites, is in:",
  `  ${path}`,
]

/** Where a packed list of locations wraps. */
const WRAP = 96

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** The title over findings: in one file it names it, and a shell edit says that is what changed it. */
function violatedTitle(rules: number, file: string | null, via: Delivery["via"]): string {
  const where =
    via === "shell"
      ? file === null
        ? ` in files ${SHELL_TRIGGER}`
        : ` in ${file}, ${SHELL_TRIGGER}`
      : file === null
        ? ""
        : ` in ${file}`
  return `rulecast: ${plural(rules, "rule")} violated${where}`
}

function header(delivery: Delivery): string | null {
  if (delivery.findings.length > 0) {
    const rules = new Set(delivery.findings.map((finding) => finding.rule)).size + delivery.omitted.rules
    const files = new Set(delivery.findings.map((finding) => finding.file))
    const file = files.size === 1 && delivery.omitted.rules === 0 ? [...files][0]! : null
    return violatedTitle(rules, file, delivery.via)
  }
  if (delivery.references.length > 0 || delivery.preexistingSummary.length > 0) {
    return CONVENTIONS_TITLE
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

/** The characters a run of lines adds to the text, each with the newline that follows it. */
const linesCost = (lines: readonly string[]) => lines.reduce((sum, line) => sum + line.length + 1, 0)

/**
 * What this rule's block will cost when `shown` of its findings are delivered and the rest of `all`
 * are cut, so the budget in decide() spends the characters the renderer actually uses. Measuring by
 * rendering is the only way the two cannot drift apart.
 *
 * The cut ones are part of the measurement, not an afterthought: a block with findings cut prints
 * "…and 13 more in 2 files", and because grouping is decided by the rule's *total* it can also switch
 * to the grouped form with its skeleton line. Until plan 9 this measured every block as if nothing
 * were cut, which under-charged exactly the blocks the budget had cut.
 *
 * Linear in `all`, and called at most `maxMatchesPerRule` + 1 times per rule, so the budget stays
 * linear in a rule's matches (decide-scale.test.ts).
 */
export function measureRuleBlock(
  rule: string,
  shown: Finding[],
  all: readonly Finding[],
  template: string | undefined,
  options: RenderOptions,
): number {
  const shownFiles = new Set(shown.map((finding) => finding.file))
  const rest = all.slice(shown.length)
  const cut = { count: rest.length, files: new Set(rest.map((f) => f.file).filter((f) => !shownFiles.has(f))).size }
  // The block's lines and the blank line the renderer puts after every block. This used to be
  // `lines.join("\n").length + 1`, which counts the newline after the last line but not the blank
  // line's own, so every block was charged one character short.
  return linesCost([...ruleBlock(rule, shown, template, cut, options), ""])
}

/**
 * The longest path an overflow file is written to. It is not known when the budget is spent —
 * `writeOverflow` runs after `decide` — so this is the one allowance here that is not measured:
 * the cache directory, the project's hash, the session id and the file name, with room to spare.
 */
const OVERFLOW_PATH_ALLOWANCE = 192

/**
 * What each part of `renderAgentText`'s output costs, in characters, so the budget in `decide`
 * spends exactly what this file prints rather than five hand-tuned constants that had to track it.
 *
 * **Every price is a bounded unit**: one line, one block, one section's frame. Never a growing
 * section priced from inside its own item loop. Measured at 60,000 findings and 20,000 pre-existing
 * summaries, pricing one summary line at a time cost 8.5 ms over 20,000 calls; pricing the whole
 * backlog from inside the per-summary loop cost 13,610 ms — the quadratic `decide-scale.test.ts`
 * exists to catch. `measureRuleBlock` is the same idea: one rule's block, capped at
 * `maxMatchesPerRule`.
 *
 * Where a line's final form is not known when the budget is spent, the price is its longest form.
 */
export const deliveryCost = {
  /**
   * The title and the blank line under it, at its longest — two things about it are not known yet.
   * It names a file when every *delivered* finding is in one, and the budget may cut a rule down to
   * findings in a single file however many files it fired in; so the longest file name is charged.
   * And if the budget drops every rule that fired, no findings are left and the conventions title
   * prints instead; so with `conventions` the longer of the two is charged. A shell edit's title
   * names the file or says "files", so both forms are measured and the longer charged.
   */
  header(rules: number, files: ReadonlySet<string>, conventions: boolean, via?: Delivery["via"]): number {
    const longest = [...files].reduce((most, file) => (file.length > most.length ? file : most), "")
    const titles = [violatedTitle(rules, longest === "" ? null : longest, via), violatedTitle(rules, null, via)]
    const violated = rules > 0 ? Math.max(...titles.map((title) => linesCost([title, ""]))) : 0
    return Math.max(violated, conventions ? linesCost([CONVENTIONS_TITLE, ""]) : 0)
  },
  /**
   * One reference's line, at its longest — the "not included, too long" form, naming the file when
   * it has an absolute location. Every other state prints a shorter line, so this bounds them all.
   */
  referenceLine(ref: string, location: string | undefined): number {
    return linesCost(referenceLines({ ref, state: "read", reason: "budget", location }))
  },
  /** What a reference given in full adds over its one-line price: the content and the blank line. */
  referenceContent(ref: string, content: string, location: string | undefined): number {
    return linesCost(referenceLines({ ref, state: "full", content })) - deliveryCost.referenceLine(ref, location)
  },
  /** The blank line that closes the references, once. */
  referencesEnd: 1,
  /** The warnings heading, once. */
  warningsFrame: linesCost([WARNINGS_HEADING]),
  warning(text: string): number {
    return linesCost([warningLine(text)])
  },
  /**
   * The backlog's heading, its hint, the blank line after, and the "…and N more" line at its
   * longest — printed only when summaries are cut, and charged up front so a cut cannot overflow.
   */
  backlogFrame(summaries: number): number {
    return linesCost([BACKLOG_HEADING, backlogMoreLine(summaries), BACKLOG_HINT, ""])
  },
  backlogSummary(summary: { rule: string; file: string; count: number }): number {
    return linesCost([backlogLine(summary)])
  },
  /** The lines naming the overflow file, and the blank line before them. */
  overflowNotice(rules: number): number {
    return linesCost(["", ...overflowLines(rules, "x".repeat(OVERFLOW_PATH_ALLOWANCE))])
  },
}

export function renderAgentText(delivery: Delivery, options: RenderOptions): string {
  const title = header(delivery)
  const notices = options.notices === false ? [] : (delivery.notices ?? [])
  const warnings = options.warnings === false ? [] : delivery.warnings
  if (title === null && warnings.length === 0 && notices.length === 0) return ""
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

  // "pre-existing (not blocking)" read as *ignore this*, and the backlog it names is the thing that
  // never moves on its own — one codebase held 57–61 violations of one rule while it tripled in
  // size. Naming it a backlog and naming the command that shows all of it is the whole change; it
  // still never blocks, and the hook still cannot count the repository inside its deadline (§13).
  if (delivery.preexistingSummary.length > 0 || delivery.omitted.preexisting > 0) {
    out.push(BACKLOG_HEADING)
    for (const summary of delivery.preexistingSummary) out.push(backlogLine(summary))
    if (delivery.omitted.preexisting > 0) out.push(backlogMoreLine(delivery.omitted.preexisting))
    out.push(BACKLOG_HINT, "")
  }

  for (const reference of delivery.references) out.push(...referenceLines(reference))
  if (out.length > 0 && out.at(-1) !== "") out.push("")

  if (warnings.length > 0) {
    out.push(WARNINGS_HEADING, ...warnings.map(warningLine))
  }

  if (delivery.overflowPath !== null) {
    if (out.at(-1) !== "") out.push("")
    out.push(...overflowLines(delivery.omitted.rules, delivery.overflowPath))
  }

  if (notices.length > 0) {
    if (out.length > 0 && out.at(-1) !== "") out.push("")
    out.push(NOTICES_HEADING, ...notices.map(warningLine))
  }

  while (out.at(-1) === "") out.pop()
  return out.join("\n")
}
