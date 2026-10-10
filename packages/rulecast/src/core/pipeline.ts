import { createHash } from "node:crypto"
import path from "node:path"

import { classify } from "./baseline/fingerprint"
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
import { headCommit } from "./git"
import { guardWrite } from "./guard"
import { CorruptStoreError } from "./jsonl"
import { type ClassifiedFinding, type DecideInput, type Decision, decide } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { configHash, type Notice, notices } from "./session/oversight"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import { dirtyAtStart, emptyContext, emptyWork, referenceState, type WorkRecord } from "./session/state"
import { isGone, treeChanges, treeState } from "./session/tree"
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
  /** Recently accessed files the agent re-attaches after compaction (adapter.restoredFiles); reset re-delivers their touch context. */
  restoredFiles?: number
  /** Detector kinds to skip entirely: the metered ones, for a staged run or --no-llm (commands/run.ts). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Run only these rules (rulecast run RULE_ID); touch rules are unaffected. */
  onlyRules?: ReadonlySet<string>
  /** verify from an agent's stop: decide block / allow / capReached. Needs a session. */
  stopGate?: boolean
  /** Debug log sink. */
  log?: (line: string) => void
}

export interface PipelineResult {
  delivery: Delivery
  /** rulecast itself failed: compile diagnostics, detector errors or verify timeouts. */
  failed: boolean
  /** Detector kinds whose results were dropped at the edit deadline (§13). */
  deadlineMissed: string[]
  /** Findings a `rulecast-ignore` comment dropped (core/suppress.ts); absent when nothing was detected. */
  ignored?: IgnoredFinding[]
}

type Warning = { key: string; text: string }

/** Said once: without a working tree to compare, shell edits are seen only after the session. */
const TREE_UNAVAILABLE =
  "rulecast cannot see the working tree here; edits made with Bash are checked only by git hooks and CI"

/**
 * Above this many warnings of one kind, they collapse into one carrying a count and an example.
 *
 * An agent mid-session cannot act on eighty individual compile errors, and the detail is in
 * `rulecast validate` and the debug log either way. Stress testing measured 80 broken rules as
 * 13,500 characters against a 9,000 character budget, with the one rule that fired dropped whole.
 */
const SUMMARY_THRESHOLD = 3

