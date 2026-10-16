import type { DetectorRule } from "./compile/rule"
import { RULE_ID } from "./config/schema"
import type { Match } from "./types"

// The id pattern is RULE_ID's, without its anchors: one owner for what a rule id is.
const ID = RULE_ID.source.slice(1, -1)

/**
 * An inline ignore, anywhere in a line and in any comment syntax:
 *
 *     raise HTTPException(404)  # rulecast-ignore: python/no-httpexception-in-services legacy endpoint
 *     // rulecast-ignore: frontend/no-fetch the SDK has no hook for this yet
 *     <!-- rulecast-ignore: docs/no-todo tracked in #412 -->
 *
 * The reason is required. A closing `*\/` or `-->` is not part of it.
 */
export const IGNORE = new RegExp(
  String.raw`rulecast-ignore:\s*(?<rule>${ID})(?:\s+(?<reason>\S.*?))?\s*(?:\*\/|-->)?\s*$`,
)

export interface Ignore {
  rule: string
  /** null: written without one, which suppresses nothing. */
  reason: string | null
}

/** The ignore on one line of source, or null. */
export function parseIgnore(line: string): Ignore | null {
  const match = IGNORE.exec(line)
  if (match?.groups === undefined) return null
  return { rule: match.groups.rule!, reason: match.groups.reason ?? null }
}

export interface IgnoredFinding {
  rule: DetectorRule
  match: Match
  reason: string
}

export interface Suppressed {
  findings: { rule: DetectorRule; match: Match }[]
  ignored: IgnoredFinding[]
  /** Ignores written without a reason: they suppress nothing, and say so. */
  warnings: string[]
}

/**
 * Drops each finding whose matched line, or the line above it, carries `rulecast-ignore: <its id>
 * <reason>` (spec §8, Ignores), and records it as ignored.
 *
 * The comment is read through the same `read` the detector judged, so an ignore counts only in the
 * content being judged: staged in a staged run, proposed in a guard, on disk in a hook.
 */
export async function suppress(
  findings: readonly { rule: DetectorRule; match: Match }[],
  read: (file: string) => Promise<string | null>,
): Promise<Suppressed> {
  const result: Suppressed = { findings: [], ignored: [], warnings: [] }
  if (findings.length === 0) return result
  const lines = new Map<string, string[] | null>()
  const linesOf = async (file: string) => {
    if (!lines.has(file)) lines.set(file, (await read(file))?.split("\n") ?? null)
    return lines.get(file)!
  }
  const warned = new Set<string>()
  for (const finding of findings) {
    const source = await linesOf(finding.match.file)
    let ignore: Ignore | null = null
    let at = 0
    for (const line of [finding.match.line, finding.match.line - 1]) {
      const parsed = line >= 1 ? parseIgnore(source?.[line - 1] ?? "") : null
      if (parsed !== null && parsed.rule === finding.rule.id) {
        ignore = parsed
        at = line
        break
      }
    }
    if (ignore === null) {
      result.findings.push(finding)
      continue
    }
    if (ignore.reason === null) {
      const where = `${finding.match.file}:${at}`
      if (!warned.has(where)) {
        warned.add(where)
        result.warnings.push(`${where}: rulecast-ignore needs a reason after the rule id; the finding was kept`)
      }
      result.findings.push(finding)
      continue
    }
    result.ignored.push({ ...finding, reason: ignore.reason })
  }
  return result
}
