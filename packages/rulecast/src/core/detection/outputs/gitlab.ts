import type { ToolFinding } from "."
import { isObject, numberOr, parseJson, stringFields, stringOr } from "./shared"

/**
 * GitLab code-quality JSON (the Code Climate issue subset): an array of `{ description, check_name,
 * severity, location: { path, lines: { begin } | positions: { begin: { line, column } } } }`.
 */
export function readGitlab(output: string, relative: (file: string) => string): ToolFinding[] {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) throw new Error("output is not a GitLab code-quality JSON array")
  const findings: ToolFinding[] = []
  for (const issue of parsed) {
    if (!isObject(issue) || !isObject(issue.location) || typeof issue.location.path !== "string") continue
    const { location } = issue
    const lines = isObject(location.lines) ? location.lines : {}
    const positions = isObject(location.positions) ? location.positions : {}
    const begin = isObject(positions.begin) ? positions.begin : {}
    const end = isObject(positions.end) ? positions.end : {}
    const line = numberOr(begin.line, numberOr(lines.begin, 1))
    const ruleId = stringOr(issue.check_name)
    const description = stringOr(issue.description)
    // ty, among others, repeats the check name at the head of the description.
    const prefix = `${ruleId}: `
    findings.push({
      file: relative(location.path as string),
      line,
      column: numberOr(begin.column, 1),
      endLine: numberOr(end.line, numberOr(lines.end, line)),
      endColumn: typeof end.column === "number" ? end.column : null,
      ruleId,
      message: ruleId && description.startsWith(prefix) ? description.slice(prefix.length) : description,
      severity: stringOr(issue.severity),
      text: null,
      properties: stringFields(issue),
    })
  }
  return findings
}
