import path from "node:path"

import { appendRecords, readRecords } from "../jsonl"
import type { Snapshot } from "./hash"

type BaselineRecord =
  | { t: "start"; commit: string | null }
  | { t: "snapshot"; file: string; fileHash: number; lines: string }

export interface BaselineState {
  started: boolean
  startCommit: string | null
  snapshots: Map<string, Snapshot>
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

export async function appendBaseline(sessionDir: string, records: BaselineRecord[]): Promise<void> {
  await appendRecords(storeFile(sessionDir), records)
}

/** First start record wins; first snapshot per file wins. */
export async function readBaseline(sessionDir: string): Promise<BaselineState> {
  const state: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  for (const record of await readRecords<BaselineRecord>(storeFile(sessionDir))) {
    if (record.t === "start" && !state.started) {
      state.started = true
      state.startCommit = record.commit
    } else if (record.t === "snapshot" && !state.snapshots.has(record.file)) {
      state.snapshots.set(record.file, { fileHash: record.fileHash, lines: decodeLines(record.lines) })
    }
  }
  return state
}
