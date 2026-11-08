import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { errorMessage, isNotFound } from "../errors"
import { appendRecordsCapped } from "../jsonl"
import type { Match } from "../types"
import { derive } from "./derive"
import { addWeeks, WEEKLY_KEEP_WEEKS, type WeekRow, weekOf, weekRows } from "./weekly"

/**
 * The findings log (`rulecast stats`): one record per checked agent event, in the project's state
 * directory, shared by every session. Ids, rule ids, files and lines only — never a message, the
 * matched text or a capture, which can all hold the project's code — and never sent anywhere.
 *
 * Its format is internal and versioned by `v`; the `stats` JSON is the contract.
 *
 * The weekly summary (`stats.weekly_summary`, off by default) holds even less: per week and rule,
 * counts and the files the rule fired on. It is written only when a rotation drops the oldest file.
 */
export const FINDINGS_LOG = "findings.jsonl"
export const FINDINGS_LOG_ROTATED = "findings.1.jsonl"
/** Per-week counts of log files a rotation dropped, for the last WEEKLY_KEEP_WEEKS weeks. */
export const FINDINGS_WEEKLY = "findings-weekly.jsonl"

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
  /**
   * Unattended: matches under ignores the agent added or changed this session, which silenced
   * nothing (they are in `found` as well). Absent when there are none.
   */
  tried?: LoggedMatch[]
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
  /** Ignores that silenced nothing (unattended). */
  tried?: readonly { id?: string; rule: { id: string }; match: Match }[]
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
  const tried = (event.tried ?? []).flatMap(({ id, rule, match }) =>
    id === undefined ? [] : [located(rule, match, id)],
  )
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
    ...(tried.length === 0 ? {} : { tried }),
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
  options: { weeklySummary: boolean },
): Promise<void> {
  if (record === null) return
  try {
    await appendRecordsCapped(path.join(stateDir, FINDINGS_LOG), [record], {
      maxBytes: FINDINGS_LOG_MAX_BYTES,
      rotateTo: path.join(stateDir, FINDINGS_LOG_ROTATED),
      ...(options.weeklySummary ? { beforeDrop: (file: string) => rollUpDropped(stateDir, file, log) } : {}),
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
  tried: z.array(loggedMatchSchema).optional(),
}) satisfies z.ZodType<FindingsRecord>

export interface FindingsLog {
  /** Oldest first: the rotated file, then the current one. */
  records: FindingsRecord[]
  /** Lines that were not a whole record this version understands. */
  skipped: number
  /** The log has been rotated at least once, so its oldest records may be gone. */
  rotated: boolean
  /** `findings.1.jsonl`'s fingerprint (logFingerprint), or null when there is none or it is empty. */
  rotatedFingerprint: string | null
  /** How many of `records`, from the start, came from `findings.1.jsonl`. */
  rotatedRecords: number
}

/**
 * Which log file this is: a hash of its first line. A file's first line never changes once written,
 * while its last lines can (a writer that opened it before a rotation still appends to it), so the
 * weekly summary marks each file it has counted with this rather than with a time.
 */
const logFingerprint = (firstLine: string) => createHash("sha256").update(firstLine).digest("hex").slice(0, 16)

interface ReadLines<T> {
  values: T[]
  skipped: number
  /** logFingerprint of the first line, or null for an empty file. */
  fingerprint: string | null
}

/** Lines that do not parse, or are not of a shape this version understands, are skipped and counted. */
async function readLines<T>(file: string, schema: z.ZodType<T>): Promise<ReadLines<T> | null> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const result: ReadLines<T> = { values: [], skipped: 0, fingerprint: null }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    result.fingerprint ??= logFingerprint(line)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      result.skipped++
      continue
    }
    const parsed = schema.safeParse(value)
    if (parsed.success) result.values.push(parsed.data)
    else result.skipped++
  }
  return result
}

/** Parses one log file: records, and lines skipped; null when there is no such file. */
export async function readRecordsFile(
  file: string,
): Promise<{ records: FindingsRecord[]; skipped: number; fingerprint: string | null } | null> {
  const read = await readLines(file, recordSchema)
  return read === null ? null : { records: read.values, skipped: read.skipped, fingerprint: read.fingerprint }
}

