import type { FindingsRecord } from "./log"

/**
 * One finding's life in one session, from the event that first reported it to the one that
 * settled it. Replayed from the findings log (log.ts) when `rulecast stats` runs, so the hooks only
 * ever append.
 */
export interface FindingLife {
  session: string
  /** The agent whose event first reported it. */
  agent: string
  id: string
  rule: string
  file: string
  firstAt: string
  /**
   * `fixed`: a later check ran its rule on its file and it was gone. `suppressed`: a
   * `rulecast-ignore` dropped it. `prevented`: only ever on refused writes, and the agent's next
   * stop came without it — it never reached the file. `ignored`: still there at a stop when the log
   * ends. `open`: still there, and no stop has seen it — the session is still going, or ended
   * without one.
   */
  state: "fixed" | "suppressed" | "prevented" | "ignored" | "open"
  /** Events that reported it. */
  deliveries: number
  /** Stops it was still there at. */
  stopsPresent: number
  /** Stops it blocked. */
  blocks: number
  /** Writes refused, or shell writes the agent was told to revert, over it. */
  refusals: number
  /** For a fixed one: the agent's stops between its first report and the fix; 0 is the same turn. */
  turnsToFix: number | null
}

/** Present at two stops, or refused twice: the agent kept hitting it instead of fixing it. */
export const REPEAT_AFTER = 2

interface Open extends FindingLife {
  stopsAtOpen: number
  /** Where it was last reported. */
  line: number
}

const covers = (record: FindingsRecord, rule: string, file: string) =>
  record.ran[rule]?.some((index) => record.files[index] === file) === true

/**
 * Replays the log, oldest first, and returns every life that began at or after `since`. Records
 * from before it are still replayed: a finding first seen then and fixed later is not counted.
 *
 * Two known imprecisions, both from what an id is: editing the offending text without fixing it
 * reads as a fix and a new finding, and a finding the context budget kept out of a delivery still
 * counts as delivered.
 */
export function derive(records: readonly FindingsRecord[], since: Date | null = null): FindingLife[] {
  // Stable: records written in the same millisecond keep their order in the file.
  const ordered = records.map((record, index) => ({ record, index }))
  ordered.sort((a, b) => (a.record.at < b.record.at ? -1 : a.record.at > b.record.at ? 1 : a.index - b.index))

  const open = new Map<string, Map<string, Open>>()
  const stops = new Map<string, number>()
  const lives: FindingLife[] = []
  const close = (life: Open, state: FindingLife["state"], turnsToFix: number | null = null) => {
    const { stopsAtOpen: _, line: __, ...settled } = life
    lives.push({ ...settled, state, turnsToFix })
  }

  for (const { record } of ordered) {
    let session = open.get(record.s)
    if (session === undefined) {
      session = new Map()
      open.set(record.s, session)
    }
    const stopsOf = (agent: string) => stops.get(`${record.s}\u0000${agent}`) ?? 0
    const found = new Map(record.found.map((finding) => [finding.id, finding]))
    const ignored = new Set(record.ign.map((match) => match.id))
    // An inline `rulecast-ignore` can change the id it silences, when the match is the whole line
    // (llm, or an excerpt): the same rule ignored on the line it was last reported on is it.
    const ignoredAt = new Set(record.ign.map((match) => `${match.r}\u0000${match.f}\u0000${match.l}`))
    const seen = (life: Open, finding: { o: string; l: number }) => {
      const outcome = finding.o
      life.line = finding.l
      life.deliveries++
      if (record.ev === "stop") life.stopsPresent++
      if (outcome === "blocked") life.blocks++
      if (outcome === "refused") life.refusals++
    }

    for (const [id, life] of session) {
      const finding = found.get(id)
      if (finding !== undefined) seen(life, finding)
      else if (ignored.has(id) || ignoredAt.has(`${life.rule}\u0000${life.file}\u0000${life.line}`)) {
        session.delete(id)
        close(life, "suppressed")
      } else if (covers(record, life.rule, life.file)) {
        session.delete(id)
        close(life, "fixed", stopsOf(life.agent) - life.stopsAtOpen)
      } else if (record.ev === "stop" && record.a === life.agent && life.refusals === life.deliveries) {
        // A refused write the agent gave up on: the file was never edited, so no check will see it gone.
        session.delete(id)
        close(life, "prevented")
      }
    }
    for (const finding of record.found) {
      if (session.has(finding.id)) continue
      const life: Open = {
        session: record.s,
        agent: record.a,
        id: finding.id,
        rule: finding.r,
        file: finding.f,
        firstAt: record.at,
        state: "open",
        deliveries: 0,
        stopsPresent: 0,
        blocks: 0,
        refusals: 0,
        turnsToFix: null,
        stopsAtOpen: stopsOf(record.a),
        line: finding.l,
      }
      seen(life, finding)
      session.set(finding.id, life)
    }
    // After the lives: a finding gone at this stop was fixed in the turn that is ending.
    if (record.ev === "stop") stops.set(`${record.s}\u0000${record.a}`, stopsOf(record.a) + 1)
  }
  for (const session of open.values()) {
    for (const life of session.values()) close(life, life.stopsPresent > 0 ? "ignored" : "open")
  }
  const from = since?.toISOString()
  return lives.filter((life) => from === undefined || life.firstAt >= from)
}

