import type { CompiledRule } from "../compile/rule"
import { applySizeCeiling } from "../detection/budget"
import type { DetectorRegistry } from "../detection/registry"
import { runDetection } from "../detection/run"
import { selectDetectorRules } from "../detection/select"
import type { Cache, DetectorEvent, DetectorSettings, ResolvedReference } from "../types"
import { type BaselineRecord, fingerprintRecord } from "./store"

export interface FingerprintInput {
  root: string
  /** The files to measure. `read` must serve each one's *baseline* content, not what is on disk now. */
  files: readonly string[]
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  registry: DetectorRegistry
  read(file: string): Promise<string | null>
  cacheFor(kind: string): Cache
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
  settings: DetectorSettings
  /** Which stage's rules to measure: `edit` on the touch path, `verify` when a verify fills gaps. */
  event: DetectorEvent
  timeoutMs: number
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

  let selections = selectDetectorRules(input.rules, input.event, input.files, input.disabled).filter(
    (selection) => selection.rule.scope === "container" && selection.rule.detector.kind !== "llm",
  )
  if (input.ceiling) {
    const bounded = (kind: string) => input.registry.get(kind)?.guards === true
    const applied = await applySizeCeiling(selections, input.ceiling.maxFileBytes, bounded, input.ceiling.sizeOf)
    selections = applied.selections
  }
  if (selections.length === 0) return []

  const output = await runDetection({
    root: input.root,
    event: input.event,
    selections,
    // No change set: the baseline content is being measured whole, and there is nothing it is a
    // change from. A detector that reads `changes` treats an absent file as entirely new, which is
    // exactly right here.
    changes: new Map(),
    read: input.read,
    registry: input.registry,
    cacheFor: input.cacheFor,
    contextFor: input.contextFor,
    settings: input.settings,
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
