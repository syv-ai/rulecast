import { existsSync } from "node:fs"
import path from "node:path"

import type { CommittedBaseline } from "./baseline/committed"
import type { HeadMove } from "./baseline/foreign"
import { type BaselineInput, startRecords, touchRecords } from "./baseline/stage"
import { appendBaseline, type BaselineState, readBaseline, startRecord } from "./baseline/store"
import type { CompiledProject, Diagnostic } from "./compile/project"
import type { CompiledRule } from "./compile/rule"
import { agentDir, copyIntoProject, writeOverflow } from "./delivery/persist"
import { createReferenceResolver, type ReferenceResolver } from "./delivery/resolve"
import { type DetectionContext, detectionFor } from "./detection/context"
import type { DetectorRegistry } from "./detection/registry"
import { selectTouchRules } from "./detection/select"
import { headCommit } from "./git"
import { guardWrite } from "./guard"
import { type Detected, detectStage } from "./pipeline-detect"
import { compileWarnings, type Warning } from "./pipeline-warnings"
import { displayPath } from "./projects"
import { appendActivity, duringCall, readActivity } from "./session/activity"
import { type ClassifiedFinding, type DecideInput, type Decision, decide, delivers, findingKey } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { configHash } from "./session/oversight"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import {
  editedBy,
  emptyContext,
  emptyWork,
  hasOwnTree,
  MAIN_AGENT,
  referenceState,
  sharedShell,
  sweptFor,
  treeRecord,
  type WorkRecord,
  type WorkState,
} from "./session/state"
import { isGone, type TreeState, treeChanges, treeState } from "./session/tree"
import { appendFindingsLog, findingsRecord, type WriteOutcome } from "./stats/log"
import type { IgnoredFinding } from "./suppress"
import { type Delivery, type Event, emptyDelivery } from "./types"

export interface PipelineOptions {
  /** Compiled by the caller: hooks never fetch rule repos, the CLI does (spec §4). */
  project: CompiledProject
  /** The project's directory in the cache (spec §12): sessions and detector caches. */
  stateDir: string
  event: Event
  registry: DetectorRegistry
  /** From the adapter; null = unlimited. */
  maxContextChars: number | null
  /**
   * Several pipelines sharing one event's budget (commands/hook.ts): called once, just before the
   * budget is applied, with whether this pipeline has anything for the agent; resolves to the share
   * to use in place of `maxContextChars`. Never called on a path that applies no budget.
   */
  shareBudget?: (delivers: boolean) => Promise<number | null>
  /** Recently accessed files the agent re-attaches after compaction (adapter.restoredFiles); reset re-delivers their touch context. */
  restoredFiles?: number
  /** Detector kinds to skip entirely: the metered ones, for a staged run or --no-llm (commands/run.ts). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Give every detector every file, past the file budget it declares: `rulecast baseline`, which asked for all of them. */
  ignoreFileBudgets?: boolean
  /** Run only these rules (rulecast run RULE_ID); touch rules are unaffected. */
  onlyRules?: ReadonlySet<string>
  /** verify from an agent's stop: decide block / allow / capReached. Needs a session. */
  stopGate?: boolean
  /**
   * The hook: only the main agent's subagents ran this project (each in its own worktree, say), and
   * its config's `subagent_projects` let the main agent's event in. Changes the advice of the notice
   * for a shared working tree, which a separate worktree does not cure.
   */
  subagentsProject?: boolean
  /**
   * `.rulecast/baseline.json`, for a verify with no baseline of its own (no session, no base
   * commit): a match whose id it lists is pre-existing. Any other baseline wins, so it is ignored
   * there. Hooks never pass it.
   */
  committedBaseline?: CommittedBaseline
  /** Render pre-existing findings in full into `Delivery.preexisting` (rulecast run's JSON and SARIF). */
  listPreexisting?: boolean
  /**
   * Say which configured rules did not run (Delivery.disabled), whatever the mode: `rulecast run`.
   * An agent's stop says it only in unattended mode, where nobody reads the warning given once (#29).
   * `rulecast run --session` also marks the run failed for a rule the session disabled after a
   * detector failure, and that would have run here, so its exit code does not say every rule ran.
   * A hook leaves this off: it warned when it disabled the rule.
   */
  reportDisabled?: boolean
  /** Ends detection early, as the deadline would: doctor's Ctrl-C. Hooks never pass one. */
  signal?: AbortSignal
  /** Debug log sink. */
  log?: (line: string) => void
  /**
   * The hook: the session's mode is recorded, so `rulecast run --session` judges the session in the
   * mode its hooks did. The CLI's own runs never record one.
   */
  recordMode?: boolean
  /**
   * An absolute directory every path in the returned delivery is shown relative to: where the agent
   * or the user is, when that is not the project root (core/projects.ts `displayPath`). Only what is
   * shown: the session's records, baselines, finding ids and the findings log stay root-relative.
   * Default: paths relative to the root, as they are stored.
   */
  displayFrom?: string
}

