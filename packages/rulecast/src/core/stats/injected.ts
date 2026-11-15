import path from "node:path"
import { z } from "zod"

import { errorMessage } from "../errors"
import { appendRecordsCapped } from "../jsonl"
import type { Delivery, EventKind } from "../types"
import { readLines } from "./log"

/**
 * How much rulecast puts before the agents (agreed with both leads, 2026-11-15): per agent-hook
 * answer that reached the model, its characters (additionalContext, a block's reason, a refused
 * write's reason), split into the doc sections given in full, the findings' own lines, and the rest,
 * rulecast's own words. What only the user sees (systemMessage) is not counted. `rulecast stats`
 * shows it as ≈ tokens, chars ÷ 4, a rough rate that holds for English and code alike.
 */
export const INJECTED_LOG = "injected.jsonl"
export const INJECTED_LOG_ROTATED = "injected.1.jsonl"
/** The current file is rotated at this size, so the two hold about 4 MiB. */
const INJECTED_LOG_MAX_BYTES = 2 * 1024 * 1024
const INJECTED_LOG_VERSION = 1

/** A single injection past this many tokens is a dump, not one or two doc sections. */
export const SINGLE_FLAG_TOKENS = 2000
/**
 * A session past this many tokens per agent turn (stop) is flagged: a long session grows with its
 * length, not with waste, so the rate is what tells (Conductor lead).
 */
export const PER_TURN_FLAG_TOKENS = 1000

/** What reached the model, by the event that sent it. */
export type InjectedEvent = "read" | "edit" | "shell" | "stop" | "refused" | "compact" | "start" | "subagent-start"

const EVENT_OF: Partial<Record<EventKind, InjectedEvent>> = {
  touch: "read",
  edit: "edit",
  "shell-after": "shell",
  verify: "stop",
  guard: "refused",
  reset: "compact",
  start: "start",
  "agent-start": "subagent-start",
}

export interface InjectedRecord {
  v: typeof INJECTED_LOG_VERSION
  at: string
  /** Session id. */
  s: string
  /** Agent id; "main" for the main agent. */
  a: string
  ev: InjectedEvent
  /** Characters that reached the model from this project. */
  chars: number
  /** Each doc section given in full, and its characters. */
  docs: [ref: string, chars: number][]
  /** Characters of the findings' own lines. */
  findings: number
  /** Re-delivered after a compact: the same sections again. */
  again?: true
}

/** The record of one answer, or null when nothing of this project reached the model. */
export function injectedRecord(input: {
  at: string
  session: string
  agent: string
  kind: EventKind
  delivery: Delivery
  /** This project's share of what reached the model. */
  chars: number
  /**
   * Doc sections already counted for another project of the same answer, by ref and location: the
   * combined answer gave each once (core/delivery/combine.ts). Filled with this record's.
   */
  counted?: Set<string>
  /** Only rulecast's own words reached the model (an unattended `incomplete` hold): no docs, no findings. */
  ownWordsOnly?: boolean
}): InjectedRecord | null {
  const ev = EVENT_OF[input.kind]
  if (ev === undefined || input.chars <= 0) return null
  const counted = input.counted ?? new Set<string>()
  const docs: [string, number][] = []
  // What reached the model can be less than the sections (the adapter cuts the tail to its limit):
  // the sections count for no more than this project's share.
  let room = input.chars
  for (const reference of input.ownWordsOnly === true ? [] : input.delivery.references) {
    const key = `${reference.ref}\n${reference.location ?? ""}`
    if (reference.state !== "full" || counted.has(key) || room <= 0) continue
    counted.add(key)
    const chars = Math.min((reference.content ?? "").length, room)
    room -= chars
    docs.push([reference.ref, chars])
  }
  const findings =
    input.ownWordsOnly === true ? 0 : input.delivery.findings.reduce((sum, finding) => sum + finding.message.length, 0)
  return {
    v: INJECTED_LOG_VERSION,
    at: input.at,
    s: input.session,
    a: input.agent,
    ev,
    chars: input.chars,
    docs,
    findings: Math.min(findings, room),
    ...(ev === "compact" ? { again: true as const } : {}),
  }
}

export async function appendInjected(
  stateDir: string,
  record: InjectedRecord | null,
  log: (line: string) => void,
): Promise<void> {
  if (record === null) return
  try {
    await appendRecordsCapped(path.join(stateDir, INJECTED_LOG), [record], {
      maxBytes: INJECTED_LOG_MAX_BYTES,
      rotateTo: path.join(stateDir, INJECTED_LOG_ROTATED),
    })
  } catch (error) {
    log(`injected log not written: ${errorMessage(error)}`)
  }
}

