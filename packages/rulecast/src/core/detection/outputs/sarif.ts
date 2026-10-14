import type { ToolFinding } from "."
import { isObject, type JsonObject, numberOr, parseJson, stringFields, stringOr } from "./shared"

/** A result that says the check passed or did not apply is not a finding (SARIF 2.1.0 §3.27.9). */
const NOT_FINDINGS = new Set(["pass", "notApplicable"])

/** Suppressed in source or by an accepted external suppression; a rejected one suppresses nothing (§3.35). */
function suppressed(result: JsonObject): boolean {
  if (!Array.isArray(result.suppressions)) return false
  return result.suppressions.some((suppression) => !isObject(suppression) || suppression.status !== "rejected")
}

/** A uri relative to a base the run declares (`%SRCROOT%` and the like), resolved against it. */
function resolveUri(artifact: JsonObject, bases: JsonObject): string {
  const uri = artifact.uri as string
  const base = typeof artifact.uriBaseId === "string" ? bases[artifact.uriBaseId] : undefined
  if (!isObject(base) || typeof base.uri !== "string" || /^[a-z]+:/i.test(uri)) return uri
  try {
    return new URL(uri, base.uri).toString()
  } catch {
    return uri
  }
}

export function readSarif(output: string, relative: (file: string) => string): ToolFinding[] {
  const parsed = parseJson(output)
  if (!isObject(parsed) || !Array.isArray(parsed.runs)) throw new Error("output is not SARIF 2.1.0")
  const findings: ToolFinding[] = []
  let index = 0
  for (const run of parsed.runs) {
    if (!isObject(run) || !Array.isArray(run.results)) throw new Error("output is not SARIF 2.1.0")
    const bases = isObject(run.originalUriBaseIds) ? run.originalUriBaseIds : {}
    for (const result of run.results) {
      index += 1
      if (!isObject(result)) throw new Error(`result ${index}: not an object`)
      if (NOT_FINDINGS.has(stringOr(result.kind)) || suppressed(result)) continue
      const location = Array.isArray(result.locations) ? result.locations[0] : undefined
      const physical = isObject(location) ? location.physicalLocation : undefined
      const artifact = isObject(physical) ? physical.artifactLocation : undefined
      // A result with no physical location has no file to attach a finding to.
      if (!isObject(artifact) || typeof artifact.uri !== "string") continue
      // No region: the finding is about the whole file (osv-scanner on a lockfile, knip on a file).
      const region = isObject(physical) && isObject(physical.region) ? physical.region : {}
      const line = numberOr(region.startLine, 1)
      const rule = isObject(result.rule) ? result.rule : {}
      findings.push({
        file: relative(resolveUri(artifact, bases)),
        line,
        column: numberOr(region.startColumn, 1),
        endLine: numberOr(region.endLine, line),
        endColumn: typeof region.endColumn === "number" ? region.endColumn : null,
        ruleId: stringOr(result.ruleId, stringOr(rule.id)),
        message: isObject(result.message) ? stringOr(result.message.text) : "",
        // "warning" is the level SARIF gives a result that names none (§3.27.10).
        severity: stringOr(result.level, "warning"),
        text: null,
        // SARIF has no place for a tool's own fields on a result except `properties`.
        properties: {
          ...stringFields(result),
          ...(isObject(result.properties) ? stringFields(result.properties) : {}),
        },
      })
    }
  }
  return findings
}
