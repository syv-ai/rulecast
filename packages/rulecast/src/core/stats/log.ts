import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { errorMessage, isNotFound } from "../errors"
import { appendRecordsCapped } from "../jsonl"
import type { Match } from "../types"

/**
 * The findings log (`rulecast stats`): one record per checked agent event, in the project's state
 * directory, shared by every session. Ids, rule ids, files and lines only — never a message, the
 * matched text or a capture, which can all hold the project's code — and never sent anywhere.
 *
 * Its format is internal and versioned by `v`; the `stats` JSON is the contract.
 */
export const FINDINGS_LOG = "findings.jsonl"
export const FINDINGS_LOG_ROTATED = "findings.1.jsonl"

/** The current file is rotated to `findings.1.jsonl` at this size, so the two hold about 8 MiB. */
export const FINDINGS_LOG_MAX_BYTES = 4 * 1024 * 1024

export const FINDINGS_LOG_VERSION = 1

/**
 * What a finding's rulecast told the agent when this record was written. `blocked`: it kept a stop
 * from going through. `refused`: its write was refused, or the agent was told to revert a shell
 * write. Whatever happened next (fixed, ignored, suppressed) is worked out by `stats` (derive.ts).
 */
export type WriteOutcome = "delivered" | "blocked" | "refused"

export interface LoggedMatch {
  /** Rule id (its alias, when it has one). */
  r: string
  /** Finding id (core/finding-id.ts). */
  id: string
  f: string
  l: number
}

export interface LoggedFinding extends LoggedMatch {
  o: WriteOutcome
}

export interface FindingsRecord {
  v: typeof FINDINGS_LOG_VERSION
  /** ISO time. */
  at: string
  /** Session id. */
  s: string
  /** Agent id; "main" for the main agent. */
  a: string
  /** `stop`: an agent's Stop or SubagentStop, which is also the end of one of its turns. */
  ev: "edit" | "stop" | "guard"
  via?: "shell"
  /** The files some rule ran on and completed. */
  files: string[]
  /**
   * Rule id to indexes into `files`: where it ran and completed. A finding of that rule in that
   * file that is not in `found` is gone, which is what "fixed" is made from. Empty for a guard,
   * which judges a write that has not happened and so cannot prove anything gone.
   */
  ran: Record<string, number[]>
  /** The agent's new findings this event, one per match: never pre-existing ones or the user's. */
  found: LoggedFinding[]
  /** Matches a `rulecast-ignore` dropped this event. */
  ign: LoggedMatch[]
}

const located = (rule: { id: string }, match: Match, id: string): LoggedMatch => ({
  r: rule.id,
  id,
  f: match.file,
  l: match.line,
})

export interface EventFindings {
  session: string
  agent: string
  ev: FindingsRecord["ev"]
  via?: "shell"
  at: Date
  findings: readonly { id: string; rule: { id: string }; match: Match; outcome: WriteOutcome }[]
  ignored: readonly { id?: string; rule: { id: string }; match: Match }[]
  ran: ReadonlyMap<string, readonly string[]>
}

/**
 * The record for one event, or null when no rule ran and nothing was found: it would say nothing.
 * A stop is always recorded, whatever it checked: it is the end of one of the agent's turns.
 */
export function findingsRecord(event: EventFindings): FindingsRecord | null {
  const files: string[] = []
  const index = new Map<string, number>()
  const ran: Record<string, number[]> = {}
  for (const [rule, ruleFiles] of event.ran) {
    ran[rule] = ruleFiles.map((file) => {
      let at = index.get(file)
      if (at === undefined) {
        at = files.push(file) - 1
        index.set(file, at)
      }
      return at
    })
  }
  if (event.ev !== "stop" && files.length === 0 && event.findings.length === 0) return null
  return {
    v: FINDINGS_LOG_VERSION,
    at: event.at.toISOString(),
    s: event.session,
    a: event.agent,
    ev: event.ev,
    ...(event.via === undefined ? {} : { via: event.via }),
    files,
    ran,
    found: event.findings.map(({ id, rule, match, outcome }) => ({ ...located(rule, match, id), o: outcome })),
    ign: event.ignored.flatMap(({ id, rule, match }) => (id === undefined ? [] : [located(rule, match, id)])),
  }
}

/**
 * Appends one record. Best effort: statistics must never fail a hook, so anything that goes wrong
 * goes to the debug log and nowhere else.
 */
export async function appendFindingsLog(
  stateDir: string,
  record: FindingsRecord | null,
  log: (line: string) => void,
): Promise<void> {
  if (record === null) return
  try {
    await appendRecordsCapped(path.join(stateDir, FINDINGS_LOG), [record], {
      maxBytes: FINDINGS_LOG_MAX_BYTES,
      rotateTo: path.join(stateDir, FINDINGS_LOG_ROTATED),
    })
  } catch (error) {
    log(`findings log not written: ${errorMessage(error)}`)
  }
}

const loggedMatchSchema = z.object({ r: z.string(), id: z.string(), f: z.string(), l: z.number() })

/** What the reader accepts: a parseable line of this version can still be cut short or hand-edited. */
const recordSchema = z.object({
  v: z.literal(FINDINGS_LOG_VERSION),
  at: z.string(),
  s: z.string(),
  a: z.string(),
  ev: z.enum(["edit", "stop", "guard"]),
  via: z.literal("shell").optional(),
  files: z.array(z.string()),
  ran: z.record(z.array(z.number().int().nonnegative())),
  found: z.array(loggedMatchSchema.extend({ o: z.enum(["delivered", "blocked", "refused"]) })),
  ign: z.array(loggedMatchSchema),
}) satisfies z.ZodType<FindingsRecord>

export interface FindingsLog {
  /** Oldest first: the rotated file, then the current one. */
  records: FindingsRecord[]
  /** Lines that were not a whole record this version understands. */
  skipped: number
  /** The log has been rotated at least once, so its oldest records may be gone. */
  rotated: boolean
}

/** Unlike `readRecords`, a bad line anywhere is skipped and counted: a statistic is not worth a failure. */
export async function readFindingsLog(stateDir: string): Promise<FindingsLog> {
  const result: FindingsLog = { records: [], skipped: 0, rotated: false }
  for (const name of [FINDINGS_LOG_ROTATED, FINDINGS_LOG]) {
    let text: string
    try {
      text = await readFile(path.join(stateDir, name), "utf8")
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
    if (name === FINDINGS_LOG_ROTATED) result.rotated = true
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        result.skipped++
        continue
      }
      const record = recordSchema.safeParse(value)
      if (record.success) result.records.push(record.data)
      else result.skipped++
    }
  }
  return result
}
