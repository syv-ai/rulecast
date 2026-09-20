import path from "node:path"

import type { Match } from "../../core/types"

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error("output is not JSON")
  }
}

/** A path from a tool, made repo-relative with forward slashes. */
export function repoRelative(file: string, cwd: string): string {
  const withoutScheme = file.startsWith("file://") ? new URL(file).pathname : file
  const relative = path.isAbsolute(withoutScheme) ? path.relative(cwd, withoutScheme) : withoutScheme
  return relative.split(path.sep).join("/")
}

/**
 * Spec §6 and §14: "every declared capture must be a string field of every result; a missing one
 * is a rule error". Unlike a pattern's unmatched group, a checker that does not emit a field it
 * was told it emits is misconfigured, and silently delivering "" would hide it.
 */
function capturesOf(source: JsonObject, names: string[], where: string): Record<string, string> {
  const captures: Record<string, string> = {}
  for (const name of names) {
    const value = source[name]
    if (typeof value !== "string") throw new Error(`${where}: capture "${name}" is not a string`)
    captures[name] = value
  }
  return captures
}

export function matchesFromJson(output: string, captures: string[], cwd: string): Match[] {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) throw new Error("output is not a JSON array of results")
  return parsed.map((result, index) => {
    const where = `result ${index + 1}`
    if (!isObject(result)) throw new Error(`${where}: not an object`)
    if (typeof result.file !== "string") throw new Error(`${where}: "file" must be a string`)
    if (typeof result.line !== "number") throw new Error(`${where}: "line" must be a number`)
    return {
      file: repoRelative(result.file, cwd),
      line: result.line,
      endLine: typeof result.endLine === "number" ? result.endLine : result.line,
      column: typeof result.column === "number" ? result.column : 1,
      text: typeof result.text === "string" ? result.text : "",
      captures: capturesOf(result, captures, where),
    }
  })
}

export function matchesFromSarif(output: string, captures: string[], cwd: string): Match[] {
  const parsed = parseJson(output)
  if (!isObject(parsed) || !Array.isArray(parsed.runs)) throw new Error("output is not SARIF 2.1.0")
  const matches: Match[] = []
  let index = 0
  for (const run of parsed.runs) {
    if (!isObject(run) || !Array.isArray(run.results)) throw new Error("output is not SARIF 2.1.0")
    for (const result of run.results) {
      index += 1
      const where = `result ${index}`
      if (!isObject(result)) throw new Error(`${where}: not an object`)
      const location = Array.isArray(result.locations) ? result.locations[0] : undefined
      const physical = isObject(location) ? location.physicalLocation : undefined
      const artifact = isObject(physical) ? physical.artifactLocation : undefined
      // A result with no physical location has no line to attach a finding to.
      if (!isObject(artifact) || typeof artifact.uri !== "string") continue
      const region = isObject(physical) && isObject(physical.region) ? physical.region : {}
      const line = typeof region.startLine === "number" ? region.startLine : 1
      const message = isObject(result.message) && typeof result.message.text === "string" ? result.message.text : ""
      // SARIF 2.1.0 has no place for a tool's own fields on a result except `properties`.
      const source = isObject(result.properties) ? { ...result, ...result.properties } : result
      matches.push({
        file: repoRelative(artifact.uri, cwd),
        line,
        endLine: typeof region.endLine === "number" ? region.endLine : line,
        column: typeof region.startColumn === "number" ? region.startColumn : 1,
        text: message,
        captures: capturesOf(source, captures, where),
      })
    }
  }
  return matches
}
