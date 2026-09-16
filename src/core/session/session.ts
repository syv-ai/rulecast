import path from "node:path"

import { appendRecords, readRecords } from "../jsonl"
import type { Delivery } from "../types"
import type { Decision } from "./decide"
import { withLock } from "./lock"
import { type ContextRecord, type ContextState, foldContext, foldWork, type WorkRecord, type WorkState } from "./state"

export interface SessionView {
  work: WorkState
  context: ContextState
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

export function sessionDir(root: string, sessionId: string): string {
  return path.join(root, ".rulecast", ".state", "sessions", safeSegment(sessionId))
}

const workFile = (dir: string) => path.join(dir, "work.jsonl")
const contextFile = (dir: string, agent: string) => path.join(dir, `context.${safeSegment(agent)}.jsonl`)

export async function appendWork(dir: string, records: WorkRecord[]): Promise<void> {
  await appendRecords(workFile(dir), records)
}

export async function appendContext(dir: string, agent: string, records: ContextRecord[]): Promise<void> {
  await appendRecords(contextFile(dir, agent), records)
}

export async function openSession(dir: string, agent: string): Promise<SessionView> {
  const [work, context] = await Promise.all([
    readRecords<WorkRecord>(workFile(dir)),
    readRecords<ContextRecord>(contextFile(dir, agent)),
  ])
  return { work: foldWork(work), context: foldContext(context) }
}

/** Re-reads the session under the lock, decides, appends the decision's records. */
export async function commitSession(
  dir: string,
  agent: string,
  decideWith: (view: SessionView) => Promise<Decision>,
): Promise<Delivery> {
  return withLock(dir, async () => {
    const decision = await decideWith(await openSession(dir, agent))
    await appendWork(dir, decision.work)
    await appendContext(dir, agent, decision.context)
    return decision.delivery
  })
}