const DEFAULT_HINT = "rulecast validate"

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
  let failed = errors.length > 0
  const deadlineMissed: string[] = []
  let session = event.session
    ? { dir: sessionDir(stateDir, event.session.id), agent: event.session.agentId ?? "main" }
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

  if (event.kind === "shell-before") {
    // Spec §9, Shell edits: the state this call's changes are measured from. What changed since the
    // agent's last recorded state happened between its calls — the user's editor, a formatter, a
    // job it left running — and is swept, so it is never folded into this call. No output: swept
    // findings are reported at Stop, and this hook runs before every shell command.
    const open = session
    const now = open ? await treeState(root) : null
    if (open && now !== null) {
      const { work } = await readingStore(() => openSession(open.dir, open.agent), empty())
      const reference = referenceState(work, open.agent)
      const gap = reference === null ? null : treeChanges(reference, now)
      const edited = new Set(work.edited)
      const swept =
        gap === null || gap.gitOperation
          ? []
          : relevant(gap.files.filter((file) => !isGone(now, file) && !edited.has(file)))
      const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
      if (session !== null) {
        await appendWork(open.dir, [
          ...swept.map((file) => ({ t: "swept" as const, file })),
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
    fingerprints: new Map(),
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
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  // Assembled once: every detector run in this pipeline shares it (detection/context.ts).
  const detection = detectionFor(project, registry, stateDir, resolver)
  const workRecords: WorkRecord[] = []
  let via: "shell" | undefined
  /** Files changed outside the agent's tool calls, verified at this stop (spec §9, Shell edits). */
  let swept: string[] = []
  const refused: NonNullable<Delivery["refused"]> = []

  if (event.kind === "shell-after") {
    // What changed during the call, against the state recorded before it. A moved HEAD is git's
    // doing, not an edit; no reference at all is a session that began before these hooks existed.
    // Either way the new state is recorded, so the next call has something to compare with.
    const open = session
    const now = open ? await treeState(root) : null
    if (!open || now === null) return { delivery: emptyDelivery(), failed, deadlineMissed }
    const reference = referenceState(view.work, open.agent, event.toolUseId)
    const id = event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }
    await appendWork(open.dir, [{ t: "tree", phase: "after", agent: open.agent, ...id, state: now }])
    const call = reference === null ? null : treeChanges(reference, now)
    const files = call === null || call.gitOperation ? [] : relevant(call.files.filter((file) => !isGone(now, file)))
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
      work: view.work,
      resolver,
      maxContextChars: options.maxContextChars,
      log,
      record: open ? (records) => appendWork(open.dir, records) : async () => {},
      recordContext: open ? (records) => appendContext(open.dir, open.agent, records) : async () => {},
    })
    return { delivery, failed, deadlineMissed }
  }

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let ignored: IgnoredFinding[] = []
  let told: Notice[] = []
  let agentRead: string | null = null

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
    // One append, snapshots before the fingerprints taken from them (baseline/stage.ts).
    if (session) await appendBaseline(session.dir, await touchRecords(baselineInput, baseline, relevant(event.files)))
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
      await appendWork(
        session.dir,
        requested.map((file) => ({ t: "edited" as const, file, ...(via === undefined ? {} : { via }) })),
      )
    }
    if (event.kind === "verify" && event.files.length === 0 && session) {
      requested = relevant(view.work.edited)
      if (options.stopGate === true) {
        swept = await sweep(session, new Set(requested))
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
    const { files, changes: baselineChanges, fingerprints } = stage
    const changes = baselineChanges.sets
    // Persisted so the next event in the session reuses them rather than measuring again.
    if (session && stage.records.length > 0) await appendBaseline(session.dir, stage.records)

    const skip = options.skipDetectorKinds ?? new Set<string>()
    let selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector.kind) && (options.onlyRules?.has(selection.rule.id) ?? true),
    )
    // Spec §6: a detector that declares a file budget is given at most that many files per verify,
    // most recently edited first. work.edited is least recently edited first, so it is reversed.
    const overBudget: { kind: string; max: number; setting: string; skipped: string[] }[] = []
    if (event.kind === "verify") {
      const recent = [...view.work.edited].reverse()
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
    const output = await runDetectionFrom(
      {
        detection,
        event: event.kind,
        selections,
        changes,
        read,
        timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : config.timeouts.verifyMs,
      },
      event.kind === "verify" ? (event.content ?? WORKTREE) : WORKTREE,
    )

    findings = output.findings.map(({ rule, match }) => ({
      rule,
      match,
      status: classify(match, rule.scope, rule.id, baselineChanges, fingerprints),
    }))
    for (const error of output.errors) {
      failed = true
      log(`${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}`)
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
    }
    // Every one of them is in the debug log above, which is where the summary points.
    warnings.push(...detectorWarnings(output.errors, session === null ? "run" : "session"))
    ignored = output.ignored
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
          ? ignored.map(({ rule, match, reason }) => ({
              rule: rule.id,
              match,
              reason,
              status: classify(match, rule.scope, rule.id, baselineChanges, fingerprints),
            }))
          : [],
        told: view.work.noticed,
        refused,
      })
      // Recorded now: a notice is for the user, and the user sees it whatever the gate decides.
      for (const notice of told) for (const key of notice.key.split("\n")) workRecords.push({ t: "noticed", key })
    }
    // An ignore without a reason is the author's mistake, said once per site.
    for (const text of output.warnings) warnings.push({ key: `ignore:${text}`, text })
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
   * a job it left running, a formatter, the user's own edits — joined with what earlier calls'
   * before hooks already swept. A git operation in between sweeps nothing. Never the agent's own
   * edited files, which stay its own.
   */
  async function sweep(open: { dir: string; agent: string }, edited: ReadonlySet<string>): Promise<string[]> {
    const now = await treeState(root)
    let found: string[] = []
    if (now !== null) {
      const reference = referenceState(view.work, open.agent)
      const gap = reference === null ? null : treeChanges(reference, now)
      if (gap !== null && !gap.gitOperation) found = relevant(gap.files.filter((file) => !edited.has(file)))
      await appendWork(open.dir, [
        ...found.map((file) => ({ t: "swept" as const, file })),
        { t: "tree", phase: "stop", agent: open.agent, state: now },
      ])
    }
    const all = [...new Set([...relevant(view.work.swept), ...found])].filter((file) => !edited.has(file))
    return now === null ? all : all.filter((file) => !isGone(now, file))
  }

  const inputFor = (state: SessionView): DecideInput => ({
    agent: session?.agent ?? "main",
    findings,
    touches: touches.filter((rule) => !state.context.touched.has(rule.id)),
    agentRead,
    warnings,
    work: state.work,
    context: state.context,
    resolver,
    maxBytes: config.context.maxBytes,
    maxBlocks: config.stopGate.maxBlocks,
    maxContextChars: options.maxContextChars,
    maxMatchesPerRule: config.maxMatchesPerRule,
    stopGate: options.stopGate === true && event.kind === "verify" && session !== null,
    ...(via === undefined ? {} : { via }),
    ...(swept.length === 0 ? {} : { swept }),
    ...(refused.length === 0 ? {} : { refused }),
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
    return decision.delivery
  }

  if (!session) return { delivery: persisted(await decide(inputFor(view))), failed, deadlineMissed, ignored }

  await appendWork(session.dir, workRecords)
  try {
    const decision = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
    return { delivery: persisted(decision), failed, deadlineMissed, ignored }
  } catch (error) {
    // §14's two "run without session state" rows: a lock nobody released, and a store nobody can
    // read. The commit reads the stores inside the lock, so both surface here as well.
    if (error instanceof CorruptStoreError) {
      log(`session store unreadable: ${error.message}`)
      warnings.push({ key: "store", text: STORE_UNREADABLE })
    } else if (error instanceof LockTimeoutError) {
      warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    } else throw error
    const decision = await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false })
    return { delivery: persisted(decision), failed, deadlineMissed, ignored }
  }
}
