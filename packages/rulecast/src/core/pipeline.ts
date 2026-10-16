import { createHash } from "node:crypto"
import path from "node:path"

import { isNew } from "./baseline/baseline"
import { classify } from "./baseline/classify"
import { baselineHas, type CommittedBaseline } from "./baseline/committed"
import { removedFindings } from "./baseline/removed"
import { type BaselineInput, changesFor, startRecords, touchRecords } from "./baseline/stage"
import { appendBaseline, type BaselineState, readBaseline, startRecord } from "./baseline/store"
import { type CompiledProject, type Diagnostic, diagnosticText } from "./compile/project"
import type { CompiledRule } from "./compile/rule"
import { contentReader, WORKTREE } from "./content"
import { agentDir, copyIntoProject, writeOverflow } from "./delivery/persist"
import { createReferenceResolver } from "./delivery/resolve"
import { applyFileBudget, applySizeCeiling } from "./detection/budget"
import { detectionFor } from "./detection/context"
import { runDetectionFrom } from "./detection/materialise"
import { fileBytes } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { selectDetectorRules, selectTouchRules } from "./detection/select"
import { type DisabledGroup, disabledRules } from "./disabled"
import { findingIds } from "./finding-id"
import { headCommit } from "./git"
import { guardWrite } from "./guard"
import { CorruptStoreError } from "./jsonl"
import { type ClassifiedFinding, type DecideInput, type Decision, decide, findingKey } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { configHash, type Notice, notices } from "./session/oversight"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import {
  dirtyAtStart,
  editedBy,
  emptyContext,
  emptyWork,
  hasOwnTree,
  MAIN_AGENT,
  referenceState,
  sharedShell,
  sweptFor,
  type WorkRecord,
  type WorkState,
} from "./session/state"
import { isGone, type TreeState, treeChanges, treeState } from "./session/tree"
import { appendFindingsLog, findingsRecord, type WriteOutcome } from "./stats/log"
import { type IgnoredFinding, sourceLines } from "./suppress"
import { type Delivery, type Event, emptyDelivery, type Match } from "./types"

export interface PipelineOptions {
  /** Compiled by the caller: hooks never fetch rule repos, the CLI does (spec §4). */
  project: CompiledProject
  /** The project's directory in the cache (spec §12): sessions and detector caches. */
  stateDir: string
  event: Event
  registry: DetectorRegistry
  /** From the adapter; null = unlimited. */
  maxContextChars: number | null
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
  /** Debug log sink. */
  log?: (line: string) => void
  /**
   * The hook: the session's mode is recorded, so `rulecast run --session` judges the session in the
   * mode its hooks did. The CLI's own runs never record one.
   */
  recordMode?: boolean
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

type Warning = { key: string; text: string }

/** Said once: without a working tree to compare, shell edits are seen only after the session. */
const TREE_UNAVAILABLE =
  "rulecast cannot see the working tree here; edits made with Bash are checked only by git hooks and CI"

/** Said once to an agent whose shell call ran alongside another agent's in this working tree. */
const SHARED_TREE =
  "rulecast: another agent ran a shell command in this working tree while yours ran. rulecast holds a " +
  "command to every file that changed while it ran, so findings here and at your stop may be another " +
  "agent's. Give each agent that runs in parallel its own worktree (in Claude Code, a subagent with " +
  "`isolation: worktree`)."

/**
 * Above this many warnings of one kind, they collapse into one carrying a count and an example.
 *
 * An agent mid-session cannot act on eighty individual compile errors, and the detail is in
 * `rulecast validate` and the debug log either way. Stress testing measured 80 broken rules as
 * 13,500 characters against a 9,000 character budget, with the one rule that fired dropped whole.
 */
const SUMMARY_THRESHOLD = 3

const DEFAULT_HINT = "rulecast validate"

/** The warnings for what `disabledRules` lists: compile errors and detector failures, one or summed. */
const DISABLED_WARNING = /^(diagnostics?|detector):/

/**
 * The key a summary is delivered under.
 *
 * Warnings are announced once per agent context (`decide.ts`), so a single fixed key would silence
 * a rule that breaks *later* in the session. Keying on the set of rules means a set that changes
 * re-announces and a set that does not stays quiet.
 */
function summaryKey(prefix: string, ids: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...ids].sort().join("\n"))
    .digest("hex")
    .slice(0, 16)
  return `${prefix}:${digest}`
}