const recordSchema = z.object({
  v: z.literal(INJECTED_LOG_VERSION),
  at: z.string(),
  s: z.string(),
  a: z.string(),
  ev: z.enum(["read", "edit", "shell", "stop", "refused", "compact", "start", "subagent-start"]),
  chars: z.number(),
  docs: z.array(z.tuple([z.string(), z.number()])),
  findings: z.number(),
  again: z.literal(true).optional(),
})

/** Both files, oldest first; lines that don't read as a record are counted, not thrown on. */
export async function readInjected(stateDir: string): Promise<{ records: InjectedRecord[]; skipped: number }> {
  const out = { records: [] as InjectedRecord[], skipped: 0 }
  for (const name of [INJECTED_LOG_ROTATED, INJECTED_LOG]) {
    const read = await readLines(path.join(stateDir, name), recordSchema)
    if (read === null) continue
    out.records.push(...(read.values as InjectedRecord[]))
    out.skipped += read.skipped
  }
  return out
}

export interface InjectedStats {
  /** ≈ tokens, chars ÷ 4. */
  tokens: number
  events: number
  byEvent: Partial<Record<InjectedEvent, number>>
  /** Of `tokens`, re-delivered after a compact. */
  again: number
  /** Most first, each beside its turns (stops) and the rate; null with no stop in the findings log. */
  sessions: { session: string; tokens: number; turns: number; perTurn: number | null }[]
  /** Sessions past PER_TURN_FLAG_TOKENS a turn. */
  heavySessions: string[]
  /** Single injections past SINGLE_FLAG_TOKENS, largest first, with their largest doc section. */
  large: { at: string; session: string; ev: InjectedEvent; tokens: number; doc?: string }[]
  /** Doc sections by what they cost, most first, with the rules that cite them. */
  docs: { ref: string; tokens: number; deliveries: number; rules: string[] }[]
}

const tokensOf = (chars: number) => Math.round(chars / 4)

/**
 * `turns`: stops per session, from the findings log (every agent's stop is recorded there).
 * `citedBy`: each doc section's ref to the rules that cite it.
 */
export function injectedStats(
  records: readonly InjectedRecord[],
  turns: ReadonlyMap<string, number>,
  citedBy: ReadonlyMap<string, readonly string[]>,
): InjectedStats {
  const byEvent: Partial<Record<InjectedEvent, number>> = {}
  const bySession = new Map<string, number>()
  const byDoc = new Map<string, { chars: number; deliveries: number }>()
  let chars = 0
  let again = 0
  const large: InjectedStats["large"] = []
  for (const record of records) {
    chars += record.chars
    if (record.again === true) again += record.chars
    byEvent[record.ev] = (byEvent[record.ev] ?? 0) + record.chars
    bySession.set(record.s, (bySession.get(record.s) ?? 0) + record.chars)
    for (const [ref, docChars] of record.docs) {
      const doc = byDoc.get(ref) ?? { chars: 0, deliveries: 0 }
      doc.chars += docChars
      doc.deliveries++
      byDoc.set(ref, doc)
    }
    const tokens = tokensOf(record.chars)
    if (tokens > SINGLE_FLAG_TOKENS) {
      const biggest = [...record.docs].sort((a, b) => b[1] - a[1])[0]
      large.push({
        at: record.at,
        session: record.s,
        ev: record.ev,
        tokens,
        ...(biggest === undefined ? {} : { doc: biggest[0] }),
      })
    }
  }
  const sessions = [...bySession]
    .map(([session, sessionChars]) => {
      const tokens = tokensOf(sessionChars)
      const sessionTurns = turns.get(session) ?? 0
      // No stop recorded (one not made yet, or rotated out of the findings log): no rate to judge.
      return {
        session,
        tokens,
        turns: sessionTurns,
        perTurn: sessionTurns === 0 ? null : Math.round(tokens / sessionTurns),
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
  return {
    tokens: tokensOf(chars),
    events: records.length,
    byEvent: Object.fromEntries(Object.entries(byEvent).map(([ev, evChars]) => [ev, tokensOf(evChars)])),
    again: tokensOf(again),
    sessions,
    heavySessions: sessions
      .filter((one) => one.perTurn !== null && one.perTurn > PER_TURN_FLAG_TOKENS)
      .map((one) => one.session),
    large: large.sort((a, b) => b.tokens - a.tokens),
    docs: [...byDoc]
      .map(([ref, doc]) => ({
        ref,
        tokens: tokensOf(doc.chars),
        deliveries: doc.deliveries,
        rules: [...(citedBy.get(ref) ?? [])],
      }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}
