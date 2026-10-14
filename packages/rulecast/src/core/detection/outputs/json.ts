import type { ToolFinding } from "."
import { isObject, numberOr, parseJson, stringFields, stringOr } from "./shared"

/** rulecast's own format: an array of `{ file, line, endLine?, column?, endColumn?, text?, ruleId?, message?, severity? }`. */
export function readJson(output: string, relative: (file: string) => string): ToolFinding[] {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) throw new Error("output is not a JSON array of results")
  return parsed.map((result, index): ToolFinding => {
    const where = `result ${index + 1}`
    if (!isObject(result)) throw new Error(`${where}: not an object`)
    if (typeof result.file !== "string") throw new Error(`${where}: "file" must be a string`)
    if (typeof result.line !== "number") throw new Error(`${where}: "line" must be a number`)
    return {
      file: relative(result.file),
      line: result.line,
      column: numberOr(result.column, 1),
      endLine: numberOr(result.endLine, result.line),
      endColumn: typeof result.endColumn === "number" ? result.endColumn : null,
      ruleId: stringOr(result.ruleId),
      message: stringOr(result.message),
      severity: stringOr(result.severity),
      text: typeof result.text === "string" ? result.text : null,
      properties: stringFields(result),
    }
  })
}