/**
 * One warning per failed rule, or — above the threshold — one for all of them.
 *
 * A rule repo pinned to a rev that has moved, or a `minimum_rulecast_version` bump, invalidates
 * many rules at once, and that is exactly the moment the rules that still work matter most.
 */
function compileWarnings(errors: readonly Diagnostic[]): Warning[] {
  if (errors.length <= SUMMARY_THRESHOLD) {
    return errors.map((diagnostic) => ({
      key: `diagnostic:${diagnostic.source}:${diagnostic.rule ?? ""}:${diagnostic.message}`,
      text: `${diagnosticText(diagnostic)} (run ${diagnostic.hint ?? DEFAULT_HINT})`,
    }))
  }
  // A missing repo says "rulecast install" and a bad rule says "rulecast validate"; a mixed set has
  // no one lever, and validate is the command that lists them all.
  const hints = new Set(errors.map((diagnostic) => diagnostic.hint ?? DEFAULT_HINT))
  const hint = hints.size === 1 ? [...hints][0] : DEFAULT_HINT
  return [
    {
      key: summaryKey(
        "diagnostics",
        errors.map((diagnostic) => diagnostic.rule ?? diagnostic.source),
      ),
      text: `${errors.length} rules failed to compile and were skipped — run ${hint}.\nFirst: ${diagnosticText(errors[0]!)}`,
    },
  ]
}

/**
 * Detector errors, collapsed per kind above the threshold: one detector that fails disables every
 * rule that uses it, and a dozen copies of the same sentence tell the agent nothing the count does not.
 */
