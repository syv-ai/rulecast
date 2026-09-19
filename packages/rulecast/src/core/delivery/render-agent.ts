import type { DeliveredReference, Delivery, Finding } from "../types"

export interface RenderOptions {
  maxMatchesPerRule: number
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function header(delivery: Delivery): string | null {
  if (delivery.findings.length > 0) {
    const rules = new Set(delivery.findings.map((finding) => finding.rule)).size
    const files = new Set(delivery.findings.map((finding) => finding.file))
    const where = files.size === 1 ? ` in ${[...files][0]}` : ""
    return `rulecast: ${plural(rules, "rule")} violated${where}`
  }
  if (delivery.references.length > 0 || delivery.preexistingSummary.length > 0) {
    return "rulecast: conventions for the files you are working on"
  }
  return null
}

function findingLines(finding: Finding): string[] {
  const lines = finding.message.split("\n").map((line) => `  ${line}`)
  if (finding.count > 1) lines[lines.length - 1] += ` (×${finding.count})`
  return lines
}

function referenceLines(reference: DeliveredReference): string[] {
  switch (reference.state) {
    case "full":
      return [`--- ${reference.ref} ---`, ...(reference.content ?? "").split("\n"), ""]
    case "pointer":
      return [`--- ${reference.ref} (provided earlier in this session) ---`]
    case "missing":
      return [`--- ${reference.ref} (missing) ---`]
    case "read":
      return reference.reason === "mode"
        ? [`--- ${reference.ref}: read this before continuing ---`]
        : [`--- ${reference.ref}: read this before continuing (not included, too long for this message) ---`]
  }
}

export function renderAgentText(delivery: Delivery, options: RenderOptions): string {
  const title = header(delivery)
  if (title === null && delivery.warnings.length === 0) return ""
  const out: string[] = []
  if (title !== null) out.push(title, "")

  const byRule = new Map<string, Finding[]>()
  for (const finding of delivery.findings) byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding])
  for (const [rule, findings] of byRule) {
    out.push(`${findings[0]!.severity} ${rule}`)
    for (const finding of findings.slice(0, options.maxMatchesPerRule)) out.push(...findingLines(finding))
    const rest = findings.slice(options.maxMatchesPerRule)
    if (rest.length > 0) {
      out.push(`  …and ${rest.length} more in ${plural(new Set(rest.map((finding) => finding.file)).size, "file")}`)
    }
    out.push("")
  }

  for (const summary of delivery.preexistingSummary) {
    out.push(`pre-existing (not blocking): ${summary.rule} ×${summary.count} in ${summary.file}`)
  }
  if (delivery.preexistingSummary.length > 0) out.push("")

  for (const reference of delivery.references) out.push(...referenceLines(reference))
  if (out.length > 0 && out.at(-1) !== "") out.push("")

  if (delivery.warnings.length > 0) {
    out.push("rulecast warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`))
  }
  while (out.at(-1) === "") out.pop()
  return out.join("\n")
}
