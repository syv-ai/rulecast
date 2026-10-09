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
  /** Rules left out because their detector is metered (a staged run, or --no-llm) and they matched a checked file. */
  skipped?: string[]
}

/** Names what a staged run left out and the flag that puts it back. */
function skippedLine(skipped: readonly string[]): string {
  const rules = skipped.length === 1 ? "metered rule" : "metered rules"
  return `skipped ${skipped.length} ${rules} (${skipped.join(", ")}): costs money per file. Pass --llm to include ${skipped.length === 1 ? "it" : "them"}.`
}

/** The worst files named before the rest are counted: enough to pick one, not a second listing. */
const TOP_FILES = 10

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function terminal(delivery: Delivery, options: FormatOptions): string {
  const out: string[] = []
  // --summary: the warnings still matter — a rule that is broken makes the count below wrong — but
  // the list of sites does not, which is the whole reason for the flag.
  if (options.findings === false) {
    if (delivery.warnings.length > 0) {
      out.push("warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`), "")
    }
    if (options.backlog === true) out.push(renderBacklog(summarise(delivery), { topFiles: TOP_FILES }))
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

  if (delivery.warnings.length > 0) {
    out.push("warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`), "")
  }

  if ((options.skipped ?? []).length > 0) out.push(skippedLine(options.skipped!))
  const errors = delivery.findings.filter((finding) => finding.severity === "error").length
  const warningsCount = delivery.findings.length - errors
  out.push(
    delivery.findings.length === 0 ? "no findings" : `${plural(errors, "error")}, ${plural(warningsCount, "warning")}`,
  )
  // Last, so it is what is left on screen: the count is the thing to act on, and the list above it
  // is a hundred lines of detail nobody reads to the end.
  if (options.backlog === true) out.push("", renderBacklog(summarise(delivery), { topFiles: TOP_FILES }))
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