export interface PipelineResult {
  delivery: Delivery
  /** rulecast itself failed: compile diagnostics, detector errors or verify timeouts. */
  failed: boolean
  /** Detector kinds whose results were dropped at the edit deadline (§13). */
  deadlineMissed: string[]
  /** Findings a `rulecast-ignore` comment dropped (core/suppress.ts); absent when nothing was detected. */
  ignored?: IgnoredFinding[]
  /**
   * Every match this event classified, with its id and status, before merging and the context
   * budget cut anything; absent when nothing was detected.
   */
  findings?: ClassifiedFinding[]
  /**
   * Rule id to the files its detector ran on and completed: the selections after skipped kinds and
   * file budgets, without rules that errored, timed out or a staged run skipped. Absent when no
   * detector was run. A rule not listed was not checked: its absence from `findings` proves nothing.
   */
  ran?: Map<string, string[]>
}

/** Said once: without a working tree to compare, shell edits are seen only after the session. */
const TREE_UNAVAILABLE =
  "rulecast cannot see the working tree here; edits made with Bash are checked only by git hooks and CI"

/** Logged, not warned: a missed snapshot is a shell call left unjudged, like a missed edit deadline. */
const TREE_GAVE_UP =
  "working tree state unavailable: git failed or took longer than its timeout; this shell call is not judged"

/** Said once to an agent whose shell call ran alongside another agent's in this working tree. */
const SHARED_TREE =
  "rulecast: another agent ran a shell command in this working tree while yours ran. rulecast holds a " +
  "command to every file that changed while it ran, so findings here and at your stop may be another " +
  "agent's. Give each agent that runs in parallel its own worktree (in Claude Code, a subagent with " +
  "`isolation: worktree`)."

/** SHARED_TREE for a project only the main agent's subagents ran, which its config lets the main agent reach. */
const SUBAGENTS_TREE =
  "rulecast: a subagent ran a shell command in its own working tree while yours ran. Your shell calls are " +
  "checked there too, so findings from that tree, here and at your stop, may be the subagent's. To leave a " +
  "subagent's worktree to its own hooks, set `subagent_projects: exclude` in that worktree's " +
  "`.rulecast-config.yaml`."

/**
 * What every step of one invocation shares. Set once by `startRun`; the accumulators (`warnings`,
 * `deadlineMissed`, `movedNow`) are the only parts a step changes, and only by adding to them.
 */
export interface Run {
  options: PipelineOptions
  project: CompiledProject
  root: string
  config: CompiledProject["config"]
  stateDir: string
  registry: DetectorRegistry
  log: (line: string) => void
  /**
   * How a root-relative path is shown. Applied by decide (and the guard) to the delivery before the
   * budget, and here to the paths written after it; undefined leaves every path as it is stored.
   */
  display: ((file: string) => string) | undefined
  shown: (file: string) => string
  /** Compile errors: warnings (a branch-like rev) are for rulecast validate; only errors disable rules. */
  errors: Diagnostic[]
  /**
   * `rulecast run RULE_ID` is incomplete only over what could have changed that rule's result: its
   * own diagnostics, a failed repos entry that configures it, a config that did not load, or a
   * diagnostic that names no rule and no entry.
   */
  concernsRun: (diagnostic: Diagnostic) => boolean
  session: { dir: string; agent: string } | null
  sessionId: string | undefined
  /** The files any rule matches. */
  relevant: (files: readonly string[]) => string[]
  /** A record for the project-wide activity log (session/activity.ts), stamped now. */
  activityOf: (agent: string) => { at: number; s: string; a: string }
  warnings: Warning[]
  deadlineMissed: string[]
  /** Git operations seen by this invocation, not yet in the store it read (baseline/foreign.ts). */
  movedNow: HeadMove[]
}

