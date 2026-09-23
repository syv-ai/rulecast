import { computeChanges, isNew } from "./baseline/baseline"
import { type Snapshot, snapshotOf } from "./baseline/hash"
import { appendBaseline, type BaselineState, readBaseline, snapshotRecord, startRecord } from "./baseline/store"
import type { CompiledProject } from "./compile/project"
import type { CompiledRule } from "./compile/rule"
import { writeOverflow } from "./delivery/persist"
import { createReferenceResolver } from "./delivery/resolve"
import { applyFileBudget } from "./detection/budget"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { readSourceFile } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectDetectorRules, selectTouchRules } from "./detection/select"
import { headCommit } from "./git"
import { guardWrite } from "./guard"
import { type ClassifiedFinding, type DecideInput, type Decision, decide } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import { emptyContext, emptyWork, type WorkRecord } from "./session/state"
import { type Delivery, type Event, emptyDelivery, type ResolvedReference } from "./types"

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

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { project, stateDir, event, registry } = options
  const { root, config } = project
  const log = options.log ?? (() => {})
  // Warnings (a branch-like rev) are for rulecast validate; only errors disable rules.
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const warnings: Warning[] = errors.map((diagnostic) => ({
    key: `diagnostic:${diagnostic.source}:${diagnostic.rule ?? ""}:${diagnostic.message}`,
    text: `${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message} (run ${diagnostic.hint ?? "rulecast validate"})`,
  }))
  let failed = errors.length > 0
  const deadlineMissed: string[] = []
  const session = event.session
    ? { dir: sessionDir(stateDir, event.session.id), agent: event.session.agentId ?? "main" }
    : null

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
    baseline = await readBaseline(session.dir)
    if (!baseline.started) {
      await appendBaseline(session.dir, [startRecord(await headCommit(root))])
      // Re-read: with concurrent first events, the first start record wins.
      baseline = await readBaseline(session.dir)
    }
  }

  const view: SessionView = session
    ? await openSession(session.dir, session.agent)
    : { work: emptyWork(), context: emptyContext() }
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  const workRecords: WorkRecord[] = []
  const relevant = (files: readonly string[]) =>
    files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  if (event.kind === "guard") {
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
      record: session ? (records) => appendWork(session.dir, records) : async () => {},
    })
    return { delivery, failed, deadlineMissed }
  }

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let agentRead: string | null = null

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
      (selection) => !skip.has(selection.rule.detector!.kind) && (options.onlyRules?.has(selection.rule.id) ?? true),
    )
    // Spec §6: at most llm.max_files_per_verify files per verify, most recently edited first.
    // work.edited is least recently edited first, so it is reversed.
    let overBudget: string[] = []
    if (event.kind === "verify") {
      const budgeted = applyFileBudget("llm", selections, config.llm.maxFilesPerVerify, [...view.work.edited].reverse())
      selections = budgeted.selections
      overBudget = budgeted.skipped
    }
    const output = await runDetection({
      root,
      event: event.kind,
      selections,
      changes,
      read: (file) => readSourceFile(root, file),
      registry,
      cacheFor: (kind) => diskCache(detectorCacheDir(stateDir, kind)),
      contextFor: async (rule) => {
        const references: ResolvedReference[] = []
        for (const spec of rule.context) {
          const resolved = await resolver.resolve(spec)
          if (resolved.found) references.push({ ref: spec.ref, content: resolved.content })
        }
        return references
      },
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
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
      warnings.push({
        key: `detector:${error.kind}:${error.rules.join(",")}:${error.message}`,
        text: `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. Disabled for this session.`,
      })
    }
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
          // Naming the lever matters: dogfooding measured a single haiku call on a 135-line file
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
    if (!(error instanceof LockTimeoutError)) throw error
    warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    const decision = await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false })
    return { delivery: persisted(decision), failed, deadlineMissed }
  }
}
