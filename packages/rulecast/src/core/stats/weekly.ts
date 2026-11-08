import type { FindingLife } from "./derive"
import type { FindingsRecord } from "./log"
import { rulesRun } from "./runs"

/**
 * A week's rate is shown only when the rule ran this often that week: below it, one finding moves
 * the rate by more than 5 per 100. Like the other floors here, a first guess, to be tuned from use.
 */
export const TREND_MIN_RUNS = 20
/** A rule's trend is readable only with this many findings in the window. */
export const TREND_MIN_FIRED = 10
/** A file counts as one the rule keeps firing on once it fired there in this many sessions. */
export const RECUR_MIN_SESSIONS = 3
/** The most recurring files listed per rule. */
export const RECUR_LIST = 10
/** How many weeks the weekly summary keeps (log.ts). */
export const WEEKLY_KEEP_WEEKS = 26

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

const startOf = (week: string) => Date.parse(`${week}T00:00:00.000Z`)

/** The week of an instant: the Monday 00:00 UTC on or before it, as `YYYY-MM-DD`. */
export function weekOf(at: string): string {
  const time = Date.parse(at)
  const day = Math.floor(time / DAY_MS)
  // 1970-01-01 was a Thursday: day 0 is 3 days after a Monday.
  const monday = day - ((day + 3) % 7)
  return new Date(monday * DAY_MS).toISOString().slice(0, 10)
}

export function addWeeks(week: string, weeks: number): string {
  return new Date(startOf(week) + weeks * WEEK_MS).toISOString().slice(0, 10)
}

/** One rule's counts in one week. Also the shape of a summary line, without its v/to. */
export interface WeekRow {
  week: string
  rule: string
  /** Records in the week that ran the rule (rulesRun). */
  runs: number
  /** Sessions with such a record. */
  sessions: number
  /** Lives of the rule first reported in the week. */
  fired: number
  /** File -> sessions in which the rule fired there this week. */
  files: Record<string, number>
  /** The oldest record or first report counted in this row. */
  first: string
}

interface Bucket {
  week: string
  rule: string
  runs: number
  sessions: Set<string>
  fired: number
  files: Map<string, Set<string>>
  first: string
}

const byWeekAndRule = (a: { week: string; rule: string }, b: { week: string; rule: string }) =>
  a.week < b.week ? -1 : a.week > b.week ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0

/**
 * Per week and rule: the records that ran it, and the finding lives first reported then. Counts
 * only records with `at > after` and lives with `firstAt > after` (`after` null: all): what is at
 * or before it is counted in the weekly summary already.
 */
export function weekRows(
  records: readonly FindingsRecord[],
  lives: readonly FindingLife[],
  after: string | null,
): WeekRow[] {
  const buckets = new Map<string, Bucket>()
  const bucket = (at: string, rule: string) => {
    const week = weekOf(at)
    const key = `${week}\u0000${rule}`
    let found = buckets.get(key)
    if (found === undefined) {
      found = { week, rule, runs: 0, sessions: new Set(), fired: 0, files: new Map(), first: at }
      buckets.set(key, found)
    }
    if (at < found.first) found.first = at
    return found
  }
  for (const record of records) {
    if (after !== null && record.at <= after) continue
    for (const rule of rulesRun(record)) {
      const counted = bucket(record.at, rule)
      counted.runs++
      counted.sessions.add(record.s)
    }
  }
  for (const life of lives) {
    if (after !== null && life.firstAt <= after) continue
    const counted = bucket(life.firstAt, life.rule)
    counted.fired++
    const sessions = counted.files.get(life.file) ?? new Set()
    counted.files.set(life.file, sessions)
    sessions.add(life.session)
  }
  return [...buckets.values()]
    .map((counted) => ({
      week: counted.week,
      rule: counted.rule,
      runs: counted.runs,
      sessions: counted.sessions.size,
      fired: counted.fired,
      files: Object.fromEntries([...counted.files].map(([file, sessions]) => [file, sessions.size])),
      first: counted.first,
    }))
    .sort(byWeekAndRule)
}

export interface TrendWeek {
  week: string
  runs: number
  sessions: number
  fired: number
  /** fired * 100 / runs, one decimal; null when runs < TREND_MIN_RUNS. */
  firedPer100Runs: number | null
  /** The data does not cover the whole week: it starts after the week's Monday, or ends before the next. */
  partial: boolean
}