function startRun(options: PipelineOptions): Run {
  const { project } = options
  const { root } = project
  const display = options.displayFrom === undefined ? undefined : displayPath(root, options.displayFrom)
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const only = options.onlyRules
  const event = options.event
  return {
    options,
    project,
    root,
    config: project.config,
    stateDir: options.stateDir,
    registry: options.registry,
    log: options.log ?? (() => {}),
    display,
    shown: display ?? ((file: string) => file),
    errors,
    concernsRun: (diagnostic) =>
      only === undefined ||
      diagnostic.fatal === true ||
      (diagnostic.rule !== null ? only.has(diagnostic.rule) : (diagnostic.rules?.some((id) => only.has(id)) ?? true)),
    session: event.session
      ? { dir: sessionDir(options.stateDir, event.session.id), agent: event.session.agentId ?? MAIN_AGENT }
      : null,
    sessionId: event.session?.id,
    relevant: (files) => files.filter((file) => project.rules.some((rule) => rule.matches(file))),
    activityOf: (agent) => ({ at: Date.now(), s: event.session?.id ?? "", a: agent }),
    warnings: compileWarnings(errors),
    deadlineMissed: [],
    movedNow: [],
  }
}

const empty = (): SessionView => ({ work: emptyWork(), context: emptyContext() })

/** A git operation's record, kept for this invocation too: the store it read does not have it yet. */
function headRecords(run: Run, move: HeadMove | null): WorkRecord[] {
  if (move === null) return []
  run.movedNow.push(move)
  return [{ t: "head", ...move }]
}

/**
 * What changed since the agent's latest recorded state that no tool call explains: not a file any
 * agent edited. A subagent with no state of its own sweeps nothing — the session's latest may be a
 * sibling's, taken before that sibling's command wrote — and leaves it to the main agent's stop.
 */
function between(run: Run, work: WorkState, agent: string, now: TreeState): { files: string[]; moved: WorkRecord[] } {
  if (!hasOwnTree(work, agent)) return { files: [], moved: [] }
  const reference = referenceState(work, agent)
  const gap = reference === null ? null : treeChanges(reference, now)
  if (gap === null) return { files: [], moved: [] }
  if (gap.gitOperation) return { files: [], moved: headRecords(run, gap.move) }
  const edited = new Set(work.edited)
  return { files: run.relevant(gap.files.filter((file) => !edited.has(file))), moved: [] }
}

/**
 * Spec §9, Shell edits: the state this call's changes are measured from. What changed since the
 * agent's last recorded state happened between its calls — the user's editor, a formatter, a job it
 * left running — and is swept, so it is never folded into this call. No output: swept findings are
 * reported at Stop, and this hook runs before every shell command.
 */
async function shellBefore(run: Run, event: Extract<Event, { kind: "shell-before" }>): Promise<void> {
  const { session } = run
  if (!session) return
  const now = await treeState(run.root)
  if (now === null) {
    run.log(TREE_GAVE_UP)
    return
  }
  const { work } = await openSession(session.dir, session.agent)
  const gap = between(run, work, session.agent, now)
  const swept = gap.files.filter((file) => !isGone(now, file))
  const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
  await appendWork(session.dir, [
    ...swept.map((file) => ({ t: "swept" as const, file, agent: session.agent })),
    ...gap.moved,
    treeRecord(work, { phase: "before", agent: session.agent, ...id }, now),
  ])
  await appendActivity(run.stateDir, { ...run.activityOf(session.agent), ev: "shell-before", tu: event.toolUseId })
}

/** A shell call that changed files the rules match: checked from here as the edit of those files. */
interface ShellEdit {
  files: string[]
  /** Another agent's shell call ran during this one, so what it changed may be partly theirs. */
  sharedCall: boolean
  /** Said to the agent at this call, once per session (Delivery.agentNotices). */
  agentNotices: string[]
}

