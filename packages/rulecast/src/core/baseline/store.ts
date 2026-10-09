import path from "node:path"

import { appendRecords, readRecords } from "../jsonl"
import type { Snapshot } from "./hash"

export type BaselineRecord =
  | { t: "start"; commit: string | null }
  | { t: "snapshot"; file: string; fileHash: number; lines: string }
  | { t: "fingerprint"; file: string; rule: string; ranges: [number, number][] }

export interface BaselineState {
  started: boolean
  startCommit: string | null
  snapshots: Map<string, Snapshot>
  /**
   * What a `container` rule matched in each file's baseline content (§8): file → rule → ranges.
   *
   * An absent entry and an empty one mean different things. Absent: the rule was never measured
   * against this file's baseline — no snapshot, over `max_file_bytes`, past the deadline, or an
   * `llm` rule, which is never run for fingerprints. Present and empty: it was measured and the
   * file was clean, so every match found later is new. That difference is the whole feature.
   */
  fingerprints: Map<string, Map<string, [number, number][]>>
}

function storeFile(sessionDir: string): string {
  return path.join(sessionDir, "baseline.jsonl")
}

function encodeLines(lines: Uint32Array): string {
  return Buffer.from(lines.buffer, lines.byteOffset, lines.byteLength).toString("base64")
}

function decodeLines(encoded: string): Uint32Array {
  const bytes = Buffer.from(encoded, "base64")
  const aligned = new Uint8Array(bytes.length)
  aligned.set(bytes)
  return new Uint32Array(aligned.buffer)
}

export function startRecord(commit: string | null): BaselineRecord {
  return { t: "start", commit }
}

export function snapshotRecord(file: string, snapshot: Snapshot): BaselineRecord {
  return { t: "snapshot", file, fileHash: snapshot.fileHash, lines: encodeLines(snapshot.lines) }
}

/**
 * Ranges are plain JSON, not the base64 packing snapshots use: a container rule matches a handful
 * of nodes in a file, so there is nothing to compress and a readable store is worth more.
 */
export function fingerprintRecord(file: string, rule: string, ranges: [number, number][]): BaselineRecord {
  return { t: "fingerprint", file, rule, ranges }
}

export async function appendBaseline(sessionDir: string, records: BaselineRecord[]): Promise<void> {
  await appendRecords(storeFile(sessionDir), records)
}

/**
 * Adds fingerprint records to `into`, first record per file and rule winning.
 *
 * The one merge, used by the store when it reads and by a verify that measured fingerprints in
 * memory. First-wins is the store's guarantee: baseline appends are lock-free, so two events can
 * measure the same file at once, and readers must agree on which measurement counts. A verify used
 * to merge last-wins; that only ever agreed because it measured files with no record at all.
 */
export function mergeFingerprints(
  into: BaselineState["fingerprints"],
  records: readonly BaselineRecord[],
): BaselineState["fingerprints"] {
  for (const record of records) {
    if (record.t !== "fingerprint") continue
    const byRule = into.get(record.file) ?? new Map<string, [number, number][]>()
    into.set(record.file, byRule)
    if (!byRule.has(record.rule)) byRule.set(record.rule, record.ranges)
  }
  return into
}

/** First start record wins; first snapshot per file wins; first fingerprint per file and rule wins. */
export async function readBaseline(sessionDir: string): Promise<BaselineState> {
  const state: BaselineState = { started: false, startCommit: null, snapshots: new Map(), fingerprints: new Map() }
  const records = await readRecords<BaselineRecord>(storeFile(sessionDir))
  for (const record of records) {
    if (record.t === "start" && !state.started) {
      state.started = true
      state.startCommit = record.commit
    } else if (record.t === "snapshot" && !state.snapshots.has(record.file)) {
      state.snapshots.set(record.file, { fileHash: record.fileHash, lines: decodeLines(record.lines) })
    }
  }
  mergeFingerprints(state.fingerprints, records)
  return state
}
