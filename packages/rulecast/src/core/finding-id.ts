import { createHash } from "node:crypto"

import type { Match } from "./types"

/** Bumped when what an id hashes changes, so a stored id is never compared against a different scheme. */
export const FINDING_ID_VERSION = 1

/** Re-indenting a line or a CRLF checkout must not change what a finding is. */
const normalise = (value: string) => value.replace(/\s+/g, " ").trim()

/**
 * What a match is, apart from where it is: its text, then its captures by name. Captures a
 * detector declared volatile (a model's `reason`, which differs between two runs over the same
 * line) are left out, or the same finding would get a new id on every run.
 */
function contentOf(match: Match, volatile: readonly string[]): string {
  const captures = Object.keys(match.captures)
    .filter((name) => !volatile.includes(name))
    .sort()
    .map((name) => `${name}=${normalise(match.captures[name] ?? "")}`)
  return [normalise(match.text), ...captures].join("\u0000")
}

/**
 * A stable id per finding, in the same order as `items` (output contract, agents/reference/output.md).
 *
 * The id hashes the rule id (the alias, when one is set), the project-relative file, the match's
 * normalised content and an occurrence index, and **not the line**: a loop must recognise the same
 * violation after unrelated lines were inserted above it. The occurrence index numbers matches with
 * the same rule, file and content by position, so two identical violations in one file stay apart.
 * Changing the offending text changes the id, which is right: it is a different violation.
 *
 * `items` should include ignored matches too, so a `rulecast-ignore` on the first of two
 * duplicates does not renumber the second. `volatile` is the detector's `volatileCaptures`.
 */
export function findingIds(
  items: readonly { rule: { id: string; detector: { kind: string } }; match: Match }[],
  volatile: (kind: string) => readonly string[],
): string[] {
  const keys = items.map(
    ({ rule, match }) => `${rule.id}\u0000${match.file}\u0000${contentOf(match, volatile(rule.detector.kind))}`,
  )
  const groups = new Map<string, number[]>()
  keys.forEach((key, index) => {
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [index])
    else group.push(index)
  })
  const ids: string[] = new Array(items.length)
  for (const [key, indices] of groups) {
    const at = (index: number) => items[index]!.match
    indices.sort((a, b) => at(a).line - at(b).line || at(a).column - at(b).column || at(a).endLine - at(b).endLine)
    indices.forEach((index, occurrence) => {
      ids[index] = createHash("sha256")
        .update(`v${FINDING_ID_VERSION}\u0000${key}\u0000${occurrence}`)
        .digest("hex")
        .slice(0, 16)
    })
  }
  return ids
}