/**
 * What changed during the call, against the state recorded before it. A moved HEAD is git's doing,
 * not an edit; no reference at all is a session that began before these hooks existed. Either way
 * the new state is recorded, so the next call has something to compare with. Null: nothing to check.
 */
async function shellAfter(
  run: Run,
  event: Extract<Event, { kind: "shell-after" }>,
  view: SessionView,
): Promise<ShellEdit | null> {
  const { session } = run
  if (!session) return null
  const now = await treeState(run.root)
  if (now === null) {
    run.log(TREE_GAVE_UP)
    return null
  }
  const reference = referenceState(view.work, session.agent, event.toolUseId)
  const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
  const call = reference === null ? null : treeChanges(reference, now)
  // What other agents did meanwhile, in this session or another in this working tree: a file their
  // Edit/Write changed is theirs, not this command's (abide #26).
  const others = duringCall(await readActivity(run.stateDir), {
    session: run.activityOf(session.agent).s,
    agent: session.agent,
    toolUseId: event.toolUseId,
  })
  await appendActivity(run.stateDir, { ...run.activityOf(session.agent), ev: "shell-after", tu: event.toolUseId })
  const files =
    call === null || call.gitOperation
      ? []
      : run.relevant(call.files.filter((file) => !isGone(now, file) && !others.edits.has(file)))
  // Another agent's shell call ran during this one, and this one is held to files: those may be the
  // other's writes (README, Agents). With no files there is nothing to misattribute. Told once per agent.
  const sharedCall = files.length > 0 && (others.sharedShell || sharedShell(view.work, session.agent, event.toolUseId))
  const sharedKey = `shared-tree:${session.agent}`
  const shared = sharedCall && !view.work.noticed.has(sharedKey)
  await appendWork(session.dir, [
    ...(call?.gitOperation === true ? headRecords(run, call.move) : []),
    treeRecord(view.work, { phase: "after", agent: session.agent, ...id }, now),
    ...(shared ? [{ t: "noticed" as const, key: sharedKey }] : []),
  ])
  if (files.length === 0) return null
  const notice = run.options.subagentsProject === true ? SUBAGENTS_TREE : SHARED_TREE
  return { files, sharedCall, agentNotices: shared ? [notice] : [] }
}

/**
 * At a stop: what changed since the agent's latest recorded state that no call of its explains — a
 * job it left running, a formatter, the user's own edits — joined with what earlier comparisons of
 * this agent's swept (every agent's, at the main agent's stop). A git operation in between sweeps
 * nothing.
 */
async function sweep(run: Run, view: SessionView, session: { dir: string; agent: string }): Promise<string[]> {
  const now = await treeState(run.root)
  const work = view.work
  let found: string[] = []
  if (now !== null && hasOwnTree(work, session.agent)) {
    const gap = between(run, work, session.agent, now)
    found = gap.files
    await appendWork(session.dir, [
      ...found.map((file) => ({ t: "swept" as const, file, agent: session.agent })),
      ...gap.moved,
      treeRecord(work, { phase: "stop", agent: session.agent }, now),
    ])
  }
  const edited = new Set(work.edited)
  const all = [...new Set([...run.relevant(sweptFor(work, session.agent)), ...found])].filter(
    (file) => !edited.has(file),
  )
  return now === null ? all : all.filter((file) => !isGone(now, file))
}

/** The context budget this pipeline applies: its share, when it shares one (PipelineOptions.shareBudget). */
interface Budget {
  chars: number | null
  claim(delivers: boolean): Promise<void>
}

function budgetFor(options: PipelineOptions): Budget {
  const budget: Budget = {
    chars: options.maxContextChars,
    claim: async (delivers) => {
      if (options.shareBudget !== undefined) budget.chars = await options.shareBudget(delivers)
    },
  }
  return budget
}

