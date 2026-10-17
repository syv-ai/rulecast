import { readFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"
import { appendRecordsCapped } from "../jsonl"

/**
 * What every agent's hooks did in this working tree, across sessions: when each shell call started
 * and ended and which files each Edit/Write changed. A shell call is judged by comparing the whole
 * tree before and after it, which has no writer; this log is how the call tells another agent's
 * edits made meanwhile from its own (abide #26: a reviewer session blocked for another session's
 * edits). Each session's own store cannot answer that: it sees only its own agents.
 *
 * Internal, project-wide, small: rotated at `MAX_BYTES`, read whole at each shell call's end.
 */
export type ActivityRecord =
  | { at: number; s: string; a: string; ev: "edit"; f: string[] }
  | { at: number; s: string; a: string; ev: "shell-before" | "shell-after"; tu?: string }

const FILE = "activity.jsonl"
const ROTATED = "activity.1.jsonl"
const MAX_BYTES = 256 * 1024

/** A call whose after hook never came (a killed hook) stops counting as running after this. */
const OPEN_CALL_MS = 10 * 60 * 1000

type ShellRecord = Extract<ActivityRecord, { ev: "shell-before" | "shell-after" }>

export async function appendActivity(stateDir: string, record: ActivityRecord): Promise<void> {
  await appendRecordsCapped(path.join(stateDir, FILE), [record], {
    maxBytes: MAX_BYTES,
    rotateTo: path.join(stateDir, ROTATED),
  })
}

/** Oldest first. A line that does not parse is skipped: the capped writer starts a fresh line after a partial one. */
export async function readActivity(stateDir: string): Promise<ActivityRecord[]> {
  const records: ActivityRecord[] = []
  for (const name of [ROTATED, FILE]) {
    let text: string
    try {
      text = await readFile(path.join(stateDir, name), "utf8")
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue
      try {
        const value = JSON.parse(line) as ActivityRecord
        if (typeof value?.at === "number" && typeof value.s === "string") records.push(value)
      } catch {
        // a partial line, cut off by a crash
      }
    }
  }
  return records
}

/** Without tool use ids, a before and an after of the same agent are taken for one call. */
const sameCall = (record: ShellRecord, other: ShellRecord) =>
  record.s === other.s && record.a === other.a && record.tu === other.tu

/**
 * What other agents did while this agent's shell call ran: the files their Edit/Write changed, and
 * whether one of their shell calls ran alongside it. An agent is a session and agent id together,
 * so a sibling subagent in the same session counts as another agent too.
 */
export function duringCall(
  records: readonly ActivityRecord[],
  self: { session: string; agent: string; toolUseId?: string },
  now: number = Date.now(),
): { edits: Set<string>; sharedShell: boolean } {
  const edits = new Set<string>()
  const isSelf = (record: ActivityRecord) => record.s === self.session && record.a === self.agent
  let started: ShellRecord | undefined
  for (const record of records) {
    if (record.ev !== "shell-before" || !isSelf(record)) continue
    if (self.toolUseId === undefined || record.tu === self.toolUseId) started = record
  }
  if (started === undefined) return { edits, sharedShell: false }

  let sharedShell = false
  records.forEach((record, index) => {
    if (isSelf(record)) return
    if (record.at >= started.at) {
      if (record.ev === "edit") for (const file of record.f) edits.add(file)
      else if (record.ev === "shell-before") sharedShell = true
      return
    }
    // Started before this call: still running when this one started, unless its after came first.
    if (record.ev !== "shell-before" || now - record.at > OPEN_CALL_MS) return
    const ended = records
      .slice(index + 1)
      .find((later) => later.ev === "shell-after" && sameCall(later, record) && later.at < started.at)
    if (ended === undefined) sharedShell = true
  })
  return { edits, sharedShell }
}
