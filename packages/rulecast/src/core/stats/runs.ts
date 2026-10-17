import type { FindingsRecord } from "./log"

/**
 * Per rule, how many checks ran it to completion on at least one file: edit checks and stops, never
 * a guard, which judges a write that has not happened. A rule with no finding and many runs has
 * not been broken; one with no runs at all has a `files` pattern nothing the agents changed matched.
 */
export function ruleRuns(records: readonly FindingsRecord[]): Map<string, number> {
  const runs = new Map<string, number>()
  for (const record of records) {
    for (const [rule, files] of Object.entries(record.ran)) {
      if (files.length > 0) runs.set(rule, (runs.get(rule) ?? 0) + 1)
    }
  }
  return runs
}

export type StopSize = "1" | "2-5" | "6+"

export interface StopBlocks {
  rule: string
  /** Stops that ran the rule, by how many files it ran on there, and how many of them it blocked. */
  byFiles: { files: StopSize; stops: number; blocked: number }[]
}

const SIZES: readonly StopSize[] = ["1", "2-5", "6+"]
const sizeOf = (files: number): StopSize => (files <= 1 ? "1" : files <= 5 ? "2-5" : "6+")

/**
 * For each rule that blocked a stop, its block rate by the number of files it judged at the stop.
 * A rule whose findings are partly wrong gets one more chance to block with every file: a block rate
 * that climbs with the size of the stop, whatever the files hold, is that (abide #27, where one rule
 * blocked no one-file stop and half of those with 11 files or more).
 */
export function stopBlocks(records: readonly FindingsRecord[]): StopBlocks[] {
  const byRule = new Map<string, Map<StopSize, { stops: number; blocked: number }>>()
  for (const record of records) {
    if (record.ev !== "stop") continue
    const blocking = new Set(record.found.filter((found) => found.o === "blocked").map((found) => found.r))
    for (const [rule, files] of Object.entries(record.ran)) {
      if (files.length === 0) continue
      const sizes = byRule.get(rule) ?? new Map()
      byRule.set(rule, sizes)
      const bucket = sizes.get(sizeOf(files.length)) ?? { stops: 0, blocked: 0 }
      sizes.set(sizeOf(files.length), bucket)
      bucket.stops++
      if (blocking.has(rule)) bucket.blocked++
    }
  }
  return [...byRule]
    .filter(([, sizes]) => [...sizes.values()].some((bucket) => bucket.blocked > 0))
    .map(([rule, sizes]) => ({
      rule,
      byFiles: SIZES.map((files) => ({ files, ...(sizes.get(files) ?? { stops: 0, blocked: 0 }) })),
    }))
    .sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
}