async function guardEvent(
  run: Run,
  event: Extract<Event, { kind: "guard" }>,
  view: SessionView,
  context: { detection: DetectionContext; disabled: ReadonlySet<string>; resolver: ReferenceResolver; budget: Budget },
): Promise<Delivery> {
  const { session, stateDir, log } = run
  await context.budget.claim(run.relevant(event.files).length > 0)
  const sessionId = run.sessionId
  return guardWrite({
    detection: context.detection,
    config: run.config,
    event,
    rules: run.project.rules,
    disabled: context.disabled,
    mode: run.project.mode.mode,
    work: view.work,
    resolver: context.resolver,
    maxContextChars: context.budget.chars,
    log,
    ...(run.display === undefined ? {} : { display: run.display }),
    record: session ? (records) => appendWork(session.dir, records) : async () => {},
    recordContext: session ? (records) => appendContext(session.dir, session.agent, records) : async () => {},
    ...(session && sessionId !== undefined
      ? {
          recordFindings: (refusing) =>
            appendFindingsLog(
              stateDir,
              findingsRecord({
                session: sessionId,
                agent: session.agent,
                ev: "guard",
                at: new Date(),
                findings: refusing.map((finding) => ({ ...finding, outcome: "refused" as const })),
                ignored: [],
                ran: new Map(),
              }),
              log,
              { weeklySummary: run.config.stats.weeklySummary },
            ),
        }
      : {}),
  })
}

/** The baseline the session measures from, started on its first event that takes snapshots. */
async function sessionBaseline(run: Run, kind: Event["kind"]): Promise<BaselineState> {
  const { session } = run
  // A reset only delivers touch context, and a guard judges a file that does not exist yet: neither
  // takes snapshots, and neither starts the session.
  if (!session || kind === "reset" || kind === "guard") {
    return { started: false, startCommit: null, snapshots: new Map(), containers: new Map() }
  }
  const baseline = await readBaseline(session.dir)
  if (baseline.started) return baseline
  await appendBaseline(session.dir, [startRecord(await headCommit(run.root), await configHash(run.root))])
  // Re-read: with concurrent first events, the first start record wins.
  return readBaseline(session.dir)
}

/** What the delivery is decided from, besides the run and the session view. */
interface Outcome {
  event: Event
  resolver: ReferenceResolver
  budget: Budget
  touches: CompiledRule[]
  agentRead: string | null
  via: "shell" | undefined
  /** Files changed outside the agent's tool calls, verified at this stop (spec §9, Shell edits). */
  swept: string[]
  detected: Detected | null
  /** Said to the agent at this shell call, once per session (Delivery.agentNotices). */
  agentNotices: string[]
}

