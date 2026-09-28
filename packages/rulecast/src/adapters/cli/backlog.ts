import type { Delivery } from "../../core/types"

/**
 * How much of a rule a repository already owes, per rule and per file.
 *
 * Counts, never rates. One codebase went from 61 violations in 80 files to 57 in 194 over eight
 * months: the rate fell from 76% to 29% and the count did not move, because new code complied and
 * the old violations were only diluted. A team watching the rate would have believed it was fixing
 * the problem. So this reports the stock and leaves the division to nobody.
 */
export interface BacklogSummary {
  /** Violations descending, then rule ascending. */
  rules: { rule: string; violations: number; files: number }[]
  /** Violations descending, then file ascending. */
  files: { file: string; violations: number }[]
  totalViolations: number
  /** Distinct files with at least one violation — not the sum of the per-rule file counts. */
  totalFiles: number
}

/**
 * Both halves of a delivery count.
 *
 * `--all-files` has no baseline, so every violation arrives as a finding. `--from-ref` classifies
 * against the merge base, and there most of the backlog is in `preexistingSummary` — which is
 * exactly the set this exists to give a number to.
 */
export function summarise(delivery: Delivery): BacklogSummary {
  const byRule = new Map<string, { violations: number; files: Set<string> }>()
  const byFile = new Map<string, number>()

  const add = (rule: string, file: string, count: number) => {
    const entry = byRule.get(rule) ?? { violations: 0, files: new Set<string>() }
    entry.violations += count
    entry.files.add(file)
    byRule.set(rule, entry)
    byFile.set(file, (byFile.get(file) ?? 0) + count)
  }
  for (const finding of delivery.findings) add(finding.rule, finding.file, finding.count)
  for (const summary of delivery.preexistingSummary) add(summary.rule, summary.file, summary.count)

  const rules = [...byRule]
    .map(([rule, entry]) => ({ rule, violations: entry.violations, files: entry.files.size }))
    .sort((a, b) => b.violations - a.violations || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
  const files = [...byFile]
    .map(([file, violations]) => ({ file, violations }))
    .sort((a, b) => b.violations - a.violations || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

  return {
    rules,
    files,
    totalViolations: rules.reduce((sum, entry) => sum + entry.violations, 0),
    totalFiles: files.length,
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** First column left, the rest right: the numbers are meant to be compared down the column. */
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((_, column) => Math.max(...[header, ...rows].map((row) => row[column]!.length)))
  const line = (row: string[]) =>
    `  ${row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join("  ")}`
  return [line(header), ...rows.map(line)]
}

export function renderBacklog(summary: BacklogSummary, options: { topFiles: number }): string {
  if (summary.totalViolations === 0) return "backlog: no violations"

  const out: string[] = [
    `backlog: ${plural(summary.totalViolations, "violation")} in ${plural(summary.totalFiles, "file")}`,
    "",
    ...table(
      ["rule", "violations", "files"],
      summary.rules.map((entry) => [entry.rule, String(entry.violations), String(entry.files)]),
    ),
  ]

  const shown = summary.files.slice(0, options.topFiles)
  if (shown.length > 0) {
    out.push(
      "",
      ...table(
        ["worst files", "violations"],
        shown.map((entry) => [entry.file, String(entry.violations)]),
      ),
    )
    const rest = summary.files.length - shown.length
    if (rest > 0) out.push(`  …and ${plural(rest, "more file")}`)
  }

  // Both sentences, always, and no verdict. The first is what the eight-month table above shows;
  // the second is the weaker claim the 2%-against-37% figure supports — a correlation, so it says
  // "rarely breaks it" rather than promising a mechanism.
  out.push(
    "",
    "This is the stock, not a rate. Enforcement on edits does not reduce it.",
    "Remediate a file at a time: a file that already follows a rule rarely breaks it.",
  )
  return out.join("\n")
}
