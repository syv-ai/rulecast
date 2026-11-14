import { isNew } from "./baseline/baseline"
import { classify } from "./baseline/classify"
import { baselineHas } from "./baseline/committed"
import { foreignCommits, type HeadMove, linesFromCommits } from "./baseline/foreign"
import { removedFindings } from "./baseline/removed"
import { removedDefinitions } from "./baseline/removed-definitions"
import { type BaselineInput, changesFor } from "./baseline/stage"
import { appendBaseline, type BaselineState } from "./baseline/store"
import type { CompiledRule } from "./compile/rule"
import { contentReader, WORKTREE } from "./content"
import { applyFileBudget, applySizeCeiling } from "./detection/budget"
import type { DetectionContext } from "./detection/context"
import { runDetectionFrom } from "./detection/materialise"
import { fileBytes } from "./detection/per-rule"
import { selectDetectorRules } from "./detection/select"
import { type DisabledGroup, disabledRules } from "./disabled"
import { findingIds } from "./finding-id"
import { deletedFilesSince } from "./git"
import type { Run } from "./pipeline"
import { DISABLED_WARNING, detectorWarnings } from "./pipeline-warnings"
import type { ClassifiedFinding } from "./session/decide"
import { configHash, type Notice, notices } from "./session/oversight"
import type { SessionView } from "./session/session"
import { dirtyAtStart, editedBy, MAIN_AGENT, type WorkRecord } from "./session/state"
import { type IgnoredFinding, sourceLines } from "./suppress"
import type { Delivery, Event, Match, RemovedDefinition } from "./types"

/** What an edit or a verify checks, and how: decided by the pipeline before detection runs. */
export interface DetectInput {
  event: Extract<Event, { kind: "edit" | "verify" }>
  view: SessionView
  baseline: BaselineState
  baselineInput: BaselineInput
  detection: DetectionContext
  disabled: ReadonlySet<string>
  /** The files to check: the event's, or at a stop the session's edits and swept files. */
  requested: string[]
  /** The edit came from a shell call (spec §9, Shell edits). */
  via: "shell" | undefined
  /** That shell call ran alongside another agent's, so what it changed may be partly theirs. */
  sharedCall: boolean
}

/** What detection found, for decide, the session store and the findings log. */
export interface Detected {
  findings: ClassifiedFinding[]
  ignored: IgnoredFinding[]
  /**
   * Unattended: ignores the agent added or changed, on findings they did not silence (D49). The
   * findings log keeps them as the agent's attempts; an unchanged comment over changed code is none.
   */
  tried: IgnoredFinding[]
  ran: Map<string, string[]>
  /** Notices for the user (session/oversight.ts). */
  told: Notice[]
  disabledGroups: DisabledGroup[]
  refused: NonNullable<Delivery["refused"]>
  /** Records for the session store: rules disabled by a detector failure, notices given. */
  workRecords: WorkRecord[]
  /** rulecast itself failed here: a detector error, a verify timeout, a rule that did not run. */
  failed: boolean
}

/**
 * Whether a match lies wholly on lines that commits from elsewhere brought in during the session (a
 * pull, a merge): those are not the agent's, though the file's baseline predates them. Only asked
 * when there is a git operation and a new finding; each git call in it is bounded.
 */
async function pulledInLines(
  root: string,
  moves: readonly HeadMove[],
  findings: readonly { match: Match }[],
): Promise<(match: Match) => boolean> {
  if (moves.length === 0 || findings.length === 0) return () => false
  const commits = await foreignCommits(root, moves)
  if (commits.size === 0) return () => false
  const files = [...new Set(findings.map(({ match }) => match.file))]
  const byFile = new Map(
    await Promise.all(files.map(async (file) => [file, await linesFromCommits(root, file, commits)] as const)),
  )
  return (match) => {
    const lines = byFile.get(match.file)
    if (lines === undefined || lines.size === 0) return false
    for (let line = match.line; line <= match.endLine; line++) if (!lines.has(line)) return false
    return true
  }
}

/**
 * Detection for an edit or a verify: baselines, the detectors, classification, ignores, and what to
 * tell the user and the agent about rules that did not run. Warnings and missed deadlines go to the
 * run's accumulators; everything else is returned.
 */
