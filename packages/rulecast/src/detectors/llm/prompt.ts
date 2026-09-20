export interface PromptRule {
  id: string
  question: string
  /** Resolved references, already filtered by the rule's `grounding` flag. */
  grounding: { ref: string; content: string }[]
}

export interface PromptCall {
  file: string
  source: string
  /** null: no baseline — judge the whole file, with no marks (spec §6). */
  changedLines: [number, number][] | null
  rules: PromptRule[]
}

/**
 * One call's prompt: the rules, their grounding, and the file with changed lines marked.
 *
 * Pure, so the tests pin the exact text. Every byte here is paid for on every uncached call, which
 * is why it is terse.
 */
export function buildPrompt(call: PromptCall): string {
  const marked = call.changedLines !== null
  const lines: string[] = [
    "Check the file below against each rule. Report every line that breaks a rule.",
    "",
    'Answer with JSON only: {"findings": [{"rule": "<rule id>", "line": <number>, "text": "<the line>", "reason": "<why>"}]}',
    "Report nothing when a rule is not broken. Use the rule ids exactly as given.",
    marked ? 'Only lines marked with ">" were changed. Report findings on those lines only.' : "Judge the whole file.",
    "",
    "## Rules",
    "",
  ]

  for (const rule of call.rules) {
    lines.push(`### ${rule.id}`, rule.question, "")
    for (const reference of rule.grounding) {
      lines.push(`Reference — ${reference.ref}:`, '"""', reference.content.replace(/\n$/, ""), '"""', "")
    }
  }

  lines.push(`## File: ${call.file}`, "")
  const fence = fenceFor(call.source)
  lines.push(fence, ...numbered(call.source, call.changedLines), fence)
  return lines.join("\n")
}

/** A fence longer than the longest backtick run in the source, so a fenced file cannot close it. */
function fenceFor(source: string): string {
  let longest = 2
  for (const run of source.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return "`".repeat(longest + 1)
}

function numbered(source: string, changedLines: [number, number][] | null): string[] {
  const sourceLines = source.replace(/\n$/, "").split("\n")
  const width = String(sourceLines.length).length
  return sourceLines.map((text, index) => {
    const number = index + 1
    const mark = changedLines !== null && isChanged(number, changedLines) ? "> " : "  "
    return `${mark}${String(number).padStart(width)}  ${text}`
  })
}

function isChanged(line: number, changedLines: [number, number][]): boolean {
  return changedLines.some(([start, end]) => line >= start && line <= end)
}
