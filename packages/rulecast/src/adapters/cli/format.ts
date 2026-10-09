import { renderAgentText } from "../../core/delivery/render-agent"
import type { Delivery, Finding } from "../../core/types"
import { renderBacklog, summarise } from "./backlog"

export const CLI_FORMATS = ["terminal", "agent", "json", "sarif"] as const
export type CliFormat = (typeof CLI_FORMATS)[number]

export interface FormatOptions {
  maxMatchesPerRule: number
  /** Print the per-finding lines. False for `--summary`, where the list is the noise. */
  findings?: boolean
  /** Append the adoption backlog. True for `--all-files` and `--summary`. */
  backlog?: boolean
  /** What was checked, so that "no findings" can never mean "nothing was looked at". Absent: not said. */
  checked?: { files: number; selection: "staged" | "files" | "all" | "range" | "session" }
  /** Findings a `rulecast-ignore` comment dropped: counted under the backlog, listed in json. */
  ignored?: { rule: string; file: string; line: number; reason: string }[]
  /** Rules left out because their detector is metered (a staged run, or --no-llm) and they matched a checked file. */
  skipped?: string[]
}

/** The ignores are part of the stock a team owes, so the backlog says how many there are. */
function ignoredLine(ignored: readonly unknown[]): string {
  return `ignored: ${plural(ignored.length, "finding")} by rulecast-ignore comments (rulecast run --format json lists them)`
}

/** Names what a staged run left out and the flag that puts it back. */
function skippedLine(skipped: readonly string[]): string {
  const rules = skipped.length === 1 ? "metered rule" : "metered rules"
  return `skipped ${skipped.length} ${rules} (${skipped.join(", ")}): costs money per file. Pass --llm to include ${skipped.length === 1 ? "it" : "them"}.`
}

/** The worst files named before the rest are counted: enough to pick one, not a second listing. */
const TOP_FILES = 10

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** The line above the tail: what the run looked at. */
function checkedLine(checked: NonNullable<FormatOptions["checked"]>): string {
  switch (checked.selection) {
    case "staged":
      return `checked ${plural(checked.files, "staged file")}`
    case "range":
      return `checked ${plural(checked.files, "changed file")}`
    case "all":
      return `checked all ${plural(checked.files, "file")}`
    case "files":
      return `checked ${plural(checked.files, "file")}`
    case "session":
      return "checked the session's edited files"
  }
}

/** Nothing staged is the first thing a new user runs into, and "no findings" there reads as "clean". */
export const NOTHING_STAGED = "nothing staged: 0 files checked (rulecast run --all-files checks everything)"

/** The block of rule and detector problems: not findings, and never counted as warnings. */
function problemsBlock(warnings: readonly string[]): string[] {
  return warnings.length === 0 ? [] : ["rulecast problems:", ...warnings.map((warning) => `  - ${warning}`), ""]
}