export interface RuleTrend {
  rule: string
  fired: number
  /** fired >= TREND_MIN_FIRED */
  enoughFindings: boolean
  weeks: TrendWeek[]
  /** Files the rule fired on in >= RECUR_MIN_SESSIONS sessions, most first, then by path; at most RECUR_LIST. */
  recurringFiles: { file: string; sessions: number }[]
  recurringFileCount: number
}

export interface WeeklyTrend {
  /** The first instant the trend covers, or null with no data. */
  from: string | null
  /** Records up to here are counted from the weekly summary, not the log; null when there is none. */
  rolledUpTo: string | null
  rules: RuleTrend[]
}

/**
 * Sums rows by (week, rule) (files summed per file), keeps weeks >= weekOf(since) when since is given,
 * and fills every week from the first to weekOf(last) with zeros where a rule has no row.
 * `last` is the newest record (live log, else the summary's `to`).
 */
export function weeklyTrend(
  rows: readonly WeekRow[],
  window: { since: string | null; last: string | null; rolledUpTo: string | null },
): WeeklyTrend {
  const sinceWeek = window.since === null ? null : weekOf(window.since)
  const kept = rows.filter((row) => sinceWeek === null || row.week >= sinceWeek)
  if (kept.length === 0) return { from: null, rolledUpTo: window.rolledUpTo, rules: [] }

  const summed = new Map<string, Map<string, WeekRow>>()
  for (const row of kept) {
    const weeks = summed.get(row.rule) ?? new Map<string, WeekRow>()
    summed.set(row.rule, weeks)
    const sum = weeks.get(row.week)
    if (sum === undefined) {
      weeks.set(row.week, { ...row, files: { ...row.files } })
      continue
    }
    sum.runs += row.runs
    sum.sessions += row.sessions
    sum.fired += row.fired
    for (const [file, sessions] of Object.entries(row.files)) sum.files[file] = (sum.files[file] ?? 0) + sessions
    if (row.first < sum.first) sum.first = row.first
  }

  const earliest = kept.reduce(
    (first, row) => (Date.parse(row.first) < Date.parse(first) ? row.first : first),
    kept[0]!.first,
  )
  const from =
    sinceWeek !== null && startOf(sinceWeek) > Date.parse(earliest)
      ? new Date(startOf(sinceWeek)).toISOString()
      : earliest
  const firstWeek = kept.reduce((first, row) => (row.week < first ? row.week : first), kept[0]!.week)
  let lastWeek = kept.reduce((last, row) => (row.week > last ? row.week : last), kept[0]!.week)
  if (window.last !== null && weekOf(window.last) > lastWeek) lastWeek = weekOf(window.last)
  const weekList: string[] = []
  for (let week = firstWeek; week <= lastWeek; week = addWeeks(week, 1)) weekList.push(week)

  const fromWeek = weekOf(from)
  const partial = (week: string) =>
    (week === fromWeek && Date.parse(from) > startOf(week)) ||
    (window.last !== null && Date.parse(window.last) < startOf(addWeeks(week, 1)))

  const rules = [...summed]
    .map(([rule, weeks]): RuleTrend => {
      const files = new Map<string, number>()
      let fired = 0
      const trendWeeks = weekList.map((week): TrendWeek => {
        const row = weeks.get(week)
        const counts = row ?? { runs: 0, sessions: 0, fired: 0, files: {} }
        fired += counts.fired
        for (const [file, sessions] of Object.entries(counts.files)) files.set(file, (files.get(file) ?? 0) + sessions)
        return {
          week,
          runs: counts.runs,
          sessions: counts.sessions,
          fired: counts.fired,
          firedPer100Runs: counts.runs < TREND_MIN_RUNS ? null : Math.round((counts.fired * 1000) / counts.runs) / 10,
          partial: partial(week),
        }
      })
      const recurring = [...files]
        .filter(([, sessions]) => sessions >= RECUR_MIN_SESSIONS)
        .map(([file, sessions]) => ({ file, sessions }))
        .sort((a, b) => b.sessions - a.sessions || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      return {
        rule,
        fired,
        enoughFindings: fired >= TREND_MIN_FIRED,
        weeks: trendWeeks,
        recurringFiles: recurring.slice(0, RECUR_LIST),
        recurringFileCount: recurring.length,
      }
    })
    .filter((trend) => trend.fired > 0)
    .sort((a, b) => b.fired - a.fired || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
  return { from, rolledUpTo: window.rolledUpTo, rules }
}