/** Decide what to deliver, record it in the session, write what the delivery points at, and log findings. */
async function finish(run: Run, view: SessionView, outcome: Outcome, failed: boolean): Promise<PipelineResult> {
  const { options, project, config, root, session, stateDir, warnings } = run
  const { event, detected, swept, via } = outcome
  const findings = detected?.findings ?? []
  const refused = detected?.refused ?? []
  const disabledGroups = detected?.disabledGroups ?? []
  const told = detected?.told ?? []

  const inputFor = (state: SessionView): DecideInput => ({
    agent: session?.agent ?? MAIN_AGENT,
    findings,
    touches: outcome.touches.filter((rule) => !state.context.touched.has(rule.id)),
    agentRead: outcome.agentRead,
    warnings,
    work: state.work,
    context: state.context,
    resolver: outcome.resolver,
    maxBytes: config.context.maxBytes,
    maxBlocks: maxBlocksFor(
      event,
      project.mode.mode === "unattended" ? config.unattended.maxBlocks : config.stopGate.maxBlocks,
    ),
    mode: project.mode.mode,
    maxContextChars: outcome.budget.chars,
    maxMatchesPerRule: config.maxMatchesPerRule,
    stopGate: options.stopGate === true && event.kind === "verify" && session !== null,
    ...(options.listPreexisting === true ? { listPreexisting: true } : {}),
    ...(via === undefined ? {} : { via }),
    ...(swept.length === 0 ? {} : { swept }),
    ...(refused.length === 0 ? {} : { refused }),
    ...(disabledGroups.length === 0 ? {} : { disabled: disabledGroups }),
    ...(run.display === undefined ? {} : { display: run.display }),
  })

  // A delivery the budget had to cut rules out of is written whole, and the message says where.
  // Files the agent is pointed at live inside the project, where it may read them (delivery/persist.ts).
  const home = path.dirname(path.dirname(stateDir))
  const persisted = (decision: Decision): Delivery => {
    if (decision.overflow !== null) {
      let written: string | null = null
      try {
        written = writeOverflow(path.join(agentDir(root), "deliveries"), run.sessionId ?? null, decision.overflow)
      } catch {
        written = null
      }
      decision.delivery.overflowPaths =
        written === null ? [] : [run.shown(path.relative(root, written).split(path.sep).join("/"))]
    }
    for (const reference of decision.delivery.references) {
      if (reference.location === undefined || !path.isAbsolute(reference.location)) continue
      const copied = copyIntoProject(root, home, reference.location)
      if (copied !== null) reference.location = run.shown(copied)
    }
    // After the budget: notices are for the user and never priced into agent context.
    if (told.length > 0) decision.delivery.notices = told.map((notice) => notice.text)
    if (outcome.agentNotices.length > 0) decision.delivery.agentNotices = outcome.agentNotices
    return decision.delivery
  }

  const result = (decision: Decision): PipelineResult => ({
    delivery: persisted(decision),
    failed,
    deadlineMissed: run.deadlineMissed,
    ...(detected === null
      ? { ignored: [], findings: [] }
      : { ignored: detected.ignored, findings: detected.findings, ran: detected.ran }),
  })

  // Whether decide will put anything before the agent, by its own measure (session/decide.ts).
  await outcome.budget.claim(delivers(inputFor(view)))
  if (!session) return result(await decide(inputFor(view)))

  await appendWork(session.dir, detected?.workRecords ?? [])
  let decision: Decision
  try {
    decision = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
  } catch (error) {
    // §14's "run without session state" row: a lock nobody released. A damaged line in a store is
    // skipped when it is read (core/jsonl.ts), so it no longer surfaces here.
    if (error instanceof LockTimeoutError) {
      warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    } else throw error
    decision = await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false })
  }
  await logFindings(run, outcome, session.agent, decision)
  return result(decision)
}

/**
 * The findings log (core/stats/log.ts), for an agent's own checks only: an edit, or its stop. A CLI
 * run has no session, and `run --session` replays a stop that was already logged. After the
 * decision, so a stop knows whether it blocked, and outside the session lock.
 */
async function logFindings(run: Run, outcome: Outcome, agent: string, decision: Decision): Promise<void> {
  const { event, detected, swept, via } = outcome
  const ev = event.kind === "edit" ? "edit" : event.kind === "verify" && run.options.stopGate === true ? "stop" : null
  if (ev === null || detected === null || run.sessionId === undefined) return
  // Swept files hold the user's edits: neither their findings nor their checks are the agent's.
  const theirs = new Set(swept)
  const protectedKeys = new Set(detected.refused.map(({ rule, file }) => `${rule} ${file}`))
  const outcomeOf = (finding: ClassifiedFinding): WriteOutcome => {
    // The gate's own verdict (session/decide.ts): a block or an unattended report, and only the
    // findings it rests on, so not one past the repeat limit that merely rides along.
    if (ev === "stop") return decision.blocking?.has(findingKey(finding)) === true ? "blocked" : "delivered"
    return protectedKeys.has(`${finding.rule.id} ${finding.match.file}`) ? "refused" : "delivered"
  }
  const checked = new Map<string, string[]>()
  for (const [rule, files] of detected.ran) {
    const own = files.filter((file) => !theirs.has(file))
    if (own.length > 0) checked.set(rule, own)
  }
  const mine = ({ match }: { match: { file: string } }) => !theirs.has(match.file)
  await appendFindingsLog(
    run.stateDir,
    findingsRecord({
      session: run.sessionId,
      agent,
      ev,
      ...(via === undefined ? {} : { via }),
      at: new Date(),
      findings: detected.findings
        .filter((finding) => finding.status === "new" && mine(finding))
        .map((finding) => ({ ...finding, outcome: outcomeOf(finding) })),
      ignored: detected.ignored.filter(mine),
      tried: detected.tried.filter(mine),
      ran: checked,
    }),
    run.log,
    { weeklySummary: run.config.stats.weeklySummary },
  )
}

