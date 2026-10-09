import type { CompiledRule } from "../compile/rule"
import type { DetectionContext } from "../detection/context"
import { fileBytes, readSourceFile } from "../detection/per-rule"
import { type BaselineChanges, computeChanges } from "./baseline"
import type { Fingerprints } from "./fingerprint"
import { type Snapshot, snapshotOf } from "./hash"
import { recordFingerprints } from "./record"
import { type BaselineRecord, type BaselineState, mergeFingerprints, snapshotRecord } from "./store"

/**
 * What a finding is new against (spec §8), owned in one place.
 *
 * The pipeline used to assemble this from three blocks, six mutable locals and a fingerprint merge
 * of its own. These functions **return records and never append them**: every baseline append is
 * lock-free (`withLock` guards only the session commit), so safety rests on each event's records
 * landing in one `O_APPEND` write, snapshots before the fingerprints measured from them. Two appends
 * would let a reader see a fingerprint whose snapshot had not landed — measured against a baseline
 * it cannot see, which is worse than no fingerprint at all. The caller appends once.
 */

export interface BaselineInput {
  root: string
  detection: DetectionContext
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  limits: { editDeadlineMs: number; verifyMs: number; maxFileBytes: number }
}

/**
 * On `touch`: a snapshot of every file that has none, and what the project's `container` rules
 * match in it — measured here because the content on disk is still the baseline.
 *
 * Records are in append order: each snapshot before the fingerprints taken from it. Only
 * `edit`-stage rules are measured: those are the cheap in-process ones by construction (§13, slow
 * tools default to verify), and a verify fills in the rest itself.
 */
export async function touchRecords(
  input: BaselineInput,
  state: BaselineState,
  files: readonly string[],
): Promise<BaselineRecord[]> {
  const records: BaselineRecord[] = []
  const snapshotted: string[] = []
  for (const file of files) {
    if (state.snapshots.has(file)) continue
    const text = await readSourceFile(input.root, file)
    if (text === null) continue
    records.push(snapshotRecord(file, snapshotOf(text)))
    snapshotted.push(file)
  }
  if (snapshotted.length === 0) return records
  records.push(
    ...(await recordFingerprints({
      detection: input.detection,
      files: snapshotted,
      rules: input.rules,
      disabled: input.disabled,
      read: (file) => readSourceFile(input.root, file),
      event: "edit",
      source: "disk",
      timeoutMs: input.limits.editDeadlineMs,
      ceiling: { maxFileBytes: input.limits.maxFileBytes, sizeOf: (file) => fileBytes(input.root, file) },
    })),
  )
  return records
}

export interface ChangesResult {
  /** The files worth running detectors on: a session verify drops files back at their snapshot. */
  files: string[]
  changes: BaselineChanges
  /** The session's fingerprints with anything this verify measured merged in. */
  fingerprints: Fingerprints
  /** To append in one call, when there is a session; empty on an edit. */
  records: BaselineRecord[]
}

/**
 * On `edit` and `verify`: what changed against the baseline, and — on a verify — the container
 * fingerprints a commit baseline was missing.
 *
 * The baseline is the session's snapshots, falling back to its start commit; `baseCommit`
 * (`run --from-ref`) replaces both. A verify has seconds where an edit has 350 ms, so it measures a
 * container rule's baseline itself instead of falling back to line overlap, which is what lets a
 * pull-request gate see the classification the hooks do. Only files whose baseline *is* the
 * commit: where a snapshot exists, the commit may not be what the agent started from.
 */
export async function changesFor(
  input: BaselineInput,
  event: { kind: "edit" | "verify"; baseCommit?: string },
  state: BaselineState | null,
  files: readonly string[],
): Promise<ChangesResult> {
  let snapshots: ReadonlyMap<string, Snapshot> = state?.snapshots ?? new Map()
  let fallbackCommit = state?.startCommit ?? null
  if (event.kind === "verify" && event.baseCommit) {
    fallbackCommit = event.baseCommit
    snapshots = new Map()
  }

  const changes = await computeChanges(input.root, files, { snapshots, fallbackCommit })
  // Files edited but back to their snapshot content have nothing new.
  const kept =
    event.kind === "verify" && state !== null && !event.baseCommit
      ? files.filter((file) => changes.sets.get(file)?.changedLines.length !== 0)
      : [...files]

  // Copied, so a caller's state is never changed underneath it.
  const fingerprints: BaselineState["fingerprints"] = new Map(
    [...(state?.fingerprints ?? [])].map(([file, byRule]) => [file, new Map(byRule)]),
  )
  if (event.kind !== "verify" || changes.fromCommit.size === 0) {
    return { files: kept, changes, fingerprints, records: [] }
  }
  const texts = changes.fromCommit
  const missing = [...texts.keys()].filter((file) => !fingerprints.has(file))
  const records =
    missing.length === 0
      ? []
      : await recordFingerprints({
          detection: input.detection,
          files: missing,
          rules: input.rules,
          disabled: input.disabled,
          read: async (file) => texts.get(file) ?? null,
          event: "verify",
          source: "memory",
          timeoutMs: input.limits.verifyMs,
        })
  return { files: kept, changes, fingerprints: mergeFingerprints(fingerprints, records), records }
}
