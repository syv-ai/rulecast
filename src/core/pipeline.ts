import { computeChanges, isNew } from "./baseline/baseline"
import { headCommit, mergeBase } from "./baseline/git"
import { snapshotOf, type Snapshot } from "./baseline/hash"
import { appendBaseline, readBaseline, snapshotRecord, startRecord, type BaselineState } from "./baseline/store"
import { compile, type CompiledProject, type CompiledRule } from "./compile/compile"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { readSourceFile } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectTouchRules, selectViolationRules } from "./detection/select"
import { createReferenceResolver } from "./delivery/resolve"
import { decide, type ClassifiedFinding, type DecideInput } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { appendContext, appendWork, commitSession, openSession, sessionDir, type SessionView } from "./session/session"
import { emptyContext, emptyWork, type WorkRecord } from "./session/state"
import { emptyDelivery, type Delivery, type Event, type ResolvedReference } from "./types"

export interface PipelineOptions {
  root: string
  event: Event
  registry: DetectorRegistry
  /** From the adapter; null = unlimited. */
  maxContextChars: number | null
  /** Detector kinds to skip entirely (check --no-llm). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Debug log sink. */
  log?: (line: string) => void
}

export interface PipelineResult {
  delivery: Delivery
  project: CompiledProject
  /** rulecast itself failed: compile diagnostics, detector errors or verify timeouts. */
  failed: boolean
}

type Warning = { key: string; text: string }

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { root, event, registry } = options
  const log = options.log ?? (() => {})
  const project = await compile(root, registry)
  const { config } = project
  const warnings: Warning[] = project.diagnostics.map((diagnostic) => ({
    key: `diagnostic:${diagnostic.source}:${diagnostic.message}`,
    text: `${diagnostic.source}: ${diagnostic.message} (run rulecast validate)`,
  }))
  let failed = project.diagnostics.length > 0
  const session = event.session
    ? { dir: sessionDir(root, event.session.id), agent: event.session.agentId ?? "main" }
    : null

  if (event.kind === "prompt" || event.kind === "reset") {
    if (session && event.kind === "prompt") await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    if (session && event.kind === "reset") await appendContext(session.dir, session.agent, [{ t: "reset" }])
    return { delivery: emptyDelivery(), project, failed }
  }

  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  if (session) {
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
  const relevant = (files: readonly string[]) => files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let agentRead: string | null = null

  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
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
      await appendWork(session.dir, files.map((file) => ({ t: "edited" as const, file })))
    }
    if (event.kind === "verify") {
      if (event.baseRef) {
        fallbackCommit = await mergeBase(root, event.baseRef)
        snapshots = new Map()
      }
      if (event.files.length === 0 && session) files = relevant(view.work.edited)
    }

    const changes = await computeChanges(root, files, { snapshots, fallbackCommit })
    if (event.kind === "verify" && session && !event.baseRef) {
      // Files edited but back to their snapshot content have nothing new.
      files = files.filter((file) => changes.get(file)?.changedLines.length !== 0)
    }

    const skip = options.skipDetectorKinds ?? new Set<string>()
    const selections = selectViolationRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector!.kind),
    )
    const output = await runDetection({
      root,
      event: event.kind,
      selections,
      changes,
      registry,
      cacheFor: (kind) => diskCache(detectorCacheDir(root, kind)),
      contextFor: async (rule) => {
        const references: ResolvedReference[] = []
        for (const spec of rule.context) {
          const resolved = await resolver.resolve(spec)
          if (resolved.found) references.push({ ref: spec.ref, content: resolved.content })
        }
        return references
      },
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
    for (const timeout of output.timedOut) {
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
      } else {
        failed = true
        warnings.push({
          key: `timeout:${timeout.kind}:${timeout.rules.join(",")}`,
          text: `${timeout.kind} detector timed out for ${timeout.rules.join(", ")}`,
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
    stopGate: event.kind === "verify" && session !== null,
  })

  if (!session) return { delivery: (await decide(inputFor(view))).delivery, project, failed }

  await appendWork(session.dir, workRecords)
  try {
    const delivery = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
    return { delivery, project, failed }
  } catch (error) {
    if (!(error instanceof LockTimeoutError)) throw error
    warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    const delivery = (await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false }))
      .delivery
    return { delivery, project, failed }
  }
}