/** Said to the user at a stop whose sweep waits for a running subagent. */
const DEFERRED_SWEEP =
  "rulecast: a subagent is still running, so files changed outside the agents' tool calls are checked at a later stop."

/**
 * Claude Code retries a refused hand-back only a few times before the subagent's report is lost
 * (four refusals in a row lost it on 2.1.325): a hand-back is blocked once, and unattended reported
 * once more, whatever the configured budget.
 */
const HANDBACK_MAX_BLOCKS = 1

function maxBlocksFor(event: Event, configured: number): number {
  return event.kind === "verify" && event.handback === true ? Math.min(configured, HANDBACK_MAX_BLOCKS) : configured
}

/** Whether only `agents` edited `file`: their work, while they still run. */
function onlyBy(work: WorkState, file: string, agents: ReadonlySet<string>): boolean {
  const editors = work.editors.get(file)
  return editors !== undefined && editors.size > 0 && [...editors].every((agent) => agents.has(agent))
}

/**
 * The project's convention docs, root-relative: the `conventions` file or folder, then each file
 * its enabled rules cite, in rule order, each once. A rule repo's docs live in the cache, not the
 * project, and are left out; so is a file that is not there.
 */
function conventionDocs(project: CompiledProject, root: string): string[] {
  const cited = project.rules
    .filter((rule) => rule.enabled)
    .flatMap((rule) => [...rule.context, ...[...rule.contextByRule.values()].flat()])
    .map((spec) => spec.path)
    .filter((file) => !path.isAbsolute(file))
  const conventions = project.config.conventions === null ? [] : [path.posix.normalize(project.config.conventions)]
  return [...new Set([...conventions, ...cited])].filter((file) => existsSync(path.join(root, file)))
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const run = startRun(options)
  const { project, root, session, warnings, log } = run
  const original = options.event
  const failedAtStart = run.errors.some(run.concernsRun)
  const nothing = (delivery = emptyDelivery()): PipelineResult => ({
    delivery,
    failed: failedAtStart,
    deadlineMissed: run.deadlineMissed,
  })
  const restoredFiles = options.restoredFiles ?? 0

  if (original.kind === "prompt") {
    if (session) await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    return nothing()
  }
  if (original.kind === "agent-start") {
    const docs = run.config.subagentDocs ? conventionDocs(project, root).map(run.shown) : []
    return nothing(docs.length === 0 ? emptyDelivery() : { ...emptyDelivery(), conventionDocs: docs })
  }
  if (original.kind === "shell-before") {
    await shellBefore(run, original)
    return nothing()
  }
  if (original.kind === "reset") {
    if (session) await appendContext(session.dir, session.agent, [{ t: "reset" }])
    // Without re-attached files there is nothing to re-deliver (§9 reset).
    if (!session || restoredFiles === 0) return nothing()
  }

  const baseline = await sessionBaseline(run, original.kind)
  const budget = budgetFor(options)
  const view: SessionView = session ? await openSession(session.dir, session.agent) : empty()
  if (session && options.recordMode === true) {
    const { mode, source, detail } = project.mode
    const recorded = view.work.mode
    if (recorded === null || recorded.mode !== mode || recorded.source !== source || recorded.detail !== detail) {
      await appendWork(session.dir, [{ t: "mode", mode, source, detail }])
    }
  }
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  // Assembled once: every detector run in this pipeline shares it (detection/context.ts).
  const detection = detectionFor(project, options.registry, run.stateDir, resolver)

  // A shell call that changed files continues as the edit event for them, exactly as an Edit
  // tool's would be.
  let shell: ShellEdit | null = null
  if (original.kind === "shell-after") {
    shell = await shellAfter(run, original, view)
    if (shell === null) return nothing()
  }
  const event: Event = shell === null ? original : { ...original, kind: "edit", files: shell.files }
  const via = shell === null ? undefined : ("shell" as const)

  if (event.kind === "guard") {
    return nothing(await guardEvent(run, event, view, { detection, disabled, resolver, budget }))
  }

  let touches: CompiledRule[] = []
  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
    if (session) {
      // Every file counts, not only files rules match: the agent's harness picks re-attached files from all of them.
      await appendWork(
        session.dir,
        event.files.map((file) => ({ t: "accessed" as const, agent: session.agent, file })),
      )
    }
  }
  if (event.kind === "reset" && session) {
    // view.context is empty: the reset record was appended above. Newest first, as the harness re-attaches them.
    const recent = (view.work.accessed.get(session.agent) ?? []).slice(-restoredFiles).reverse()
    touches = selectTouchRules(project.rules, recent, view.context.touched, disabled)
  }

  const baselineInput: BaselineInput = {
    root,
    detection,
    rules: project.rules,
    disabled,
    limits: {
      editDeadlineMs: run.config.timeouts.editDeadlineMs,
      verifyMs: run.config.timeouts.verifyMs,
      maxFileBytes: run.config.maxFileBytes,
    },
  }

  let agentRead: string | null = null
  if (event.kind === "touch") {
    if (event.completeRead) agentRead = event.files[0] ?? null
    // One append, snapshots before the container ranges taken from them (baseline/stage.ts).
    if (session) {
      const changed = new Set([...view.work.edited, ...view.work.swept])
      await appendBaseline(session.dir, await touchRecords(baselineInput, baseline, run.relevant(event.files), changed))
    }
  }

  if (event.kind === "start" && session) {
    // What was dirty before the agent did anything: a shell edit to one of these files is judged
    // against the user's content, not the commit, even when the agent only ever `cat`-ed it.
    const tree = await treeState(root)
    if (tree === null) warnings.push({ key: "tree-unavailable", text: TREE_UNAVAILABLE })
    else {
      await appendWork(session.dir, [treeRecord(view.work, { phase: "start", agent: session.agent }, tree)])
      const start = await startRecords(baselineInput, baseline, run.relevant(Object.keys(tree.entries).sort()))
      if (start.records.length > 0) await appendBaseline(session.dir, start.records)
      if (start.skipped > 0) {
        log(`session start: ${start.skipped} dirty files past the snapshot limits; their baseline is the start commit`)
      }
    }
  }

  let swept: string[] = []
  let deferredSweep = false
  let detected: Detected | null = null
  if (event.kind === "edit" || event.kind === "verify") {
    let requested = run.relevant(event.files)
    if (event.kind === "edit" && session) {
      const agent = session.agent
      await appendWork(
        session.dir,
        requested.map((file) => ({
          t: "edited" as const,
          file,
          agent,
          ...(via === undefined ? {} : { via }),
          ...(shell?.sharedCall === true ? { shared: true as const } : {}),
        })),
      )
      if (via === undefined && requested.length > 0) {
        await appendActivity(run.stateDir, { ...run.activityOf(agent), ev: "edit", f: requested })
      }
    }
    if (event.kind === "verify" && event.files.length === 0 && session) {
      // A subagent's stop verifies its own edits; the main agent's, every agent's. What any agent
      // edited is never swept: it was changed by a tool call, only not by this agent's.
      requested = run.relevant(editedBy(view.work, session.agent))
      // A subagent the agent started still runs here: its files are its own until it finishes, and
      // what it writes with its shell is not settled, so the sweep waits for a later stop. A running
      // shell job (a dev server, a watcher) never holds it: it may run all session (Event.running).
      const running = event.running?.agents ?? []
      if (running.length > 0) {
        const theirs = new Set(running)
        requested = requested.filter((file) => !onlyBy(view.work, file, theirs))
        if (options.stopGate === true && hasOwnTree(view.work, session.agent)) deferredSweep = true
      }
      if (options.stopGate === true && running.length === 0) {
        swept = await sweep(run, view, session)
        requested = [...requested, ...swept]
      }
    }
    detected = await detectStage(run, {
      event,
      view,
      baseline,
      baselineInput,
      detection,
      disabled,
      requested,
      via,
      sharedCall: shell?.sharedCall === true,
    })
  }

  const finished = await finish(
    run,
    view,
    {
      event,
      resolver,
      budget,
      touches,
      agentRead,
      via,
      swept,
      detected,
      agentNotices: shell?.agentNotices ?? [],
    },
    failedAtStart || detected?.failed === true,
  )
  if (deferredSweep) finished.delivery.notices = [...(finished.delivery.notices ?? []), DEFERRED_SWEEP]
  return finished
}
