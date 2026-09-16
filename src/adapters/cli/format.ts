import { renderAgentText } from "../../core/delivery/render-agent"
import type { Delivery, Finding } from "../../core/types"

export const CLI_FORMATS = ["terminal", "agent", "json", "sarif"] as const
export type CliFormat = (typeof CLI_FORMATS)[number]

export interface FormatOptions {
  maxMatchesPerRule: number
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function terminal(delivery: Delivery, options: FormatOptions): string {
  const out: string[] = []
  const shown = new Map<string, number>()
  const hidden = new Map<string, Finding[]>()
  for (const finding of delivery.findings) {
    const count = shown.get(finding.rule) ?? 0
    if (count >= options.maxMatchesPerRule) {
      hidden.set(finding.rule, [...(hidden.get(finding.rule) ?? []), finding])
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

  for (const summary of delivery.preexistingSummary) {
    out.push(`pre-existing (not blocking): ${summary.rule} ×${summary.count} in ${summary.file}`)
  }
  if (delivery.references.length > 0) {
    out.push(`conventions: ${delivery.references.map((reference) => reference.ref).join(", ")}`)
  }
  if (delivery.preexistingSummary.length > 0 || delivery.references.length > 0) out.push("")

  if (delivery.warnings.length > 0) {
    out.push("warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`), "")
  }

  const errors = delivery.findings.filter((finding) => finding.severity === "error").length
  const warningsCount = delivery.findings.length - errors
  out.push(delivery.findings.length === 0 ? "no findings" : `${plural(errors, "error")}, ${plural(warningsCount, "warning")}`)
  return out.join("\n")
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
      return JSON.stringify(delivery, null, 2)
    case "sarif":
      return sarif(delivery)
  }
}

export function exitCodeFor(delivery: Delivery, failed: boolean): number {
  if (failed) return 2
  return delivery.findings.some((finding) => finding.severity === "error") ? 1 : 0
}