function detectorWarnings(
  errors: readonly { kind: string; rules: string[]; message: string }[],
  /** Whether a session will remember the disable. A CLI run has none, so it says what it did. */
  scope: "session" | "run",
): Warning[] {
  const outcome = scope === "session" ? "Disabled for this session." : "Skipped for this run."
  const text = (error: { kind: string; rules: string[]; message: string }) =>
    `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. ${outcome}`
  const byKind = new Map<string, { kind: string; rules: string[]; message: string }[]>()
  for (const error of errors) {
    const group = byKind.get(error.kind)
    if (group === undefined) byKind.set(error.kind, [error])
    else group.push(error)
  }
  const summarised: Warning[] = []
  for (const [kind, group] of byKind) {
    if (group.length <= SUMMARY_THRESHOLD) {
      summarised.push(
        ...group.map((error) => ({
          key: `detector:${kind}:${error.rules.join(",")}:${error.message}`,
          text: text(error),
        })),
      )
      continue
    }
    const ids = group.flatMap((error) => error.rules)
    summarised.push({
      key: summaryKey(`detector:${kind}`, ids),
      text: `${ids.length} ${kind} rules ${scope === "session" ? "were disabled this session" : "were skipped in this run"} — see debug.log.\nFirst: ${text(group[0]!)}`,
    })
  }
  return summarised
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { project, stateDir, registry } = options
  // Reassigned once: a shell call that changed files continues as the edit event for them.
  let event = options.event
  const { root, config } = project
  const log = options.log ?? (() => {})
  // Warnings (a branch-like rev) are for rulecast validate; only errors disable rules.
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const warnings: Warning[] = compileWarnings(errors)
  // `rulecast run RULE_ID` is incomplete only over what could have changed that rule's result: its
  // own diagnostics, a failed repos entry that configures it, a config that did not load, or a
  // diagnostic that names no rule and no entry.
  const only = options.onlyRules
  const concernsRun = (diagnostic: Diagnostic) =>
    only === undefined ||
    diagnostic.fatal === true ||
    (diagnostic.rule !== null ? only.has(diagnostic.rule) : (diagnostic.rules?.some((id) => only.has(id)) ?? true))
  let failed = errors.some(concernsRun)
  const deadlineMissed: string[] = []
  let session = event.session
    ? { dir: sessionDir(stateDir, event.session.id), agent: event.session.agentId ?? MAIN_AGENT }
    : null

  /**
   * Spec §14: a store that cannot be read runs this invocation without session state and warns —
   * the same row as a lock that could not be taken, and for the same reason. A half-written record
   * anywhere but the last line is a `CorruptStoreError`, and it used to be thrown straight out of
   * the hook. Dropping the session also stops anything more being appended to a store whose shape
   * is no longer understood.
   */
  const STORE_UNREADABLE = "session state could not be read; delivered without session memory"

  async function readingStore<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read()
    } catch (error) {
      if (!(error instanceof CorruptStoreError)) throw error
      log(`session store unreadable: ${error.message}`)
      session = null
      warnings.push({ key: "store", text: STORE_UNREADABLE })
      return fallback
    }
  }

  const restoredFiles = options.restoredFiles ?? 0
  if (event.kind === "prompt") {
    if (session) await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    return { delivery: emptyDelivery(), failed, deadlineMissed }
  }
  const empty = (): SessionView => ({ work: emptyWork(), context: emptyContext() })
  const relevant = (files: readonly string[]) =>
    files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  /**
   * What changed since the agent's latest recorded state that no tool call explains: not a file any
   * agent edited. A subagent with no state of its own sweeps nothing — the session's latest may be a
   * sibling's, taken before that sibling's command wrote — and leaves it to the main agent's stop.
   */
  function between(work: WorkState, agent: string, now: TreeState): string[] {
    if (!hasOwnTree(work, agent)) return []
    const reference = referenceState(work, agent)
    const gap = reference === null ? null : treeChanges(reference, now)
    if (gap === null || gap.gitOperation) return []
    const edited = new Set(work.edited)
    return relevant(gap.files.filter((file) => !edited.has(file)))
  }

  if (event.kind === "shell-before") {
    // Spec §9, Shell edits: the state this call's changes are measured from. What changed since the
    // agent's last recorded state happened between its calls — the user's editor, a formatter, a
    // job it left running — and is swept, so it is never folded into this call. No output: swept
    // findings are reported at Stop, and this hook runs before every shell command.
    const open = session
    const now = open ? await treeState(root) : null
    if (open && now !== null) {
      const { work } = await readingStore(() => openSession(open.dir, open.agent), empty())
      const swept = between(work, open.agent, now).filter((file) => !isGone(now, file))
      const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
      if (session !== null) {
        await appendWork(open.dir, [
          ...swept.map((file) => ({ t: "swept" as const, file, agent: open.agent })),
          { t: "tree", phase: "before", agent: open.agent, ...id, state: now },
        ])
      }
    }
    return { delivery: emptyDelivery(), failed, deadlineMissed }
  }
  if (event.kind === "reset") {
    if (session) await appendContext(session.dir, session.agent, [{ t: "reset" }])
    // Without re-attached files there is nothing to re-deliver (§9 reset).
    if (!session || restoredFiles === 0) return { delivery: emptyDelivery(), failed, deadlineMissed }
  }

  let baseline: BaselineState = {
    started: false,
    startCommit: null,
    snapshots: new Map(),
    containers: new Map(),
  }
  // A reset only delivers touch context, and a guard judges a file that does not exist yet: neither
  // takes snapshots, and neither starts the session.
  if (session && event.kind !== "reset" && event.kind !== "guard") {
    const dir = session.dir
    baseline = await readingStore(() => readBaseline(dir), baseline)
    if (session && !baseline.started) {
      await appendBaseline(dir, [startRecord(await headCommit(root), await configHash(root))])
      // Re-read: with concurrent first events, the first start record wins.
      baseline = await readingStore(() => readBaseline(dir), baseline)
    }
  }

  const view: SessionView = session
    ? await readingStore(() => openSession(session!.dir, session!.agent), empty())
    : empty()
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
  const detection = detectionFor(project, registry, stateDir, resolver)
  const workRecords: WorkRecord[] = []
  let via: "shell" | undefined
  /** Files changed outside the agent's tool calls, verified at this stop (spec §9, Shell edits). */
  let swept: string[] = []
  const refused: NonNullable<Delivery["refused"]> = []
  /** Said to the agent at this shell call, once per session (Delivery.agentNotices). */
  const agentNotices: string[] = []
  const withAgentNotices = (): Pick<Delivery, "agentNotices"> => (agentNotices.length === 0 ? {} : { agentNotices })

  if (event.kind === "shell-after") {
    // What changed during the call, against the state recorded before it. A moved HEAD is git's
    // doing, not an edit; no reference at all is a session that began before these hooks existed.
    // Either way the new state is recorded, so the next call has something to compare with.
    const open = session
    const now = open ? await treeState(root) : null
    if (!open || now === null) return { delivery: emptyDelivery(), failed, deadlineMissed }
    const reference = referenceState(view.work, open.agent, event.toolUseId)
    const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
    const call = reference === null ? null : treeChanges(reference, now)
    const files = call === null || call.gitOperation ? [] : relevant(call.files.filter((file) => !isGone(now, file)))
    // Another agent's shell call ran during this one, and this one is held to files: those may be the
    // other's writes (README, Agents). Hooks key on the session's directory, so an overlap alone may be
    // a command that ran elsewhere; with no files there is nothing to misattribute. Told once per agent.
    const sharedKey = `shared-tree:${open.agent}`
    const shared =
      files.length > 0 && sharedShell(view.work, open.agent, event.toolUseId) && !view.work.noticed.has(sharedKey)
    if (shared) agentNotices.push(SHARED_TREE)
    await appendWork(open.dir, [
      { t: "tree", phase: "after", agent: open.agent, ...id, state: now },
      ...(shared ? [{ t: "noticed" as const, key: sharedKey }] : []),
    ])
    if (files.length === 0) return { delivery: emptyDelivery(), failed, deadlineMissed }
    // From here it is the edit event for those files, exactly as an Edit tool's would be.
    via = "shell"
    event = { ...event, kind: "edit", files }
  }

  if (event.kind === "guard") {
    // Bound to a const: `session` is cleared when a store turns out to be unreadable, so a closure
    // that reads it later would not have the value this branch checked.
    const open = session
    const delivery = await guardWrite({
      detection,
      config,
      event,
      rules: project.rules,
      disabled,
      mode: project.mode.mode,
      work: view.work,
      resolver,
      maxContextChars: options.maxContextChars,
      log,
      record: open ? (records) => appendWork(open.dir, records) : async () => {},
      recordContext: open ? (records) => appendContext(open.dir, open.agent, records) : async () => {},
      ...(open && event.session
        ? {
            recordFindings: (refusing) =>
              appendFindingsLog(
                stateDir,
                findingsRecord({
                  session: event.session!.id,
                  agent: open.agent,
                  ev: "guard",
                  at: new Date(),
                  findings: refusing.map((finding) => ({ ...finding, outcome: "refused" as const })),
                  ignored: [],
                  ran: new Map(),
                }),
                log,
              ),
          }
        : {}),
    })
    return { delivery, failed, deadlineMissed }
  }

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let ignored: IgnoredFinding[] = []
  /**
   * Unattended: ignores the agent added or changed, on findings they did not silence (D49). The
   * findings log keeps them as the agent's attempts; an unchanged comment over changed code is none.
   */
  let tried: IgnoredFinding[] = []
  let ran: Map<string, string[]> | undefined
  let told: Notice[] = []
  let agentRead: string | null = null
  let disabledGroups: DisabledGroup[] = []

  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
    const open = session
    if (open) {
      // Every file counts, not only files rules match: the agent's harness picks re-attached files from all of them.
      await appendWork(
        open.dir,
        event.files.map((file) => ({ t: "accessed" as const, agent: open.agent, file })),
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
      editDeadlineMs: config.timeouts.editDeadlineMs,
      verifyMs: config.timeouts.verifyMs,
      maxFileBytes: config.maxFileBytes,
    },
  }

  if (event.kind === "touch") {
    if (event.completeRead) agentRead = event.files[0] ?? null
    // One append, snapshots before the container ranges taken from them (baseline/stage.ts).
    if (session) {
      const changed = new Set([...view.work.edited, ...view.work.swept])
      await appendBaseline(session.dir, await touchRecords(baselineInput, baseline, relevant(event.files), changed))
    }
  }

  if (event.kind === "start" && session) {
    // What was dirty before the agent did anything: a shell edit to one of these files is judged
    // against the user's content, not the commit, even when the agent only ever `cat`-ed it.
    const tree = await treeState(root)
    if (tree === null) warnings.push({ key: "tree-unavailable", text: TREE_UNAVAILABLE })
    else {
      await appendWork(session.dir, [{ t: "tree", phase: "start", agent: session.agent, state: tree }])
      const start = await startRecords(baselineInput, baseline, relevant(Object.keys(tree.entries).sort()))
      if (start.records.length > 0) await appendBaseline(session.dir, start.records)
      if (start.skipped > 0) {
        log(`session start: ${start.skipped} dirty files past the snapshot limits; their baseline is the start commit`)
      }
    }
  }

  if (event.kind === "edit" || event.kind === "verify") {
    let requested = relevant(event.files)
    if (event.kind === "edit" && session) {
      const agent = session.agent
      await appendWork(
        session.dir,
        requested.map((file) => ({ t: "edited" as const, file, agent, ...(via === undefined ? {} : { via }) })),
      )
    }
    if (event.kind === "verify" && event.files.length === 0 && session) {
      // A subagent's stop verifies its own edits; the main agent's, every agent's. What any agent
      // edited is never swept: it was changed by a tool call, only not by this agent's.
      requested = relevant(editedBy(view.work, session.agent))
      if (options.stopGate === true) {
        swept = await sweep(session)
        requested = [...requested, ...swept]
      }
    }

    // One reader for the baseline diff and the detectors, so they agree on what "the file" is.
    const read = contentReader(root, event.kind === "verify" ? (event.content ?? WORKTREE) : WORKTREE)
    const stage = await changesFor(
      baselineInput,
      { kind: event.kind, baseCommit: event.baseCommit },
      session ? baseline : null,
      requested,
      read,
    )
    const { files, changes: baselineChanges, containers } = stage
    const changes = baselineChanges.sets
    // Persisted so the next event in the session reuses them rather than measuring again.
    if (session && stage.records.length > 0) await appendBaseline(session.dir, stage.records)

    const skip = options.skipDetectorKinds ?? new Set<string>()
    // A `scope: removed` rule is judged only at a verify: an edit may be the first half of a move,
    // the assertion cut here and pasted by the next edit. Its baseline count is still taken at touch.
    const wanted = (rule: { id: string; scope: string; detector: { kind: string } }) =>
      !skip.has(rule.detector.kind) &&
      (options.onlyRules?.has(rule.id) ?? true) &&
      (event.kind === "verify" || rule.scope !== "removed")
    let selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(({ rule }) => wanted(rule))
    // `rulecast run --session`: a rule the session disabled that would have run here did not, which
    // makes the run incomplete. It is named under `disabled` below, once; one that would not have
    // run here changes nothing about this run, and is not named.
    const skippedHere = new Set(
      options.reportDisabled === true && disabled.size > 0
        ? selectDetectorRules(project.rules, event.kind, files, new Set())
            .map(({ rule }) => rule)
            .filter((rule) => disabled.has(rule.id) && wanted(rule))
            .map((rule) => rule.id)
        : [],
    )
    if (skippedHere.size > 0) failed = true
    // Spec §6: a detector that declares a file budget is given at most that many files per verify,
    // most recently edited first. work.edited is least recently edited first, so it is reversed.
    const overBudget: { kind: string; max: number; setting: string; skipped: string[] }[] = []
    if (event.kind === "verify" && options.ignoreFileBudgets !== true) {
      const recent = [...editedBy(view.work, session?.agent ?? MAIN_AGENT)].reverse()
      for (const kind of new Set(selections.map((selection) => selection.rule.detector.kind))) {
        const budget = registry.get(kind)?.fileBudget?.(detection.settings)
        if (budget === undefined) continue
        const budgeted = applyFileBudget(kind, selections, budget.max, recent)
        selections = budgeted.selections
        if (budgeted.skipped.length > 0) overBudget.push({ kind, ...budget, skipped: budgeted.skipped })
      }
    }
    // Spec §13: an edit has 350 ms and an agent waiting on it, so a file too large for an
    // in-process detector to finish inside that is not given to one. A verify has seconds.
    if (event.kind === "edit") {
      const ceiling = await applySizeCeiling(
        selections,
        config.maxFileBytes,
        (kind) => registry.get(kind)?.guards === true,
        (file) => fileBytes(root, file),
      )
      selections = ceiling.selections
      // Logged, not warned about: staying inside a ceiling the project set is normal operation,
      // like a missed edit deadline, and must not change the exit code.
      if (ceiling.skipped.length > 0) {
        log(`over max_file_bytes (${config.maxFileBytes}), not checked on this edit: ${ceiling.skipped.join(", ")}`)
      }
    }
    const lines = sourceLines(read)
    const detected = await runDetectionFrom(
      {
        detection,
        event: event.kind,
        selections,
        changes,
        read,
        lines,
        timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : config.timeouts.verifyMs,
      },
      event.kind === "verify" ? (event.content ?? WORKTREE) : WORKTREE,
    )

    // A `scope: removed` rule's matches are what it keeps: they become a count, not findings.
    const removed = await removedFindings(selections, detected, baselineChanges, containers, read)
    const output = removed.output
    // Over ignored matches too, so an ignore on one of two duplicates does not renumber the other.
    // From the lines suppression read through `read`, the content detection judged: staged in a
    // staged run, not the working tree. No file is read again.
    const ids = await findingIds(
      [...output.findings, ...output.ignored, ...removed.findings],
      (kind) => registry.get(kind),
      lines,
    )
    // Only fills in: without a session or a base commit `classify` has nothing to compare and says new.
    const committed =
      event.kind === "verify" && event.session === undefined && event.baseCommit === undefined
        ? options.committedBaseline
        : undefined
    const statusOf = (rule: CompiledRule, match: Match, id: string): ClassifiedFinding["status"] =>
      committed === undefined
        ? classify(match, rule.scope, rule.id, baselineChanges, containers)
        : baselineHas(committed, rule.id, match.file, id)
          ? "preexisting"
          : "new"
    const removedFrom = output.findings.length + output.ignored.length
    findings = [
      ...output.findings.map(({ rule, match }, index) => {
        const id = ids[index]!
        return { id, rule, match, status: statusOf(rule, match, id) }
      }),
      // The drop is the change's by construction: always new.
      ...removed.findings.map(({ rule, match }, index) => ({
        id: ids[removedFrom + index]!,
        rule,
        match,
        status: "new" as const,
      })),
    ]
    const classifiedIgnores = output.ignored.map((item, index) => {
      const id = ids[output.findings.length + index]!
      return { ...item, id, status: statusOf(item.rule, item.match, id) }
    })
    // Unattended, an ignore does not silence a finding on a line changed this session, whoever wrote
    // the comment: nobody is there to agree to it, so the finding takes the unattended path and is
    // reported if it keeps blocking. Ignores on code the run did not touch keep working.
    const unsilenced =
      project.mode.mode === "unattended" ? classifiedIgnores.filter(({ status }) => status === "new") : []
    for (const { id, rule, match, status } of unsilenced) findings.push({ id, rule, match, status })
    for (const error of output.errors) {
      failed = true
      log(`${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}`)
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
    }
    // Every one of them is in the debug log above, which is where the summary points.
    warnings.push(...detectorWarnings(output.errors, session === null ? "run" : "session"))
    const kept = new Set(unsilenced.map(({ match }) => match))
    // An attempt only when the comment's own line changed this session: the agent wrote or edited
    // the ignore. Over code the agent changed under a comment it left alone, the finding is not
    // silenced, but no ignore was tried.
    const commentChanged = ({ match, ignoreLine }: IgnoredFinding) =>
      isNew({ ...match, line: ignoreLine, endLine: ignoreLine }, changes)
    tried = unsilenced.filter(commentChanged).map(({ status: _, ...item }) => item)
    ignored = classifiedIgnores.filter(({ match }) => !kept.has(match)).map(({ status: _, ...item }) => item)
    const incomplete = new Set([
      ...output.errors.flatMap((error) => error.rules),
      ...output.timedOut.flatMap((timeout) => timeout.rules),
      ...output.skipped,
    ])
    ran = new Map(
      selections
        .filter((selection) => !incomplete.has(selection.rule.id))
        .map((selection) => [selection.rule.id, selection.files]),
    )
    // A refuse_write rule's new finding in a file the agent changed with its shell: told now, with
    // what to undo, because nothing could refuse the write before it happened.
    const shellEdited = (file: string) =>
      via === "shell" ? requested.includes(file) : view.work.editedVia.get(file) === "shell"
    const seen = new Set<string>()
    for (const { rule, match, status } of findings) {
      if (status !== "new" || !rule.refuseWrite || !shellEdited(match.file)) continue
      if (seen.has(`${rule.id} ${match.file}`)) continue
      seen.add(`${rule.id} ${match.file}`)
      refused.push({ file: match.file, rule: rule.id, dirtyAtStart: dirtyAtStart(view.work, match.file) })
    }
    const atStop = options.stopGate === true && event.kind === "verify" && session !== null
    if (session !== null && (atStop || refused.length > 0)) {
      told = notices({
        startConfigHash: atStop ? (baseline.startConfigHash ?? null) : null,
        currentConfigHash: atStop ? await configHash(root) : null,
        ignored: atStop
          ? classifiedIgnores.map(({ rule, match, reason, status }) => ({ rule: rule.id, match, reason, status }))
          : [],
        told: view.work.noticed,
        refused,
      })
      // Recorded now: a notice is for the user, and the user sees it whatever the gate decides.
      for (const notice of told) for (const key of notice.key.split("\n")) workRecords.push({ t: "noticed", key })
    }
    // Every time, not once per context: a loop nobody watches must not read "no findings" as
    // "checked". The session's earlier disables are named too, since they are skipped above unsaid.
    if (
      event.kind === "verify" &&
      (options.reportDisabled === true || (atStop && project.mode.mode === "unattended"))
    ) {
      const kinds = new Map(project.rules.map((rule) => [rule.id, rule.detector?.kind ?? "detector"]))
      // `rulecast run` names what kept this run from being complete, and so nothing it did not
      // count: not another rule's compile error under RULE_ID, nor a disable that would not have run.
      const scoped = options.reportDisabled === true
      const earlier = [...view.work.disabled]
        .filter(([rule]) => !scoped || skippedHere.has(rule))
        .map(([rule, message]) => ({ kind: kinds.get(rule) ?? "detector", rules: [rule], message }))
      disabledGroups = disabledRules({
        diagnostics: scoped ? errors.filter(concernsRun) : errors,
        detectorErrors: [...output.errors, ...earlier],
      })
      // `disabled` and `complete` agree: a run that lists a rule that did not run is incomplete.
      if (scoped && disabledGroups.length > 0) failed = true
      // `rulecast run` lists them under "did not run"; its problems are the rest. A hook keeps them:
      // there the warning is the once-per-context word to the user, the list the agent's every stop.
      if (options.reportDisabled === true) {
        const kept = warnings.filter((warning) => !DISABLED_WARNING.test(warning.key))
        warnings.splice(0, warnings.length, ...kept)
      }
    }
    // An ignore without a reason is the author's mistake, said once per site; a whole-project rule
    // skipped in a staged run says which files kept it from running (detection/materialise.ts).
    for (const text of output.warnings) warnings.push({ key: `detection:${text}`, text })
    // Not `failed`: staying inside a budget the project set is normal operation, not a rulecast
    // failure, so it must not change the exit code.
    for (const { kind, max, setting, skipped } of overBudget) {
      warnings.push({
        key: `${kind}-budget:${skipped.join(",")}`,
        text: `${kind} rules checked ${max} files; ${skipped.length} were not checked: ${skipped.join(", ")}. Raise ${setting}, or run rulecast run --files on them.`,
      })
    }
    const hintFor = (kind: string) => {
      const hint = registry.get(kind)?.timeoutHint
      return hint === undefined ? "" : ` (${hint})`
    }
    for (const timeout of output.timedOut) {
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
        deadlineMissed.push(timeout.kind)
      } else {
        failed = true
        warnings.push({
          key: `timeout:${timeout.kind}:${timeout.rules.join(",")}`,
          // Naming the lever matters: a field trial measured a single haiku call on a 135-line file
          // at 89 s against a 60 s default, and "timed out" alone leaves nobody knowing what to do.
          text:
            `${timeout.kind} detector timed out after ${config.timeouts.verifyMs} ms for ${timeout.rules.join(", ")}. ` +
            `Raise timeouts.verify_ms${hintFor(timeout.kind)}.`,
        })
      }
    }
  }

  /**
   * At a stop: what changed since the agent's latest recorded state that no call of its explains —
   * a job it left running, a formatter, the user's own edits — joined with what earlier comparisons
   * of this agent's swept (every agent's, at the main agent's stop). A git operation in between
   * sweeps nothing.
   */
  async function sweep(open: { dir: string; agent: string }): Promise<string[]> {
    const now = await treeState(root)
    const work = view.work
    let found: string[] = []
    if (now !== null && hasOwnTree(work, open.agent)) {
      found = between(work, open.agent, now)
      await appendWork(open.dir, [
        ...found.map((file) => ({ t: "swept" as const, file, agent: open.agent })),
        { t: "tree", phase: "stop", agent: open.agent, state: now },
      ])
    }
    const edited = new Set(work.edited)
    const all = [...new Set([...relevant(sweptFor(work, open.agent)), ...found])].filter((file) => !edited.has(file))
    return now === null ? all : all.filter((file) => !isGone(now, file))
  }

  const inputFor = (state: SessionView): DecideInput => ({
    agent: session?.agent ?? MAIN_AGENT,
    findings,
    touches: touches.filter((rule) => !state.context.touched.has(rule.id)),
    agentRead,
    warnings,
    work: state.work,
    context: state.context,
    resolver,
    maxBytes: config.context.maxBytes,
    maxBlocks: project.mode.mode === "unattended" ? config.unattended.maxBlocks : config.stopGate.maxBlocks,
    mode: project.mode.mode,
    maxContextChars: options.maxContextChars,
    maxMatchesPerRule: config.maxMatchesPerRule,
    stopGate: options.stopGate === true && event.kind === "verify" && session !== null,
    ...(options.listPreexisting === true ? { listPreexisting: true } : {}),
    ...(via === undefined ? {} : { via }),
    ...(swept.length === 0 ? {} : { swept }),
    ...(refused.length === 0 ? {} : { refused }),
    ...(disabledGroups.length === 0 ? {} : { disabled: disabledGroups }),
  })

  // A delivery the budget had to cut rules out of is written whole, and the message says where.
  // Files the agent is pointed at live inside the project, where it may read them (delivery/persist.ts).
  const home = path.dirname(path.dirname(stateDir))
  const persisted = (decision: Decision): Delivery => {
    if (decision.overflow !== null) {
      let written: string | null = null
      try {
        written = writeOverflow(path.join(agentDir(root), "deliveries"), event.session?.id ?? null, decision.overflow)
      } catch {
        written = null
      }
      decision.delivery.overflowPath = written === null ? null : path.relative(root, written).split(path.sep).join("/")
    }
    for (const reference of decision.delivery.references) {
      if (reference.location === undefined || !path.isAbsolute(reference.location)) continue
      const copied = copyIntoProject(root, home, reference.location)
      if (copied !== null) reference.location = copied
    }
    // After the budget: notices are for the user and never priced into agent context.
    if (told.length > 0) decision.delivery.notices = told.map((notice) => notice.text)
    Object.assign(decision.delivery, withAgentNotices())
    return decision.delivery
  }

  /**
   * The findings log (core/stats/log.ts), for an agent's own checks only: an edit, or its stop. A
   * CLI run has no session, and `run --session` replays a stop that was already logged. After the
   * decision, so a stop knows whether it blocked, and outside the session lock.
   */
  async function logFindings(agent: string, decision: Decision): Promise<void> {
    const ev = event.kind === "edit" ? "edit" : event.kind === "verify" && options.stopGate === true ? "stop" : null
    if (ev === null || ran === undefined || event.session === undefined) return
    // Swept files hold the user's edits: neither their findings nor their checks are the agent's.
    const theirs = new Set(swept)
    const protectedKeys = new Set(refused.map(({ rule, file }) => `${rule} ${file}`))
    const outcome = (finding: ClassifiedFinding): WriteOutcome => {
      // The gate's own verdict (session/decide.ts): a block or an unattended report, and only the
      // findings it rests on, so not one past the repeat limit that merely rides along.
      if (ev === "stop") return decision.blocking?.has(findingKey(finding)) === true ? "blocked" : "delivered"
      return protectedKeys.has(`${finding.rule.id} ${finding.match.file}`) ? "refused" : "delivered"
    }
    const checked = new Map<string, string[]>()
    for (const [rule, files] of ran) {
      const own = files.filter((file) => !theirs.has(file))
      if (own.length > 0) checked.set(rule, own)
    }
    await appendFindingsLog(
      stateDir,
      findingsRecord({
        session: event.session.id,
        agent,
        ev,
        ...(via === undefined ? {} : { via }),
        at: new Date(),
        findings: findings
          .filter(({ status, match }) => status === "new" && !theirs.has(match.file))
          .map((finding) => ({ ...finding, outcome: outcome(finding) })),
        ignored: ignored.filter(({ match }) => !theirs.has(match.file)),
        tried: tried.filter(({ match }) => !theirs.has(match.file)),
        ran: checked,
      }),
      log,
    )
  }

  const detected = { ignored, findings, ...(ran === undefined ? {} : { ran }) }
  if (!session) return { delivery: persisted(await decide(inputFor(view))), failed, deadlineMissed, ...detected }

  await appendWork(session.dir, workRecords)
  let decision: Decision
  try {
    decision = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
  } catch (error) {
    // §14's two "run without session state" rows: a lock nobody released, and a store nobody can
    // read. The commit reads the stores inside the lock, so both surface here as well.
    if (error instanceof CorruptStoreError) {
      log(`session store unreadable: ${error.message}`)
      warnings.push({ key: "store", text: STORE_UNREADABLE })
    } else if (error instanceof LockTimeoutError) {
      warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    } else throw error
    decision = await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false })
  }
  await logFindings(session.agent, decision)
  return { delivery: persisted(decision), failed, deadlineMissed, ...detected }
}
