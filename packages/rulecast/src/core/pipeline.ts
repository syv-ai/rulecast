import { createHash } from "node:crypto"

import { computeChanges, isNew } from "./baseline/baseline"
import { type Snapshot, snapshotOf } from "./baseline/hash"
import { appendBaseline, type BaselineState, readBaseline, snapshotRecord, startRecord } from "./baseline/store"
import { type CompiledProject, type Diagnostic, diagnosticText } from "./compile/project"
import type { CompiledRule } from "./compile/rule"
import { writeOverflow } from "./delivery/persist"
import { createReferenceResolver, resolveRuleContext } from "./delivery/resolve"
import { applyFileBudget, applySizeCeiling } from "./detection/budget"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { fileBytes, readSourceFile } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectDetectorRules, selectTouchRules } from "./detection/select"
import { headCommit } from "./git"
import { guardWrite } from "./guard"
import { CorruptStoreError } from "./jsonl"
import { type ClassifiedFinding, type DecideInput, type Decision, decide } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import { emptyContext, emptyWork, type WorkRecord } from "./session/state"
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
  /** Detector kinds to skip entirely (run --no-llm). */
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
}

type Warning = { key: string; text: string }

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
function detectorWarnings(errors: readonly { kind: string; rules: string[]; message: string }[]): Warning[] {
  const text = (error: { kind: string; rules: string[]; message: string }) =>
    `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. Disabled for this session.`
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
      text: `${ids.length} ${kind} rules were disabled this session — see debug.log.\nFirst: ${text(group[0]!)}`,
    })
  }
  return summarised
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { project, stateDir, event, registry } = options
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
  if (event.kind === "reset") {
    if (session) await appendContext(session.dir, session.agent, [{ t: "reset" }])
    // Without re-attached files there is nothing to re-deliver (§9 reset).
    if (!session || restoredFiles === 0) return { delivery: emptyDelivery(), failed, deadlineMissed }
  }

  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  // A reset only delivers touch context, and a guard judges a file that does not exist yet: neither
  // takes snapshots, and neither starts the session.
  if (session && event.kind !== "reset" && event.kind !== "guard") {
    const dir = session.dir
    baseline = await readingStore(() => readBaseline(dir), baseline)
    if (session && !baseline.started) {
      await appendBaseline(dir, [startRecord(await headCommit(root))])
      // Re-read: with concurrent first events, the first start record wins.
      baseline = await readingStore(() => readBaseline(dir), baseline)
    }
  }

  const empty = (): SessionView => ({ work: emptyWork(), context: emptyContext() })
  const view: SessionView = session
    ? await readingStore(() => openSession(session!.dir, session!.agent), empty())
    : empty()
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  const workRecords: WorkRecord[] = []
  const relevant = (files: readonly string[]) =>
    files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  if (event.kind === "guard") {
    // Bound to a const: `session` is cleared when a store turns out to be unreadable, so a closure
    // that reads it later would not have the value this branch checked.
    const open = session
    const delivery = await guardWrite({
      root,
      config,
      registry,
      stateDir,
      event,
      rules: project.rules,
      disabled,
      work: view.work,
      resolver,
      maxContextChars: options.maxContextChars,
      log,
      record: open ? (records) => appendWork(open.dir, records) : async () => {},
    })
    return { delivery, failed, deadlineMissed }
  }

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
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

  if (event.kind === "touch") {
    if (event.completeRead) agentRead = event.files[0] ?? null
    if (session) {
      const records = []
      for (const file of relevant(event.files)) {
        if (baseline.snapshots.has(file)) continue
        const text = await readSourceFile(root, file)
        if (text !== null) records.push(snapshotRecord(file, snapshotOf(text)))
      }
      await appendBaseline(session.dir, records)
    }
  }

  if (event.kind === "edit" || event.kind === "verify") {
    let files = relevant(event.files)
    let snapshots: ReadonlyMap<string, Snapshot> = session ? baseline.snapshots : new Map()
    let fallbackCommit = session ? baseline.startCommit : null

    if (event.kind === "edit" && session) {
      await appendWork(
        session.dir,
        files.map((file) => ({ t: "edited" as const, file })),
      )
    }
    if (event.kind === "verify") {
      if (event.baseCommit) {
        fallbackCommit = event.baseCommit
        snapshots = new Map()
      }
      if (event.files.length === 0 && session) files = relevant(view.work.edited)
    }

    const changes = await computeChanges(root, files, { snapshots, fallbackCommit })
    if (event.kind === "verify" && session && !event.baseCommit) {
      // Files edited but back to their snapshot content have nothing new.
      files = files.filter((file) => changes.get(file)?.changedLines.length !== 0)
    }

    const skip = options.skipDetectorKinds ?? new Set<string>()
    let selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector.kind) && (options.onlyRules?.has(selection.rule.id) ?? true),
    )
    // Spec §6: at most llm.max_files_per_verify files per verify, most recently edited first.
    // work.edited is least recently edited first, so it is reversed.
    let overBudget: string[] = []
    if (event.kind === "verify") {
      const budgeted = applyFileBudget("llm", selections, config.llm.maxFilesPerVerify, [...view.work.edited].reverse())
      selections = budgeted.selections
      overBudget = budgeted.skipped
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
    const output = await runDetection({
      root,
      event: event.kind,
      selections,
      changes,
      read: (file) => readSourceFile(root, file),
      registry,
      cacheFor: (kind) => diskCache(detectorCacheDir(stateDir, kind)),
      contextFor: (rule) => resolveRuleContext(resolver, rule.context),
      settings: { llm: config.llm },
      timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : config.timeouts.verifyMs,
    })

    findings = output.findings.map(({ rule, match }) => ({
      rule,
      match,
      status: isNew(match, changes) ? "new" : "preexisting",
    }))
    for (const error of output.errors) {
      failed = true
      log(`${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}`)
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
    }
    // Every one of them is in the debug log above, which is where the summary points.
    warnings.push(...detectorWarnings(output.errors))
    if (overBudget.length > 0) {
      // Not `failed`: staying inside a budget the project set is normal operation, not a rulecast
      // failure, so it must not change the exit code.
      warnings.push({
        key: `llm-budget:${overBudget.join(",")}`,
        text: `llm rules checked ${config.llm.maxFilesPerVerify} files; ${overBudget.length} were not checked: ${overBudget.join(", ")}. Raise llm.max_files_per_verify, or run rulecast run --files on them.`,
      })
    }
    for (const timeout of output.timedOut) {
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
        deadlineMissed.push(timeout.kind)
      } else {
        failed = true
        warnings.push({
          key: `timeout:${timeout.kind}:${timeout.rules.join(",")}`,
          // Naming the lever matters: the real-project trial measured a single haiku call on a 135-line file
          // at 89 s against a 60 s default, and "timed out" alone leaves nobody knowing what to do.
          text:
            `${timeout.kind} detector timed out after ${config.timeouts.verifyMs} ms for ${timeout.rules.join(", ")}. ` +
            `Raise timeouts.verify_ms${timeout.kind === "llm" ? " (an llm rule on a large file can need 120000 or more)" : ""}.`,
        })
      }
    }
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
  })

  // A delivery the budget had to cut rules out of is written whole, and the message says where.
  const persisted = (decision: Decision): Delivery => {
    if (decision.overflow !== null) {
      decision.delivery.overflowPath = writeOverflow(stateDir, event.session?.id ?? null, decision.overflow)
    }
    return decision.delivery
  }

  if (!session) return { delivery: persisted(await decide(inputFor(view))), failed, deadlineMissed }

  await appendWork(session.dir, workRecords)
  try {
    const decision = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
    return { delivery: persisted(decision), failed, deadlineMissed }
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
    return { delivery: persisted(decision), failed, deadlineMissed }
  }
}