/** Like `readRecords`, a bad line anywhere is skipped; here it is also counted. */
export async function readFindingsLog(stateDir: string): Promise<FindingsLog> {
  const result: FindingsLog = { records: [], skipped: 0, rotated: false, rotatedFingerprint: null, rotatedRecords: 0 }
  for (const name of [FINDINGS_LOG_ROTATED, FINDINGS_LOG]) {
    const read = await readRecordsFile(path.join(stateDir, name))
    if (read === null) continue
    if (name === FINDINGS_LOG_ROTATED) {
      result.rotated = true
      result.rotatedFingerprint = read.fingerprint
      result.rotatedRecords = read.records.length
    }
    result.records.push(...read.records)
    result.skipped += read.skipped
  }
  return result
}

const count = z.number().int().nonnegative()

/**
 * One line of the weekly summary: a week row, the fingerprint of the log file it was counted from
 * (`log`), and that file's newest record (`to`, shown only).
 */
const weeklyLineSchema = z.object({
  v: z.literal(1),
  log: z.string(),
  to: z.string(),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rule: z.string(),
  runs: count,
  sessions: count,
  fired: count,
  files: z.record(count),
  first: z.string(),
})

type WeeklyLine = z.infer<typeof weeklyLineSchema>

export interface WeeklyRollup {
  rows: WeekRow[]
  /** The newest record the summary counts, or null with no summary. Shown only: nothing is cut by it. */
  rolledUpTo: string | null
  /** Fingerprints of the log files the summary counted: a live file among them is counted from here. */
  logs: Set<string>
  skipped: number
}

async function readWeeklyLines(stateDir: string): Promise<{ lines: WeeklyLine[]; skipped: number }> {
  const read = await readLines(path.join(stateDir, FINDINGS_WEEKLY), weeklyLineSchema)
  return read === null ? { lines: [], skipped: 0 } : { lines: read.values, skipped: read.skipped }
}

const newestTo = (lines: readonly WeeklyLine[]) =>
  lines.reduce<string | null>((last, { to }) => (last === null || to > last ? to : last), null)

export async function readWeeklyRollup(stateDir: string): Promise<WeeklyRollup> {
  const { lines, skipped } = await readWeeklyLines(stateDir)
  return {
    rows: lines.map(({ v: _, log: __, to: ___, ...row }) => row),
    rolledUpTo: newestTo(lines),
    logs: new Set(lines.map((line) => line.log)),
    skipped,
  }
}

/**
 * Adds the per-week counts of `dropped`, the log file a rotation is about to delete, to the weekly
 * summary, and prunes weeks more than WEEKLY_KEEP_WEEKS before `now`. A file is counted whole or
 * not at all, marked by its fingerprint: one summarised already (a crash before the rename, then
 * another rotation) adds nothing. Times decide nothing here, since a record's time is taken before
 * it is appended and a clock can be wrong. Never throws: a hook must not fail, or lose its record,
 * over statistics.
 */
export async function rollUpDropped(
  stateDir: string,
  dropped: string,
  log: (line: string) => void,
  now: Date = new Date(),
): Promise<void> {
  try {
    const { lines } = await readWeeklyLines(stateDir)
    const read = await readRecordsFile(dropped)
    if (read === null || read.fingerprint === null || read.records.length === 0) return
    const fingerprint = read.fingerprint
    if (lines.some((line) => line.log === fingerprint)) return
    const newest = read.records.reduce((last, { at }) => (at > last ? at : last), read.records[0]!.at)
    const rows = weekRows(read.records, derive(read.records))
    if (rows.length === 0) return
    const keepFrom = addWeeks(weekOf(now.toISOString()), -WEEKLY_KEEP_WEEKS)
    const kept = [...lines, ...rows.map((row): WeeklyLine => ({ v: 1, log: fingerprint, to: newest, ...row }))].filter(
      (line) => line.week >= keepFrom,
    )
    const file = path.join(stateDir, FINDINGS_WEEKLY)
    await writeFile(`${file}.tmp`, kept.map((line) => `${JSON.stringify(line)}\n`).join(""))
    await rename(`${file}.tmp`, file)
  } catch (error) {
    log(`weekly summary not written: ${errorMessage(error)}`)
  }
}