export const isRepeated = (life: FindingLife) => life.stopsPresent >= REPEAT_AFTER || life.refusals >= REPEAT_AFTER

/**
 * A rule is flagged noisy only once it has fired this often: below it, one bad session is the
 * whole rate. The two rates are a starting guess, to be tuned from what `stats` shows in practice.
 */
export const NOISY_MIN_FIRED = 5
/** A rule whose findings the agent keeps hitting instead of fixing: its message may not say how. */
export const NOISY_REPEAT_RATE = 0.3
/** A rule the agent keeps silencing: it may be wrong, or too broad. */
export const NOISY_SUPPRESSION_RATE = 0.2

export interface RuleStats {
  rule: string
  fired: number
  blocked: number
  refused: number
  fixed: number
  ignored: number
  suppressed: number
  prevented: number
  open: number
  repeated: number
  medianTurnsToFix: number | null
  repeatRate: number
  suppressionRate: number
  noisy: ("repeats" | "suppressed")[]
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Two decimals: enough to compare against a threshold, and stable to print. */
const rate = (count: number, of: number) => (of === 0 ? 0 : Math.round((count / of) * 100) / 100)

/** Per rule, most fired first, then by id. */
export function ruleStats(lives: readonly FindingLife[]): RuleStats[] {
  const byRule = new Map<string, FindingLife[]>()
  for (const life of lives) {
    const group = byRule.get(life.rule)
    if (group === undefined) byRule.set(life.rule, [life])
    else group.push(life)
  }
  const stats = [...byRule].map(([rule, group]): RuleStats => {
    const count = (predicate: (life: FindingLife) => boolean) => group.filter(predicate).length
    const fired = group.length
    const repeated = count(isRepeated)
    const suppressed = count((life) => life.state === "suppressed")
    const repeatRate = rate(repeated, fired)
    const suppressionRate = rate(suppressed, fired)
    const noisy: RuleStats["noisy"] = []
    if (fired >= NOISY_MIN_FIRED && repeatRate >= NOISY_REPEAT_RATE) noisy.push("repeats")
    if (fired >= NOISY_MIN_FIRED && suppressionRate >= NOISY_SUPPRESSION_RATE) noisy.push("suppressed")
    return {
      rule,
      fired,
      blocked: count((life) => life.blocks > 0),
      refused: count((life) => life.refusals > 0),
      fixed: count((life) => life.state === "fixed"),
      ignored: count((life) => life.state === "ignored"),
      suppressed,
      prevented: count((life) => life.state === "prevented"),
      open: count((life) => life.state === "open"),
      repeated,
      medianTurnsToFix: median(group.flatMap((life) => (life.turnsToFix === null ? [] : [life.turnsToFix]))),
      repeatRate,
      suppressionRate,
      noisy,
    }
  })
  return stats.sort((a, b) => b.fired - a.fired || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
}
