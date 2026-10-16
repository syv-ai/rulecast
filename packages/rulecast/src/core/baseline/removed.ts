import type { DetectorRule } from "../compile/rule"
import type { DetectionOutput } from "../detection/run"
import type { Selection } from "../detection/select"
import type { Match } from "../types"
import type { BaselineChanges } from "./baseline"
import type { Fingerprints } from "./fingerprint"

export interface Removed {
  /** One per file whose count dropped, always new: the drop is the change's by construction. */
  findings: { rule: DetectorRule; match: Match }[]
  /** The detection output without any `removed` rule's matches, which are not violations. */
  output: DetectionOutput
}

/**
 * `scope: removed` (spec §8): a match is something the rule keeps — an assertion — and the finding
 * is a file with fewer of them than at its baseline.
 *
 * The baseline count is the fingerprint record's length (baseline/record.ts), taken when the
 * container rules' ranges are. No record — no baseline, a rule that was not measured, a file over
 * the size ceiling — is no finding: there is nothing to compare with, and guessing would report
 * every file. Nor is a file that is gone. A rule that failed or timed out now is skipped the same
 * way, since its zero is not a count. Matches silenced by a `rulecast-ignore` still count, as they
 * did at the baseline.
 *
 * The finding sits on the first changed line, or the file's last line when that is a deletion at
 * its end (line 1 when nothing changed, which a count drop without a changed line cannot be). Its `text` says how many went: `2 of 5 removed`.
 */
export async function removedFindings(
  selections: readonly Selection[],
  output: DetectionOutput,
  changes: BaselineChanges,
  fingerprints: Fingerprints,
  /** The file's content now, as the detectors read it: only to clamp the finding's line. */
  read: (file: string) => Promise<string | null>,
): Promise<Removed> {
  const counting = selections.filter((selection) => selection.rule.scope === "removed")
  if (counting.length === 0) return { findings: [], output }

  const ids = new Set(counting.map((selection) => selection.rule.id))
  const failed = new Set([...output.errors, ...output.timedOut].flatMap((entry) => entry.rules))
  const key = (file: string, rule: string) => `${file}\u0000${rule}`
  const now = new Map<string, number>()
  for (const { rule, match } of [...output.findings, ...output.ignored]) {
    if (!ids.has(rule.id)) continue
    now.set(key(match.file, rule.id), (now.get(key(match.file, rule.id)) ?? 0) + 1)
  }

  const findings: Removed["findings"] = []
  for (const { rule, files } of counting) {
    if (failed.has(rule.id)) continue
    for (const file of files) {
      // No change set: the file is gone, or has no baseline. A deleted file has nothing to count,
      // and the shell and `run --from-ref` paths never hand one over, so it is not reported here
      // either: the rule says what it covers the same way on every path.
      const change = changes.sets.get(file)
      const before = fingerprints.get(file)?.get(rule.id)?.length
      if (change === undefined || before === undefined) continue
      const after = now.get(key(file, rule.id)) ?? 0
      if (after >= before) continue
      // A deletion at the end of the file is marked on the line after the last one: clamped.
      const line = Math.min(change.changedLines[0]?.[0] ?? 1, await lastLine(read, file))
      findings.push({
        rule,
        match: {
          file,
          line,
          endLine: line,
          column: 1,
          text: `${before - after} of ${before} removed`,
          captures: Object.fromEntries(rule.detector.captures.map((name) => [name, ""])),
        },
      })
    }
  }
  return {
    findings,
    output: {
      ...output,
      findings: output.findings.filter(({ rule }) => !ids.has(rule.id)),
      ignored: output.ignored.filter(({ rule }) => !ids.has(rule.id)),
    },
  }
}

/** The file's last line, not counting the empty one after a final newline. At least 1. */
async function lastLine(read: (file: string) => Promise<string | null>, file: string): Promise<number> {
  const text = await read(file)
  if (text === null) return 1
  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines.at(-1) === "") lines.pop()
  return Math.max(1, lines.length)
}
