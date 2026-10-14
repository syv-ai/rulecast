import type { ToolFinding } from "."
import { isObject, type JsonObject, numberOr, stringFields, stringOr } from "./shared"

/** reviewdog's diagnostic format: one `{ diagnostics: [...] }` result, or rdjsonl, one diagnostic per line. */
export function readRdjson(output: string, relative: (file: string) => string): ToolFinding[] {
  let diagnostics: unknown[]
  let fallback = ""
  try {
    const parsed: unknown = JSON.parse(output)
    if (!isObject(parsed) || !Array.isArray(parsed.diagnostics)) throw new Error("output is not rdjson")
    diagnostics = parsed.diagnostics
    fallback = stringOr(parsed.severity)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    diagnostics = output
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          throw new Error("output is not rdjson or rdjsonl")
        }
      })
  }
  const findings: ToolFinding[] = []
  for (const diagnostic of diagnostics) {
    if (!isObject(diagnostic) || !isObject(diagnostic.location)) continue
    const { location } = diagnostic
    if (typeof location.path !== "string") continue
    const range: JsonObject = isObject(location.range) ? location.range : {}
    const start: JsonObject = isObject(range.start) ? range.start : {}
    const end: JsonObject = isObject(range.end) ? range.end : {}
    const line = numberOr(start.line, 1)
    const severity = stringOr(diagnostic.severity, fallback)
    findings.push({
      file: relative(location.path),
      line,
      column: numberOr(start.column, 1),
      endLine: numberOr(end.line, line),
      endColumn: typeof end.column === "number" ? end.column : null,
      ruleId: isObject(diagnostic.code) ? stringOr(diagnostic.code.value) : "",
      message: stringOr(diagnostic.message),
      // "UNKNOWN_SEVERITY", or nothing at all, is a warning: the format's own default is no help.
      severity: severity === "" || severity === "UNKNOWN_SEVERITY" ? "warning" : severity.toLowerCase(),
      text: null,
      properties: stringFields(diagnostic),
    })
  }
  return findings
}
