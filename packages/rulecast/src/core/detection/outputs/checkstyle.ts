import type { ToolFinding } from "."

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    return ENTITIES[name] ?? entity
  })
}

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    found[match[1]!] = decode(match[2] ?? match[3] ?? "")
  }
  return found
}

const positive = (value: string | undefined): number => {
  const number = Number.parseInt(value ?? "", 10)
  return Number.isFinite(number) && number > 0 ? number : 1
}

/**
 * Checkstyle XML: `<file name>` elements holding `<error line column severity message source>`.
 * Read with patterns rather than a parser: the format is flat, and a dependency for it is not worth it.
 * The rule id is the last dotted part of `source` ("ShellCheck.SC2115", "eslint.rules.no-eval").
 */
export function readCheckstyle(output: string, relative: (file: string) => string): ToolFinding[] {
  if (!/<checkstyle[\s>]/.test(output)) throw new Error("output is not checkstyle XML")
  const findings: ToolFinding[] = []
  for (const file of output.matchAll(/<file\b([^>]*?)(?:\/>|>([\s\S]*?)<\/file>)/g)) {
    const name = attributes(file[1]!).name
    if (name === undefined) continue
    for (const error of (file[2] ?? "").matchAll(/<error\b([^>]*?)\/?>/g)) {
      const { line, column, severity, message, source, ...rest } = attributes(error[1]!)
      const start = positive(line)
      findings.push({
        file: relative(name),
        line: start,
        column: positive(column),
        endLine: start,
        endColumn: null,
        ruleId: source?.split(".").pop() ?? "",
        message: message ?? "",
        severity: severity ?? "",
        text: null,
        properties: { ...rest, ...(source === undefined ? {} : { source }) },
      })
    }
  }
  return findings
}