export async function detectStage(run: Run, input: DetectInput): Promise<Detected> {
  const { options, project, root, config, registry, log, session, warnings } = run
  const { event, view, baseline, baselineInput, detection, disabled, requested, via, sharedCall } = input
  let failed = false
  const workRecords: WorkRecord[] = []
  const refused: NonNullable<Delivery["refused"]> = []
  let told: Notice[] = []
  let disabledGroups: DisabledGroup[] = []

  // One budget for the whole verify: measuring baselines below and the detectors after it share
  // verify_ms, so a stop ends inside the hook's timeout (verify_ms plus a margin) and is not killed.
  const verifyEnds = Date.now() + config.timeouts.verifyMs
  const source = event.kind === "verify" ? (event.content ?? WORKTREE) : WORKTREE
  // One reader for the baseline diff and the detectors, so they agree on what "the file" is.
  const read = contentReader(root, source)
  const stage = await changesFor(
    baselineInput,
    event.kind === "verify" ? { kind: "verify", baseCommit: event.baseCommit } : { kind: "edit" },
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
  // At a verify with a commit to compare with: what the whole change removed, read once, and only
  // if an llm rule with `removed_definitions` asks (#72). Deleted files are in no list of changed
  // files, and a moved definition's old file is often one, so they are asked of git here: all of
  // them, as a definition can move out of a file no rule checks.
  const commit = event.kind === "verify" ? (event.baseCommit ?? baseline.startCommit) : null
  let gone: Promise<RemovedDefinition[]> | undefined
  const definitionsGone =
    commit === null
      ? undefined
      : () =>
          (gone ??= deletedFilesSince(root, commit, source).then((deleted) =>
            removedDefinitions(root, [...requested, ...deleted], commit, read),
          ))
  const detected = await runDetectionFrom(
    {
      detection,
      event: event.kind,
      selections,
      changes,
      ...(definitionsGone === undefined ? {} : { removedDefinitions: definitionsGone }),
      read,
      lines,
      timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : Math.max(1, verifyEnds - Date.now()),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    source,
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
  const classifiedStatus = (rule: CompiledRule, match: Match, id: string): ClassifiedFinding["status"] =>
    committed === undefined
      ? classify(match, rule.scope, rule.id, baselineChanges, containers)
      : baselineHas(committed, rule.id, match.file, id)
        ? "preexisting"
        : "new"
  const removedFrom = output.findings.length + output.ignored.length
  const pulledIn = await pulledInLines(root, [...view.work.headMoves, ...run.movedNow], output.findings)
  const statusOf = (rule: CompiledRule, match: Match, id: string): ClassifiedFinding["status"] => {
    const status = classifiedStatus(rule, match, id)
    return status === "new" && pulledIn(match) ? "preexisting" : status
  }
  const findings: ClassifiedFinding[] = [
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
  const tried = unsilenced.filter(commentChanged).map(({ status: _, ...item }) => item)
  const ignored = classifiedIgnores.filter(({ match }) => !kept.has(match)).map(({ status: _, ...item }) => item)
  const incomplete = new Set([
    ...output.errors.flatMap((error) => error.rules),
    ...output.timedOut.flatMap((timeout) => timeout.rules),
    ...output.skipped,
  ])
  const ran = new Map(
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
    const shared = sharedCall || view.work.sharedEdits.has(match.file)
    refused.push({
      file: match.file,
      rule: rule.id,
      dirtyAtStart: dirtyAtStart(view.work, match.file),
      ...(shared ? { shared: true as const } : {}),
    })
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
      ...(run.display === undefined ? {} : { display: run.display }),
    })
    // Recorded now: a notice is for the user, and the user sees it whatever the gate decides.
    for (const notice of told) for (const key of notice.key.split("\n")) workRecords.push({ t: "noticed", key })
  }
  // Every time, not once per context: a loop nobody watches must not read "no findings" as
  // "checked". The session's earlier disables are named too, since they are skipped above unsaid.
  if (event.kind === "verify" && (options.reportDisabled === true || (atStop && project.mode.mode === "unattended"))) {
    const kinds = new Map(project.rules.map((rule) => [rule.id, rule.detector?.kind ?? "detector"]))
    // `rulecast run` names what kept this run from being complete, and so nothing it did not
    // count: not another rule's compile error under RULE_ID, nor a disable that would not have run.
    const scoped = options.reportDisabled === true
    const earlier = [...view.work.disabled]
      .filter(([rule]) => !scoped || skippedHere.has(rule))
      .map(([rule, message]) => ({ kind: kinds.get(rule) ?? "detector", rules: [rule], message }))
    disabledGroups = disabledRules({
      diagnostics: scoped ? run.errors.filter(run.concernsRun) : run.errors,
      detectorErrors: [...output.errors, ...earlier],
    })
    // `disabled` and `complete` agree: a run that lists a rule that did not run is incomplete.
    if (scoped && disabledGroups.length > 0) failed = true
    // `rulecast run` lists them under "did not run"; its problems are the rest. A hook keeps them:
    // there the warning is the once-per-context word to the user, the list the agent's every stop.
    if (options.reportDisabled === true) {
      const keep = warnings.filter((warning) => !DISABLED_WARNING.test(warning.key))
      warnings.splice(0, warnings.length, ...keep)
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
      text: `${kind} rules checked ${max} files; ${skipped.length} were not checked: ${skipped.map(run.shown).join(", ")}. Raise ${setting}, or run rulecast run --files on them.`,
    })
  }
  const hintFor = (kind: string) => {
    const hint = registry.get(kind)?.timeoutHint
    return hint === undefined ? "" : ` (${hint})`
  }
  for (const timeout of output.timedOut) {
    if (event.kind === "edit") {
      log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
      run.deadlineMissed.push(timeout.kind)
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
  return { findings, ignored, tried, ran, told, disabledGroups, refused, workRecords, failed }
}
