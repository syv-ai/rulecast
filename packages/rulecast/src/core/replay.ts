import type { TranscriptEdit, TranscriptSession } from "../adapters/claude-code/transcript"
import { computeChanges, isNew } from "./baseline/baseline"
import { snapshotOf } from "./baseline/hash"
import type { CompiledProject } from "./compile/project"
import type { DetectorRule } from "./compile/rule"
import type { DetectionContext } from "./detection/context"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectDetectorRules } from "./detection/select"
import { renderTemplate } from "./template"
import type { DetectorEvent } from "./types"

/**
 * `rulecast replay`: what the project's rules would have done in sessions that already happened,
 * judged from the transcript alone. Each edit is judged on what it changed, the way the edit hook
 * judges it, and each turn on what it changed from its first edit of a file to its last, the way
 * the stop does. Nothing is written to a session store or the findings log: a replay is not a
 * session, and `rulecast stats` must not count it.
 *
 * Content comes from the transcript, not the disk, so only rules whose detector reads content can
 * run (`regex`, `path`, `ast-grep`, `llm`, linters that take stdin). A rule whose tool needs the
 * files on disk, a `command` script or a whole-project tool, is skipped and named, and so is a
 * `scope: removed` rule.
 */
export interface ReplayFinding {
  session: string
  agent: string
  turn: number
  /** `edit`: the edit hook would have told the agent. `turn`: the stop would have. */
  stage: "edit" | "turn"
  rule: string
  file: string
  line: number
  message: string
}

export interface ReplayRuleStats {
  rule: string
  severity: "error" | "warning"
  /** Edits the rule was run on, and those it found something new in. */
  edits: number
  editsFired: number
  /** Turns the rule was run on at their end, and those it found something new in. */
  turns: number
  turnsFired: number
  /** Turns whose stop the rule would have blocked: an `error` finding there. */
  wouldBlock: number
}

export interface ReplayResult {
  sessions: number
  edits: number
  turns: number
  /** Edits a transcript records but whose file before them it never showed: not judged. */
  unknownEdits: number
  rules: ReplayRuleStats[]
  findings: ReplayFinding[]
  /**
   * Rules that would have run but cannot from a transcript: their tool needs files on disk, or they
   * are `scope: removed`, which counts what a file keeps against a baseline a replay does not take.
   */
  skippedRules: string[]
  /** Rules whose detector failed, with the first message. */
  errors: { rule: string; message: string }[]
}

export interface ReplayInput {
  project: CompiledProject
  registry: DetectorRegistry
  detection: DetectionContext
  sessions: readonly TranscriptSession[]
  /** Detector kinds left out: the metered ones, unless asked for. */
  skipKinds: ReadonlySet<string>
  onlyRules?: ReadonlySet<string>
  timeoutMs: number
}

/** Model calls an llm rule would make: one per file per judged event (llm groups its rules into one call). */
export function meteredCalls(input: Omit<ReplayInput, "detection" | "timeoutMs">): number {
  const metered = (rule: DetectorRule) => input.registry.get(rule.detector.kind)?.metered === true
  let calls = 0
  for (const { stage, files } of judged(input.sessions)) {
    const selections = selectDetectorRules(input.project.rules, stage, files, new Set()).filter(
      ({ rule }) => metered(rule) && (input.onlyRules?.has(rule.id) ?? true),
    )
    calls += new Set(selections.flatMap((selection) => selection.files)).size
  }
  return calls
}

interface Judged {
  session: string
  agent: string
  turn: number
  stage: DetectorEvent
  files: string[]
  edits: Map<string, { before: string | null; after: string }>
}

/** Every event a replay judges: each edit, then the turn it ended. */
function* judged(sessions: readonly TranscriptSession[]): Generator<Judged> {
  for (const { session, agents } of sessions) {
    for (const { agent, turns } of agents) {
      for (const { index, edits } of turns) {
        for (const edit of edits) {
          yield { session, agent, turn: index, stage: "edit", files: [edit.file], edits: new Map([[edit.file, edit]]) }
        }
        const net = netChanges(edits)
        yield { session, agent, turn: index, stage: "verify", files: [...net.keys()], edits: net }
      }
    }
  }
}