function terminal(delivery: Delivery, options: FormatOptions): string {
  const out: string[] = []
  // --summary: the warnings still matter — a rule that is broken makes the count below wrong — but
  // the list of sites does not, which is the whole reason for the flag.
  if (options.checked?.selection === "staged" && options.checked.files === 0 && delivery.warnings.length === 0) {
    return NOTHING_STAGED
  }
  if (options.findings === false) {
    out.push(...problemsBlock(delivery.warnings))
    if (options.backlog === true) out.push(renderBacklog(summarise(delivery), { topFiles: TOP_FILES }))
    if (options.backlog === true && (options.ignored ?? []).length > 0) out.push("", ignoredLine(options.ignored!))
    // What was left out and what was looked at are as true of a summary as of the full list.
    const tail = [
      ...((options.skipped ?? []).length > 0 ? [skippedLine(options.skipped!)] : []),
      ...(options.checked !== undefined ? [checkedLine(options.checked)] : []),
    ]
    if (tail.length > 0) out.push(...(out.length > 0 ? [""] : []), ...tail)
    return out.join("\n")
  }
  const shown = new Map<string, number>()
  const hidden = new Map<string, Finding[]>()
  for (const finding of delivery.findings) {
    const count = shown.get(finding.rule) ?? 0
    if (count >= options.maxMatchesPerRule) {
      // Appended in place: `rulecast run --all-files` over a whole repository reaches the scale
      // where rebuilding this array per finding is quadratic.
      const rest = hidden.get(finding.rule)
      if (rest === undefined) hidden.set(finding.rule, [finding])
      else rest.push(finding)
      continue
    }
    shown.set(finding.rule, count + 1)
    const repeat = finding.count > 1 ? ` (×${finding.count})` : ""
    out.push(
      `${finding.file}:${finding.line}:${finding.column}  ${finding.severity.padEnd(7)}  ${finding.rule}  ${finding.message.replace(/\s*\n\s*/g, " ")}${repeat}`,
    )
  }
  for (const [rule, rest] of hidden) out.push(`…and ${rest.length} more for ${rule}`)
  if (out.length > 0) out.push("")

  if (delivery.preexistingSummary.length > 0) {
    out.push("backlog in the files checked (not from your change):")
    for (const summary of delivery.preexistingSummary) {
      out.push(`  ${summary.rule} ×${summary.count} in ${summary.file}`)
    }
    // Not when the backlog summary is already about to be printed below it.
    if (options.backlog !== true) out.push("  see all of it: rulecast run --all-files --summary")
  }
  if (delivery.references.length > 0) {
    out.push(`conventions: ${delivery.references.map((reference) => reference.ref).join(", ")}`)
  }
  if (delivery.preexistingSummary.length > 0 || delivery.references.length > 0) out.push("")

  out.push(...problemsBlock(delivery.warnings))

  for (const notice of delivery.notices ?? []) out.push(notice, "")
  if ((options.skipped ?? []).length > 0) out.push(skippedLine(options.skipped!))
  if (options.checked !== undefined) out.push(checkedLine(options.checked))
  const errors = delivery.findings.filter((finding) => finding.severity === "error").length
  const warningsCount = delivery.findings.length - errors
  // Findings and rulecast's own problems are counted apart: one word, two meanings, side by side, is
  // how a reader decides the count above it is wrong.
  const problems =
    delivery.warnings.length === 0 ? "" : ` · rulecast: ${plural(delivery.warnings.length, "problem")} (see above)`
  out.push(
    (delivery.findings.length === 0
      ? "no findings"
      : `findings: ${plural(errors, "error")}, ${plural(warningsCount, "warning")}`) + problems,
  )
  // Last, so it is what is left on screen: the count is the thing to act on, and the list above it
  // is a hundred lines of detail nobody reads to the end.
  if (options.backlog === true) out.push("", renderBacklog(summarise(delivery), { topFiles: TOP_FILES, note: false }))
  if (options.backlog === true && (options.ignored ?? []).length > 0) out.push("", ignoredLine(options.ignored!))
  return out.join("\n")
}

/**
 * What `--format json` publishes. Named rather than serialising the whole `Delivery`, which also
 * carries the renderer's bookkeeping — `templates` restates each rule's message, and `omitted` and
 * `overflowPath` are artefacts of the hook path's character budget that are always empty here,
 * because the CLI runs unbudgeted. Adding a field to `Delivery` should not change this output.
 */
function json(delivery: Delivery, options: FormatOptions): string {
  return JSON.stringify(
    {
      findings: delivery.findings,
      // Always, whatever flags were given: a consumer that did not ask for it can ignore a key, and
      // one that wanted it cannot conjure it. This is the number a team tracks over time.
      backlog: summarise(delivery),
      preexistingSummary: delivery.preexistingSummary,
      references: delivery.references,
      touches: delivery.touches,
      warnings: delivery.warnings,
      skipped: options.skipped ?? [],
      checked: options.checked ?? null,
      ignored: options.ignored ?? [],
      notices: delivery.notices ?? [],
      stop: delivery.stop,
    },
    null,
    2,
  )
}

function sarif(delivery: Delivery): string {
  const rules = [...new Set(delivery.findings.map((finding) => finding.rule))].map((id) => ({ id }))
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "rulecast", rules } },
          results: delivery.findings.map((finding) => ({
            ruleId: finding.rule,
            level: finding.severity,
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: finding.file },
                  region: { startLine: finding.line, startColumn: finding.column },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  )
}

export function formatDelivery(delivery: Delivery, format: CliFormat, options: FormatOptions): string {
  switch (format) {
    case "terminal":
      return terminal(delivery, options)
    case "agent":
      return renderAgentText(delivery, options)
    case "json":
      return json(delivery, options)
    case "sarif":
      return sarif(delivery)
  }
}

export function exitCodeFor(delivery: Delivery, failed: boolean): number {
  if (failed) return 2
  return delivery.findings.some((finding) => finding.severity === "error") ? 1 : 0
}
