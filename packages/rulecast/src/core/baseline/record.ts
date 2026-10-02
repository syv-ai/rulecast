import type { CompiledRule } from "../compile/rule"
import { applySizeCeiling } from "../detection/budget"
import type { DetectionContext } from "../detection/context"
import { runDetection } from "../detection/run"
import { selectDetectorRules } from "../detection/select"
import type { DetectorEvent } from "../types"
import { type BaselineRecord, fingerprintRecord } from "./store"

export interface FingerprintInput {
  /** The project's detection context (detection/context.ts). */
  detection: DetectionContext
  /** The files to measure. `read` must serve each one's *baseline* content, not what is on disk now. */
  files: readonly string[]
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  read(file: string): Promise<string | null>
  /** Which stage's rules to measure: `edit` on the touch path, `verify` when a verify fills gaps. */
  event: DetectorEvent
  timeoutMs: number
  /**
   * Where the baseline content is. `disk`: it is the file, so any detector can measure it. `memory`:
   * `read` is serving content that is not on disk, so only detectors that read through `read` can —
   * a linter or a command handed a path would measure the file as it stands now, which is the one
   * thing this must not do. That is exactly the `guards` contract (§6).
   */
  source: "disk" | "memory"
  /** Omitted when the content is already in memory: the ceiling exists to bound reading and parsing. */
  ceiling?: { maxFileBytes: number; sizeOf(file: string): Promise<number | null> }
}

/**
 * What the project's `container` rules match in these files' baseline content (spec §8).
 *
 * One record per `(file, rule)` pair that was actually measured — including an empty one for a
 * rule that matched nothing, which is the record that lets a later match be called new. A rule
 * that errored, timed out or was skipped by the size ceiling emits nothing, so classification
 * falls back to `instance` rather than pretending the file was clean.
 *
 * `llm` rules are never measured. A fingerprint run is a second evaluation of the rule, and for
 * `llm` that is a billed model call as a side effect of the agent opening a file, which §6's
 * consent rule does not allow. A container `llm` rule classifies as `instance`.
 *
 * Never throws: a baseline that cannot be measured is a baseline that is missing, and the caller
 * already handles that.
 */
export async function recordFingerprints(input: FingerprintInput): Promise<BaselineRecord[]> {
  // The overwhelmingly common case. Cost is one array scan, not a detector run.
  if (!input.rules.some((rule) => rule.scope === "container")) return []

  const guards = (kind: string) => input.detection.registry.get(kind)?.guards === true
  let selections = selectDetectorRules(input.rules, input.event, input.files, input.disabled).filter(
    (selection) =>
      selection.rule.scope === "container" &&
      selection.rule.detector.kind !== "llm" &&
      (input.source === "disk" || guards(selection.rule.detector.kind)),
  )
  if (input.ceiling) {
    const applied = await applySizeCeiling(selections, input.ceiling.maxFileBytes, guards, input.ceiling.sizeOf)
    selections = applied.selections
  }
  if (selections.length === 0) return []

  const output = await runDetection({
    detection: input.detection,
    event: input.event,
    selections,
    // No change set: the baseline content is being measured whole, and there is nothing it is a
    // change from. A detector that reads `changes` treats an absent file as entirely new, which is
    // exactly right here.
    changes: new Map(),
    read: input.read,
    timeoutMs: input.timeoutMs,
  })

  const unmeasured = new Set<string>()
  for (const error of output.errors) for (const rule of error.rules) unmeasured.add(rule)
  for (const timeout of output.timedOut) for (const rule of timeout.rules) unmeasured.add(rule)

  const key = (file: string, rule: string) => `${file}\u0000${rule}`
  const ranges = new Map<string, [number, number][]>()
  for (const { rule, match } of output.findings) {
    const found = ranges.get(key(match.file, rule.id))
    if (found === undefined) ranges.set(key(match.file, rule.id), [[match.line, match.endLine]])
    else found.push([match.line, match.endLine])
  }

  const records: BaselineRecord[] = []
  for (const { rule, files } of selections) {
    if (unmeasured.has(rule.id)) continue
    for (const file of files) records.push(fingerprintRecord(file, rule.id, ranges.get(key(file, rule.id)) ?? []))
  }
  return records
}