/** Per file, its content before the turn's first edit of it and after the last. */
function netChanges(edits: readonly TranscriptEdit[]): Map<string, { before: string | null; after: string }> {
  const net = new Map<string, { before: string | null; after: string }>()
  for (const edit of edits) {
    const first = net.get(edit.file)
    net.set(edit.file, { before: first === undefined ? edit.before : first.before, after: edit.after })
  }
  return net
}

export async function replay(input: ReplayInput): Promise<ReplayResult> {
  const { registry } = input
  const readsContent = (rule: DetectorRule) => {
    const detector = registry.get(rule.detector.kind)
    return detector?.guards === true || detector?.takesContent?.(rule.detector.config) === true
  }
  const stats = new Map<string, ReplayRuleStats>()
  const statsOf = (rule: DetectorRule) => {
    let entry = stats.get(rule.id)
    if (entry === undefined) {
      entry = {
        rule: rule.id,
        severity: rule.severity,
        edits: 0,
        editsFired: 0,
        turns: 0,
        turnsFired: 0,
        wouldBlock: 0,
      }
      stats.set(rule.id, entry)
    }
    return entry
  }
  const skipped = new Set<string>()
  const errors = new Map<string, string>()
  const findings: ReplayFinding[] = []
  let edits = 0
  let turns = 0

  for (const event of judged(input.sessions)) {
    if (event.stage === "edit") edits++
    else turns++
    const selections = selectDetectorRules(input.project.rules, event.stage, event.files, new Set()).filter(
      ({ rule }) =>
        !input.skipKinds.has(rule.detector.kind) && (input.onlyRules?.has(rule.id) ?? true) && !errors.has(rule.id),
    )
    const runnable = selections.filter(({ rule }) => {
      // A removed rule counts what a file keeps against its baseline count, which a replay does not take.
      if (readsContent(rule) && rule.scope !== "removed") return true
      skipped.add(rule.id)
      return false
    })
    if (runnable.length === 0) continue

    const read = async (file: string) => event.edits.get(file)?.after ?? null
    // A file that did not exist before is all new: no snapshot, so no change set, which detectors read as new.
    const snapshots = new Map(
      [...event.edits]
        .filter(([, edit]) => edit.before !== null)
        .map(([file, edit]) => [file, edit.before as string] as const),
    )
    const changes = await computeChanges(
      "",
      [...snapshots.keys()],
      {
        snapshots: new Map([...snapshots].map(([file, text]) => [file, snapshotOf(text)])),
        fallbackCommit: null,
      },
      read,
    )
    const output = await runDetection({
      detection: input.detection,
      event: event.stage,
      selections: runnable,
      changes: changes.sets,
      read,
      fromDisk: false,
      timeoutMs: input.timeoutMs,
    })
    for (const error of output.errors) for (const rule of error.rules) errors.set(rule, error.message)
    for (const timeout of output.timedOut)
      for (const rule of timeout.rules) errors.set(rule, `timed out after ${input.timeoutMs} ms`)

    const fired = new Set<string>()
    for (const { rule, match } of output.findings) {
      if (!isNew(match, changes.sets)) continue
      fired.add(rule.id)
      findings.push({
        session: event.session,
        agent: event.agent,
        turn: event.turn,
        stage: event.stage === "edit" ? "edit" : "turn",
        rule: rule.id,
        file: match.file,
        line: match.line,
        message: renderTemplate(rule.message, {
          ...match.captures,
          file: match.file,
          line: String(match.line),
          column: String(match.column),
          text: match.text,
          rule: rule.id,
        }),
      })
    }
    for (const { rule } of runnable) {
      if (errors.has(rule.id)) continue
      const entry = statsOf(rule)
      if (event.stage === "edit") {
        entry.edits++
        if (fired.has(rule.id)) entry.editsFired++
      } else {
        entry.turns++
        if (fired.has(rule.id)) {
          entry.turnsFired++
          if (rule.severity === "error") entry.wouldBlock++
        }
      }
    }
  }

  return {
    sessions: input.sessions.length,
    edits,
    turns,
    unknownEdits: input.sessions.reduce(
      (sum, session) => sum + session.agents.reduce((count, agent) => count + agent.unknown, 0),
      0,
    ),
    rules: [...stats.values()].sort(
      (a, b) => b.turnsFired + b.editsFired - (a.turnsFired + a.editsFired) || (a.rule < b.rule ? -1 : 1),
    ),
    findings,
    skippedRules: [...skipped].sort(),
    errors: [...errors].map(([rule, message]) => ({ rule, message })),
  }
}
