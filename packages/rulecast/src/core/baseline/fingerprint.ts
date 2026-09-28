import type { RuleScope } from "../config/schema"
import type { Match } from "../types"
import type { BaselineChanges } from "./baseline"
import { isNew } from "./baseline"
import type { LineMap } from "./changes"

/** Where a `container` rule's baseline matches are recorded: file → rule → ranges. */
export type Fingerprints = ReadonlyMap<string, ReadonlyMap<string, [number, number][]>>

/**
 * Where a baseline range sits in the current file, or null when none of it survived.
 *
 * Only the lines that are still there count. A container the agent deleted outright — or rewrote
 * line for line — no longer exists, and must not stand in for whatever now occupies its lines: if
 * a route was replaced wholesale, the violation in what replaced it is the agent's.
 */
export function mapRange(map: LineMap, [start, end]: [number, number]): [number, number] | null {
  let first: number | null = null
  let last = 0
  for (const run of map.runs) {
    const from = Math.max(start, run.beforeStart)
    const to = Math.min(end, run.beforeStart + run.count - 1)
    if (from > to) continue
    if (first === null) first = run.afterStart + (from - run.beforeStart)
    last = run.afterStart + (to - run.beforeStart)
  }
  return first === null ? null : [first, last]
}

/**
 * New or pre-existing, by the rule's own scope (spec §8).
 *
 * `instance` is the historical rule and the default: new when the match touches a line the agent
 * changed. `container` asks a different question — did the node this match spans already violate
 * the rule? — which is the right one when the convention belongs to the enclosing function rather
 * than to the token inside it. An edit that adds one `if` to an already-long route does not make
 * the route newly non-slim; an edit that pushes a compliant route over does.
 *
 * Without a fingerprint record, `container` falls back to `instance`. That is the safe direction:
 * instance over-reports where the container comparison under-reports, and it is what a missing
 * baseline has always meant.
 */
export function classify(
  match: Match,
  scope: RuleScope,
  rule: string,
  changes: BaselineChanges,
  fingerprints: Fingerprints,
): "new" | "preexisting" {
  const instance = () => (isNew(match, changes.sets) ? "new" : "preexisting")
  if (scope === "instance") return instance()
  const recorded = fingerprints.get(match.file)?.get(rule)
  const map = changes.maps.get(match.file)
  if (recorded === undefined || map === undefined) return instance()
  for (const range of recorded) {
    const mapped = mapRange(map, range)
    if (mapped !== null && match.line <= mapped[1] && match.endLine >= mapped[0]) return "preexisting"
  }
  return "new"
}
