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
  return (await snapshotRecords(input, state, files, null)).records
}

/** Most dirty files snapshotted at session start; the rest fall back to the start commit. */
export const START_SNAPSHOT_MAX = 200

/**
 * On `start`: snapshots of the files already dirty, so a file the agent later changes without
 * reading it through its edit tools (`cat`, then `sed -i`) is judged against what the user had, not
 * the commit (spec §8). Bounded, because SessionStart has a hook timeout: at most
 * `START_SNAPSHOT_MAX` files and the edit deadline. `skipped` counts the files past either limit.
 * First writer wins, as on `touch`: a resume never replaces a snapshot.
 */
export async function startRecords(
  input: BaselineInput,
  state: BaselineState,
  files: readonly string[],
): Promise<{ records: BaselineRecord[]; skipped: number }> {
  return snapshotRecords(input, state, files, {
    max: START_SNAPSHOT_MAX,
    deadlineAt: Date.now() + input.limits.editDeadlineMs,
  })
}

async function snapshotRecords(
  input: BaselineInput,
  state: BaselineState,
  files: readonly string[],
  bounds: { max: number; deadlineAt: number } | null,
): Promise<{ records: BaselineRecord[]; skipped: number }> {
  const records: BaselineRecord[] = []
  const snapshotted: string[] = []
  const pending = files.filter((file) => !state.snapshots.has(file))
  let taken = 0
  for (const file of pending) {
    if (bounds !== null && (taken >= bounds.max || Date.now() >= bounds.deadlineAt)) break
    taken++
    const text = await readSourceFile(input.root, file)
    if (text === null) continue
    records.push(snapshotRecord(file, snapshotOf(text)))
    snapshotted.push(file)
  }
  const skipped = pending.length - taken
  // Fingerprints are an optimisation a verify fills in itself, so a start out of time skips them.
  const timeoutMs = bounds === null ? input.limits.editDeadlineMs : bounds.deadlineAt - Date.now()
  if (snapshotted.length === 0 || timeoutMs <= 0) return { records, skipped }
  records.push(
    ...(await recordFingerprints({
      detection: input.detection,
      files: snapshotted,
      rules: input.rules,
      disabled: input.disabled,
      read: (file) => readSourceFile(input.root, file),
      event: "edit",
      source: "disk",
      timeoutMs,
      ceiling: { maxFileBytes: input.limits.maxFileBytes, sizeOf: (file) => fileBytes(input.root, file) },
    })),
  )
  return { records, skipped }
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
  /** Current content, as the detectors will read it (core/content.ts). Default: the working tree. */
  read?: (file: string) => Promise<string | null>,
): Promise<ChangesResult> {
  let snapshots: ReadonlyMap<string, Snapshot> = state?.snapshots ?? new Map()
  let fallbackCommit = state?.startCommit ?? null
  if (event.kind === "verify" && event.baseCommit) {
    fallbackCommit = event.baseCommit
    snapshots = new Map()
  }

  const changes = await computeChanges(input.root, files, { snapshots, fallbackCommit }, read)
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
