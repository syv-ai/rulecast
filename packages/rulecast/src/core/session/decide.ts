import { createHash } from "node:crypto"
import path from "node:path"

import { type CompiledRule, findingDocs, ruleContextFor } from "../compile/rule"
import type { Mode } from "../config/schema"
import { deliveryCost, measureRuleBlock, repeatedLine, repeatedListLine, SWEPT_BLOCK } from "../delivery/render-agent"
import type { ReferenceResolver, ResolvedRef } from "../delivery/resolve"
import type { DisabledGroup } from "../disabled"
import type { ReferenceSpec } from "../references"
import { renderTemplate, templateBindings } from "../template"
import { type DeliveredReference, type Delivery, emptyDelivery, type Finding, type Match } from "../types"
import {
  blockedKey,
  type ContextRecord,
  type ContextState,
  emptyContext,
  MAIN_AGENT,
  preexistingKey,
  type Sent,
  type SentFinding,
  type WorkRecord,
  type WorkState,
} from "./state"

export interface ClassifiedFinding {
  /** The finding's stable id (core/finding-id.ts). */
  id: string
  rule: CompiledRule
  match: Match
  status: "new" | "preexisting"
}

export interface DecideInput {
  agent: string
  findings: ClassifiedFinding[]
  /** Touch rules selected for this event (not yet fired). */
  touches: CompiledRule[]
  /** Path of a file the agent read completely in this event. */
  agentRead: string | null
  warnings: { key: string; text: string }[]
  work: WorkState
  context: ContextState
  resolver: ReferenceResolver
  maxBytes: number
  maxBlocks: number
  maxContextChars: number | null
  /** The renderer's cap per rule: the budget stops filling a rule's block at it. */
  maxMatchesPerRule: number
  /** verify from a stop: decide block / allow / capReached, and in unattended mode report. */
  stopGate: boolean
  /** Default: attended. Unattended changes the stop gate (`gate`) and what the adapter says. */
  mode?: Mode
  /** The findings are in files the agent's shell command changed (Delivery.via). */
  via?: "shell"
  /** Files changed outside the agent's tool calls, verified at this stop: reported, never blocking. */
  swept?: readonly string[]
  /** Protected files the agent changed with its shell (Delivery.refused). */
  refused?: Delivery["refused"]
  /** Fill `Delivery.preexisting` (AssembleInput.listPreexisting). */
  listPreexisting?: boolean
  /** Configured rules that did not run (Delivery.disabled): attached whole, after the budget. */
  disabled?: DisabledGroup[]
  /** AssembleInput.display. */
  display?: (file: string) => string
  /**
   * At a stop: the files each rule ran on to the end (by rule id), and the files that can hold no new
   * finding: edited and since deleted, or back to their baseline. A finding sent earlier and not found
   * now by its rule on its file, or in such a file, is forgotten (`repeats`). A rule that timed out
   * or was over a file budget forgets nothing.
   */
  stopRan?: ReadonlyMap<string, readonly string[]>
  stopCleared?: readonly string[]
  /** At a stop: the content hash of each file with a finding, which tells a repeat from a finding in a changed file. */
  fileHashes?: ReadonlyMap<string, string>
}

export interface Decision {
  delivery: Delivery
  /** The delivery as it stood before the budget cut whole rules out of it; null when it cut none. */
  overflow: Delivery | null
  work: WorkRecord[]
  context: ContextRecord[]
  /**
   * At a block or a report: the findings (by findingKey) that kept the stop from going through. Not
   * one that has blocked REPEAT_LIMIT stops and only rides along with a block (the findings log).
   */
  blocking?: ReadonlySet<string>
  /**
   * At an attended stop that put its findings before nobody (allow, capReached): what to record as
   * sent if another project's block shows them to the agent after all (commands/hook.ts).
   */
  ifShown?: WorkRecord
}

/**
 * The most of the budget warnings may take between them.
 *
 * They are charged after the floor, so this only bounds what they take from the doc sections and
 * the repeats below it — the floor is already safe. It exists because a warning explains why
 * rulecast is not working, and a finding is the work the agent came for: at eighty broken rules
 * the warnings took 13,500 characters of a 9,000 character budget and the one finding was dropped.
 */
const WARNING_SHARE = 0.15

/**
 * What replaces the warnings the share could not hold: how many, and where all of them are, never a
 * sentence cut short (the developer, 2026-11-15).
 */
const moreWarnings = (cut: readonly unknown[]) => `${cut.length} more — run rulecast doctor`

/**
 * What a reference is called in a delivery. A project reference names a file in the project, so it
 * is shown like any other file (`display`); a rule repo's keeps its label. Its spec's `ref` stays the
 * root's: that is its identity in the config and in what the session records.
 */
function shownRef(spec: ReferenceSpec, display: (file: string) => string): string {
  if (path.isAbsolute(spec.path)) return spec.ref
  return spec.anchor === null ? display(spec.path) : `${display(spec.path)}#${spec.anchor}`
}

/** Rule repo references have absolute paths; the agent needs that path to read them. */
function locationOf(spec: ReferenceSpec): { location?: string } {
  return path.isAbsolute(spec.path) ? { location: spec.path } : {}
}

/**
 * The values a grouped rendering lists per site. Only the ones the template names: a rule matching
 * a whole JSX block has a `text` nobody asked for, and it would be carried into every output.
 */
function capturesFor(rule: CompiledRule, match: Match): Record<string, string> | undefined {
  const names = templateBindings(rule.message ?? "")
  if (names.length === 0) return undefined
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = name === "text" ? match.text : match.captures[name]
    if (value !== undefined) values[name] = value
  }
  return values
}

/** What a finding points to, as the delivery shows it: a project section by its shown ref. */
function docsFor(rule: CompiledRule, match: Match, display: (file: string) => string): Pick<Finding, "docs"> {
  const docs = findingDocs(rule, match)
  if (docs === null) return {}
  return { docs: "spec" in docs ? { ref: shownRef(docs.spec, display) } : docs }
}

function renderFindings(
  findings: ClassifiedFinding[],
  status: Finding["status"],
  display: (file: string) => string,
  /** Filled with each finding's `context_by_rule` sections, for the ones whose lint rule maps any. */
  sections?: Map<Finding, ReferenceSpec[]>,
  /** Filled with the finding each one is rendered as: several merge into one when their messages agree. */
  rendered?: Map<ClassifiedFinding, Finding>,
): Finding[] {
  const merged = new Map<string, Finding>()
  for (const classified of findings) {
    const { id, rule, match } = classified
    const file = display(match.file)
    const message = renderTemplate(rule.message ?? "", {
      ...match.captures,
      file,
      line: String(match.line),
      column: String(match.column),
      text: match.text,
      rule: rule.id,
    })
    // A rule that maps sections per lint rule keeps its lint rules apart, even where their messages
    // read the same: each finding then points to one lint rule's section.
    const ruleId = match.captures.ruleId ?? ""
    const key = `${rule.id} ${match.file} ${message}${rule.contextByRule.size > 0 ? ` ${ruleId}` : ""}`
    const existing = merged.get(key)
    const site = { line: match.line, endLine: match.endLine, column: match.column }
    if (existing === undefined) {
      const mapped = rule.contextByRule.get(ruleId)
      const finding: Finding = {
        id,
        rule: rule.id,
        severity: rule.severity,
        status,
        file,
        ...site,
        message,
        count: 1,
        captures: capturesFor(rule, match),
        // Only when true, so a document from a project with no fixes is unchanged (output.md). Never
        // a removed finding: what is gone has nothing to rewrite.
        ...(rule.fixable && rule.scope !== "removed" ? { fixable: true as const } : {}),
        ...docsFor(rule, match, display),
      }
      merged.set(key, finding)
      rendered?.set(classified, finding)
      if (mapped !== undefined) sections?.set(finding, mapped)
      continue
    }
    rendered?.set(classified, existing)
    existing.count++
    // The earliest match is the one shown, and its id the merged finding's: a tool's emit order
    // must not decide either.
    if (match.line < existing.line || (match.line === existing.line && match.column < existing.column)) {
      delete existing.docs
      Object.assign(existing, { id, ...site, captures: capturesFor(rule, match), ...docsFor(rule, match, display) })
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  )
}

async function isCovered(
  spec: ReferenceSpec,
  delivered: ContextState["delivered"],
  resolver: ReferenceResolver,
): Promise<boolean> {
  for (const entry of delivered) {
    if (entry.path !== spec.path) continue
    if (!(await resolver.contains(spec.path, entry.anchor, spec.anchor))) continue
    if ((await resolver.currentHash(entry.path, entry.anchor)) === entry.hash) return true
  }
  return false
}

/** What `assemble` needs: everything that decides what a delivery *says*, before any budget. */
export interface AssembleInput {
  findings: ClassifiedFinding[]
  /** Touch rules selected for this event (not yet fired). Default: none. */
  touches?: CompiledRule[]
  /** Path of a file the agent read completely in this event. Default: none. */
  agentRead?: string | null
  /** Default: none. */
  warnings?: { key: string; text: string }[]
  /** What this agent context has already been told. Default: nothing, so everything is sent. */
  context?: ContextState
  resolver: ReferenceResolver
  maxBytes: number
  /** Default: an edit tool, or no edit at all. */
  via?: "shell"
  /** Default: none. */
  swept?: readonly string[]
  /** Default: none. */
  refused?: Delivery["refused"]
  /**
   * Also render the pre-existing findings in full, into `Delivery.preexisting`: `rulecast run`'s
   * JSON and SARIF report them by id. Not filtered by what the context was already told, and never
   * set on the hook path, where the summary is what an agent is given. Default: false.
   */
  listPreexisting?: boolean
  /**
   * The path a root-relative file is shown as (core/projects.ts `displayPath`): every file in the
   * delivery goes through it, so the budget prices what the agent reads. Only what is shown: ids,
   * keys and every record stay root-relative. Default: the file as it is.
   */
  display?: (file: string) => string
}

/**
 * The whole delivery, and what the budget needs to cut it that the delivery cannot carry.
 *
 * `trim` cannot work from a `Delivery` alone: demoting a reference needs its spec's path, and
 * recording one as delivered needs the hash it was resolved at, and neither is on
 * `DeliveredReference`. `fresh` is here for the stop gate, which must read what was *found*.
 */
export interface Assembled {
  /** Untrimmed, and never changed afterwards: it is also what an overflow file is written from. */
  delivery: Delivery
  /**
   * References given full content, by their index in `delivery.references`, in the order the budget
   * fills them. `contains`: the positions in this list of the other candidates whose text this one's
   * includes, such as the sections of a whole file both are cited from (#69).
   */
  candidates: { index: number; resolved: Extract<ResolvedRef, { found: true }>; contains: number[] }[]
  /** Findings with status "new", in input order. */
  fresh: ClassifiedFinding[]
  /** The finding in `delivery.findings` each of `fresh` is rendered as. */
  rendered: ReadonlyMap<ClassifiedFinding, Finding>
  /** Warnings not yet given in this context; `delivery.warnings` holds their texts. */
  unwarned: { key: string; text: string }[]
  touches: CompiledRule[]
  /** What assembling decided to record: touched rules, and a complete read as delivered. */
  context: ContextRecord[]
  /**
   * Each summary in `delivery.preexistingSummary` to its root-relative file, which is what is
   * recorded once it is delivered; the summary's own `file` is the displayed one.
   */
  summaryFiles: ReadonlyMap<Delivery["preexistingSummary"][number], string>
  /**
   * A reference's `ref` to what `delivery.references` calls it, where the two differ: a project
   * reference shown from somewhere other than the root (`shownRef`).
   */
  refLabels: ReadonlyMap<string, string>
  /**
   * The references each rule in this delivery cites, by rule id: a detector rule's for the findings
   * it has here (`ruleContextFor`), a touch rule's `context`. What the budget charges with each rule.
   */
  ruleRefs: ReadonlyMap<string, ReferenceSpec[]>
  /**
   * The `context_by_rule` sections of each finding in `delivery.findings` whose lint rule maps any,
   * by identity. The budget charges such a section with the first finding of its lint rule it shows,
   * and drops it when it shows none.
   */
  findingSections: ReadonlyMap<Finding, ReferenceSpec[]>
}

/** Pre-existing findings whose file's summary this context has not been given yet. */
function unsummarised(findings: readonly ClassifiedFinding[], state: ContextState): ClassifiedFinding[] {
  return findings.filter(
    ({ rule, match, status }) =>
      status === "preexisting" && !state.preexisting.has(preexistingKey(rule.id, match.file)),
  )
}

/** Warnings not yet given in this context. */
function unwarnedOf<W extends { key: string }>(warnings: readonly W[], state: ContextState): W[] {
  return warnings.filter((warning) => !state.warned.has(warning.key))
}

/**
 * Whether `decide` would put anything in front of the agent: new findings (and with them their
 * doc sections and any swept file they are in), pre-existing summaries this context has not had,
 * warnings it has not had, touch rules, refused writes and rules that did not run. Built from the
 * same parts `assemble` uses, so the two cannot disagree. A pipeline claims its share of a shared
 * budget by it (PipelineOptions.shareBudget). Swept files without findings, and pre-existing
 * findings already summarised, deliver nothing.
 */
export function delivers(
  input: Pick<DecideInput, "findings" | "touches" | "warnings" | "context" | "refused" | "disabled">,
): boolean {
  return (
    input.findings.some((finding) => finding.status === "new") ||
    unsummarised(input.findings, input.context).length > 0 ||
    unwarnedOf(input.warnings, input.context).length > 0 ||
    input.touches.length > 0 ||
    (input.refused ?? []).length > 0 ||
    (input.disabled ?? []).length > 0
  )
}

export async function assemble(input: AssembleInput): Promise<Assembled> {
  const delivery = emptyDelivery()
  if (input.via !== undefined) delivery.via = input.via
  const context: ContextRecord[] = []
  const touches = input.touches ?? []
  const state = input.context ?? emptyContext()
  const display = input.display ?? ((file: string) => file)

  // Findings and pre-existing summaries.
  const fresh = input.findings.filter((finding) => finding.status === "new")
  const findingSections = new Map<Finding, ReferenceSpec[]>()
  const rendered = new Map<ClassifiedFinding, Finding>()
  delivery.findings = renderFindings(fresh, "new", display, findingSections, rendered)
  if (input.listPreexisting === true) {
    delivery.preexisting = renderFindings(
      input.findings.filter((finding) => finding.status === "preexisting"),
      "preexisting",
      display,
    )
  }
  const swept = new Set(input.swept ?? [])
  const sweptWithFindings = [...new Set(fresh.map(({ match }) => match.file))].filter((file) => swept.has(file))
  if (sweptWithFindings.length > 0) delivery.swept = sweptWithFindings.map(display).sort()
  if ((input.refused ?? []).length > 0) {
    delivery.refused = (input.refused ?? []).map((refused) => ({ ...refused, file: display(refused.file) }))
  }
  for (const { rule } of fresh) if (rule.message !== null) delivery.templates[rule.id] = rule.message
  const summaries = new Map<string, { rule: string; file: string; count: number }>()
  const summaryFiles = new Map<Delivery["preexistingSummary"][number], string>()
  for (const { rule, match } of unsummarised(input.findings, state)) {
    const key = preexistingKey(rule.id, match.file)
    let summary = summaries.get(key)
    if (summary === undefined) {
      summary = { rule: rule.id, file: display(match.file), count: 0 }
      summaries.set(key, summary)
      summaryFiles.set(summary, match.file)
    }
    summary.count++
  }
  delivery.preexistingSummary = [...summaries.values()]

  // Warnings, once per context. Which of them are kept — and so which are recorded as warned — is
  // decided by the budget, after the floor.
  const unwarned = unwarnedOf(input.warnings ?? [], state)
  delivery.warnings = unwarned.map((warning) => warning.text)

  // Touches.
  delivery.touches = touches.map((rule) => rule.id)
  for (const rule of touches) context.push({ t: "touched", rule: rule.id })

  // A complete read by the agent counts as delivered.
  const delivered = [...state.delivered]
  const agentRead = input.agentRead ?? null
  if (agentRead !== null) {
    const hash = await input.resolver.currentHash(agentRead, null)
    if (hash !== null) {
      delivered.push({ path: agentRead, anchor: null, hash })
      context.push({ t: "delivered", path: agentRead, anchor: null, hash })
    }
  }

  // References: each rule's for the findings it has here (a lint rule's section only when that lint
  // rule fired), in rule order, each ref once.
  const matchesByRule = new Map<string, { rule: CompiledRule; matches: Match[] }>()
  for (const { rule, match } of fresh) {
    const group = matchesByRule.get(rule.id)
    if (group === undefined) matchesByRule.set(rule.id, { rule, matches: [match] })
    else group.matches.push(match)
  }
  const ruleRefs = new Map<string, ReferenceSpec[]>()
  for (const [id, { rule, matches }] of matchesByRule) ruleRefs.set(id, ruleContextFor(rule, matches))
  // Narrow touch rules first: by the size of all they cite, then by how many items, then in config
  // order (the sort is stable). What fits in full when not all of it does is the most specific
  // part, and a rule citing a whole file, the one most likely read already, usually sorts after one
  // citing a few sections. Each reference is resolved once, here or below.
  const resolvedByRef = new Map<string, ResolvedRef>()
  const resolve = async (spec: ReferenceSpec) => {
    let resolved = resolvedByRef.get(spec.ref)
    if (resolved === undefined) {
      resolved = await input.resolver.resolve(spec)
      resolvedByRef.set(spec.ref, resolved)
    }
    return resolved
  }
  const citedSize = new Map<string, number>()
  for (const rule of touches) {
    let bytes = 0
    for (const spec of rule.context) {
      const resolved = await resolve(spec)
      if (resolved.found) bytes += resolved.bytes
    }
    citedSize.set(rule.id, bytes)
  }
  const narrowFirst = [...touches].sort(
    (a, b) => citedSize.get(a.id)! - citedSize.get(b.id)! || a.context.length - b.context.length,
  )
  for (const rule of narrowFirst) if (!ruleRefs.has(rule.id)) ruleRefs.set(rule.id, rule.context)
  const candidates: Assembled["candidates"] = []
  const refLabels = new Map<string, string>()
  const seenRefs = new Set<string>()
  for (const spec of [...ruleRefs.values()].flat()) {
    if (seenRefs.has(spec.ref)) continue
    seenRefs.add(spec.ref)
    const ref = shownRef(spec, display)
    if (ref !== spec.ref) refLabels.set(spec.ref, ref)
    const resolved = await resolve(spec)
    if (!resolved.found) {
      delivery.references.push({ ref, state: "missing" })
    } else if (await isCovered(spec, delivered, input.resolver)) {
      delivery.references.push({ ref, state: "pointer" })
    } else if (spec.mode === "read") {
      delivery.references.push({ ref, state: "read", reason: "mode", ...locationOf(spec) })
    } else if (resolved.bytes > input.maxBytes) {
      delivery.references.push({ ref, state: "read", reason: "tooLarge", ...locationOf(spec) })
    } else {
      candidates.push({ index: delivery.references.length, resolved, contains: [] })
      delivery.references.push({ ref, state: "full", content: resolved.content })
    }
  }
  for (const outer of candidates) {
    for (const [position, inner] of candidates.entries()) {
      if (inner === outer || inner.resolved.spec.path !== outer.resolved.spec.path) continue
      const { path: file, anchor } = outer.resolved.spec
      if (await input.resolver.contains(file, anchor, inner.resolved.spec.anchor)) outer.contains.push(position)
    }
  }

  return {
    delivery,
    candidates,
    fresh,
    rendered,
    unwarned,
    touches,
    context,
    summaryFiles,
    refLabels,
    ruleRefs,
    findingSections,
  }
}

export interface Trimmed {
  delivery: Delivery
  /** The untrimmed delivery, when the budget had to cut whole rules out; null when it cut none. */
  overflow: Delivery | null
  /** What trimming decided to record: warnings given, sections delivered, backlog announced. */
  context: ContextRecord[]
}

/**
 * Spec §9: cuts an assembled delivery to what fits. Never changes `assembled`.
 *
 * The floor is the header, the warnings, and one finding for every rule that fired. What is left
 * goes to the doc sections first, then the pre-existing summaries, then the rules' remaining
 * matches — the reverse of what is worth losing. A repeat the agent does not see it can still find
 * in the file; the section that explains the rule is the part it cannot.
 */
export function trim(
  assembled: Assembled,
  limits: { maxContextChars: number | null; maxMatchesPerRule: number },
): Trimmed {
  const { candidates, unwarned, touches } = assembled
  // A copy whose arrays the budget may cut. The Finding objects inside are shared, not cloned:
  // nothing here changes one, and the filter at the end of the fill keeps findings by identity.
  const delivery: Delivery = {
    ...assembled.delivery,
    findings: [...assembled.delivery.findings],
    preexistingSummary: [...assembled.delivery.preexistingSummary],
    references: [...assembled.delivery.references],
    warnings: [...assembled.delivery.warnings],
    omitted: { findings: [], rules: 0, preexisting: 0 },
  }
  const context: ContextRecord[] = []
  const rulesById = new Map(assembled.fresh.map(({ rule }) => [rule.id, rule]))
  const limit = limits.maxContextChars
  const render = { maxMatchesPerRule: limits.maxMatchesPerRule }
  // Appended in place. Rebuilding the array per finding is quadratic in one rule's matches, which
  // an ordinary pattern reaches on a generated or minified file: 62k matches took 5.9 s, and an
  // 8 MB file never finished. Nothing can preempt it either — the work is synchronous (§13).
  //
  // Keyed by block, not rule: findings in swept files print in their own block under their own
  // heading (render-agent.ts), so a rule with findings on both sides is two blocks, priced apart.
  const swept = new Set(delivery.swept ?? [])
  const blockOf = (finding: Finding) => (swept.has(finding.file) ? `${SWEPT_BLOCK}${finding.rule}` : finding.rule)
  const ruleOf = (block: string) => (block.startsWith(SWEPT_BLOCK) ? block.slice(SWEPT_BLOCK.length) : block)
  // The agent's own blocks first: the floor fills in this order, and a swept block, which never
  // blocks, must not take the room a blocking one needs.
  const byRule = new Map<string, Finding[]>()
  const ordered = [
    ...delivery.findings.filter((finding) => !swept.has(finding.file)),
    ...delivery.findings.filter((finding) => swept.has(finding.file)),
  ]
  for (const finding of ordered) {
    const group = byRule.get(blockOf(finding))
    if (group === undefined) byRule.set(blockOf(finding), [finding])
    else group.push(finding)
  }

  // Every price below comes from the renderer (deliveryCost), so the budget spends what it prints.
  // An adapter's own wrapping is not in it: the adapter keeps slack for that (claude-code: 9,000 of
  // a 10,000 character limit).
  const conventions = delivery.references.length > 0 || delivery.preexistingSummary.length > 0
  const headerCost = (conventionsTitle: boolean) =>
    deliveryCost.header(
      byRule.size,
      new Set(delivery.findings.map((finding) => finding.file)),
      conventionsTitle,
      delivery.via,
    )
  // The title is charged at the longer of its two forms: the floor might cut every rule, and then
  // the conventions title prints. Once it keeps one, the rest of that charge is room.
  const titleSlack = headerCost(conventions) - headerCost(false)
  let used =
    headerCost(conventions) +
    (delivery.references.length > 0 ? deliveryCost.referencesEnd : 0) +
    (swept.size > 0 ? deliveryCost.sweptFrame : 0) +
    // Never cut: what to undo is the one thing the agent must not miss.
    (delivery.refused ?? []).reduce((sum, refused) => sum + deliveryCost.refused(refused), 0)
  const fits = (size: number) => limit === null || used + size <= limit
  const kept = new Map<string, Finding[]>()
  // A reference costs its line whatever its state: one whose content does not fit is not dropped,
  // it is demoted to "read this", which the renderer still prints. The line is charged with the rule
  // that cites it, because the two are one floor item — a finding without its section explains
  // nothing, and a section for a finding the agent cannot see explains nothing either.
  // Keyed by what the delivery calls a reference, which is not its spec's `ref` for a project
  // reference shown from elsewhere (Assembled.refLabels).
  const shown = (ref: string) => assembled.refLabels.get(ref) ?? ref
  const citedBy = (rule: CompiledRule) => assembled.ruleRefs.get(rule.id) ?? []
  const specs = new Map<string, ReferenceSpec>()
  for (const rule of [...rulesById.values(), ...touches])
    for (const spec of citedBy(rule)) specs.set(shown(spec.ref), spec)
  const pointers = new Set(delivery.references.filter((one) => one.state === "pointer").map((one) => one.ref))
  const lineCost = (ref: string) => {
    if (pointers.has(ref)) return deliveryCost.pointerLine(ref)
    const spec = specs.get(ref)
    return deliveryCost.referenceLine(ref, spec === undefined ? undefined : locationOf(spec).location)
  }
  const resolvedRefs = new Set(delivery.references.map((reference) => reference.ref))
  const charged = new Set<string>()
  const orphaned = new Set<string>()
  // A `context_by_rule` section explains one lint rule's findings, so it is charged with the first of
  // them the delivery shows, not with the rule as a whole: at the floor that is the block's first
  // finding, and the rest come with the repeats that bring them.
  const sectionsOf = (finding: Finding) => (assembled.findingSections.get(finding) ?? []).map((spec) => shown(spec.ref))

  /** One pass at the floor. Returns what it spent, what it kept, and what it had no room for. */
  const floorWithin = (cap: number) => {
    const spent = { chars: 0, kept: new Map<string, Finding[]>(), refs: new Set<string>(), dropped: new Set<string>() }
    const uncharged = (refs: readonly string[]) => [
      ...new Set(refs.filter((ref) => resolvedRefs.has(ref) && !spent.refs.has(ref))),
    ]
    const ownRefs = (rule: CompiledRule) => rule.context.map((spec) => shown(spec.ref))
    // Touch rules first, and never dropped: their reference is the whole delivery, and the session
    // has already recorded the rule as touched, so a dropped one would never be delivered again.
    // Charged before the rule blocks, so a block is only kept when it fits beside them.
    for (const touch of touches) {
      for (const ref of uncharged(ownRefs(touch))) {
        spent.chars += lineCost(ref)
        spent.refs.add(ref)
      }
    }
    for (const [id, findings] of byRule) {
      const rule = rulesById.get(ruleOf(id))
      const refs = rule === undefined ? [] : uncharged([...ownRefs(rule), ...sectionsOf(findings[0]!)])
      const size =
        measureRuleBlock(ruleOf(id), [findings[0]!], findings, delivery.templates[ruleOf(id)], render) +
        refs.reduce((sum, ref) => sum + lineCost(ref), 0)
      // Kept, the block takes the rule title's form, so the slack is room for it.
      if (used - titleSlack + spent.chars + size > cap) {
        spent.dropped.add(id)
        continue
      }
      spent.chars += size
      for (const ref of refs) spent.refs.add(ref)
      spent.kept.set(id, [findings[0]!])
    }
    return spent
  }

  let droppedBlocks = 0
  if (limit !== null) {
    // Twice when the first pass overflows: the lines naming the overflow file are part of the floor
    // too, and only the first pass can say whether there will be any.
    let floor = floorWithin(limit)
    // Priced for every rule being cut, the longest the count can be.
    const notice = deliveryCost.overflowNotice(byRule.size)
    if (floor.dropped.size > 0) floor = floorWithin(limit - notice)
    used += floor.chars + (floor.dropped.size > 0 ? notice : 0)
    if (floor.kept.size > 0) used -= titleSlack
    // Rules, not blocks: a rule whose own block was kept and whose swept block was cut is still shown.
    const keptRules = new Set([...floor.kept.keys()].map(ruleOf))
    droppedBlocks = floor.dropped.size
    delivery.omitted.rules = new Set([...floor.dropped].map(ruleOf).filter((rule) => !keptRules.has(rule))).size
    for (const [id, findings] of floor.kept) kept.set(id, findings)
    for (const ref of floor.refs) charged.add(ref)
    // What is left is cited only by rules that were dropped, or by lint rules whose findings the floor
    // did not show: it explains nothing the agent can see, unless a repeat below brings its finding.
    for (const ref of resolvedRefs) if (!charged.has(ref)) orphaned.add(ref)
  }

  // Warnings, into what the floor left and no more than their share of it. They come before the doc
  // sections and the repeats — a rule that is broken is worth saying early — but after every rule
  // that fired, so no number of them can cost the agent a finding it could act on.
  const warningCost = (text: string) => deliveryCost.warning(text)
  if (limit === null) {
    for (const warning of unwarned) context.push({ t: "warned", key: warning.key })
  } else {
    const ceiling = Math.max(0, Math.min(Math.floor(limit * WARNING_SHARE), limit - used))
    let spent = unwarned.length > 0 ? deliveryCost.warningsFrame : 0
    let held = 0
    while (held < unwarned.length && spent + warningCost(unwarned[held]!.text) <= ceiling) {
      spent += warningCost(unwarned[held]!.text)
      held++
    }
    // The line standing in for the rest costs what a warning does, and the warnings it replaces pay
    // for it: dropping one raises the count it carries, which is why this is a loop.
    if (held < unwarned.length) {
      while (held > 0 && spent + warningCost(moreWarnings(unwarned.slice(held))) > ceiling) {
        held--
        spent -= warningCost(unwarned[held]!.text)
      }
    }
    delivery.warnings = unwarned.slice(0, held).map((warning) => warning.text)
    for (const warning of unwarned.slice(0, held)) context.push({ t: "warned", key: warning.key })
    const cut = unwarned.slice(held)
    if (cut.length > 0 && spent + warningCost(moreWarnings(cut)) <= ceiling) {
      spent += warningCost(moreWarnings(cut))
      delivery.warnings.push(moreWarnings(cut))
      // The line standing for the cut ones said where to see them: said once, not at every stop.
      // When even it did not fit, nothing was said of them, and they wait for a later stop.
      for (const warning of cut) context.push({ t: "warned", key: warning.key })
    }
    // Nothing printed, so the heading never prints either.
    used += delivery.warnings.length > 0 ? spent : 0
  }

  // A reference whose text one sent in full already includes is left out, and a container sent
  // replaces every part of it: those sent before it give back their content, and every part gives
  // back its line, whether it came before the container or would come after. Each text is printed
  // once (#69). Positions in `candidates`; the references go at the end, so indices stay valid.
  const sentSize = new Map<number, number>()
  const retracted = new Set<number>()
  // Named for the budget: tried again when room is freed (retryNamed).
  const named = new Set<number>()
  const refOf = (position: number) => shown(candidates[position]!.resolved.spec.ref)
  // Its line was charged at the floor, or with the repeat that brought it, and is not printed now.
  // An orphaned part's line was never charged, and it is left out at the end anyway.
  const retract = (position: number) => {
    retracted.add(position)
    named.delete(position)
    used -= lineCost(refOf(position)) + (sentSize.get(position) ?? 0)
    sentSize.delete(position)
  }
  /** Gives a candidate its content when it fits, else names it for the agent to read. */
  const send = (position: number) => {
    if (retracted.has(position)) return
    const { index, resolved, contains } = candidates[position]!
    if ([...sentSize.keys()].some((sent) => candidates[sent]!.contains.includes(position))) {
      retract(position)
      return
    }
    // Its line is already paid for; this is what printing it in full adds.
    const ref = refOf(position)
    const size = deliveryCost.referenceContent(ref, resolved.content, locationOf(resolved.spec).location)
    const parts = contains.filter((part) => !retracted.has(part) && !orphaned.has(refOf(part)))
    const refund = parts.reduce((sum, part) => sum + lineCost(refOf(part)) + (sentSize.get(part) ?? 0), 0)
    if (!fits(size - refund)) {
      delivery.references[index] = {
        ref,
        state: "read",
        reason: "budget",
        ...locationOf(resolved.spec),
      } satisfies DeliveredReference
      named.add(position)
      return
    }
    used += size
    for (const part of parts) retract(part)
    if (named.delete(position)) delivery.references[index] = assembled.delivery.references[index]!
    sentSize.set(position, size)
    context.push({ t: "delivered", path: resolved.spec.path, anchor: resolved.spec.anchor, hash: resolved.hash })
  }
  // A part given back, or a section that costs less sent than named, frees room after the
  // candidates before it were named: they are tried again, in order, until none more fits.
  const retryNamed = () => {
    for (let freed = true; freed; ) {
      freed = false
      for (const position of [...named].sort((a, b) => a - b)) {
        send(position)
        if (!named.has(position)) freed = true
      }
    }
  }
  for (const position of candidates.keys()) if (!orphaned.has(refOf(position))) send(position)
  retryNamed()

  // The heading and the "see all of it" line print whenever anything in this block does — including
  // when every summary was cut and only the count remains — so they are charged once, up front. A
  // renderer's line that nobody charged for is how a delivery at the budget's edge overflows.
  //
  // When even that frame does not fit, the block is not printed at all. A heading and "…and 7 more"
  // with nothing under them cost an agent at the budget's edge over a hundred characters to say
  // nothing, and these summaries are the lowest priority there is. Nothing is recorded, so they are
  // offered again on a later event.
  const frame =
    delivery.preexistingSummary.length > 0 ? deliveryCost.backlogFrame(delivery.preexistingSummary.length) : 0
  if (frame > 0 && !fits(frame)) delivery.preexistingSummary = []
  else used += frame
  const summariesKept: Delivery["preexistingSummary"] = []
  for (const summary of delivery.preexistingSummary) {
    if (!fits(deliveryCost.backlogSummary(summary))) {
      delivery.omitted.preexisting++
      continue
    }
    used += deliveryCost.backlogSummary(summary)
    summariesKept.push(summary)
    context.push({ t: "preexisting", rule: summary.rule, file: assembled.summaryFiles.get(summary) ?? summary.file })
  }
  delivery.preexistingSummary = summariesKept

  // A section the floor left out, brought by a repeat that shows its lint rule's finding: its line
  // comes with that finding, and its content when there is still room.
  const positionOf = new Map(candidates.map((_, position) => [refOf(position), position]))
  const bring = (refs: readonly string[]) => {
    for (const ref of refs) {
      orphaned.delete(ref)
      charged.add(ref)
      const position = positionOf.get(ref)
      if (position !== undefined) send(position)
    }
  }

  if (limit !== null) {
    // One match per rule per pass, so a rule that fired forty times does not crowd out the others.
    for (let added = true; added; ) {
      added = false
      for (const [rule, findings] of byRule) {
        const shown = kept.get(rule)
        // The cap here is arithmetic, not formatting. measureRuleBlock renders through ruleBlock,
        // which slices at maxMatchesPerRule, so a block's measured size stops growing past the cap:
        // a finding past it only moves from "cut" to "shown but hidden", and the "…and N more" line
        // counts both. Past that the delta is 0, fits() is always true, and without this bound the
        // loop would pull every finding of every rule into the delivery at no apparent cost.
        if (shown === undefined || shown.length >= Math.min(findings.length, limits.maxMatchesPerRule)) continue
        const template = delivery.templates[ruleOf(rule)]
        const next = findings[shown.length]!
        const brought = [...new Set(sectionsOf(next).filter((ref) => orphaned.has(ref)))]
        const delta =
          measureRuleBlock(ruleOf(rule), [...shown, next], findings, template, render) -
          measureRuleBlock(ruleOf(rule), shown, findings, template, render) +
          brought.reduce((sum, ref) => sum + lineCost(ref), 0)
        if (!fits(delta)) continue
        used += delta
        shown.push(next)
        bring(brought)
        added = true
      }
    }

    for (const [rule, findings] of byRule) {
      const shown = kept.get(rule) ?? []
      // A rule dropped whole is counted by omitted.rules; the renderer never reaches it.
      if (shown.length === 0 || shown.length === findings.length) continue
      const shownFiles = new Set(shown.map((finding) => finding.file))
      const dropped = findings.slice(shown.length)
      const droppedFiles = [...new Set(dropped.map((finding) => finding.file))]
      delivery.omitted.findings.push({
        rule: ruleOf(rule),
        count: dropped.length,
        files: droppedFiles.filter((file) => !shownFiles.has(file)).length,
        inFiles: droppedFiles,
        ...(rule === ruleOf(rule) ? {} : { swept: true }),
      })
    }
    delivery.findings = delivery.findings.filter((finding) => kept.get(blockOf(finding))?.includes(finding) === true)
  }
  if (limit !== null) retryNamed()
  if (orphaned.size > 0 || retracted.size > 0) {
    const left = new Set([...retracted].map((position) => candidates[position]!.index))
    delivery.references = delivery.references.filter((one, index) => !orphaned.has(one.ref) && !left.has(index))
  }

  return { delivery, overflow: droppedBlocks > 0 ? assembled.delivery : null, context }
}

/**
 * How many stops one finding may block in unattended mode. After that it is reported, not blocked:
 * an agent that could not fix it in two tries is not fixing it on a third, and a false positive,
 * which nobody is there to overrule, must not spend the whole budget.
 */
export const REPEAT_LIMIT = 2

/** Match texts that say nothing about the finding: gitleaks' redaction, a hook's whole-file finding. */
const OPAQUE_TEXTS = new Set(["", "[redacted]"])

/**
 * What makes two stops' findings the same finding: rule, file and the matched text. Not the line,
 * which any edit above it moves; not the message, which usually carries the line.
 *
 * Unless the text is one that every finding of the tool shares: then two secrets in one file would
 * be one finding, and the second would never block. There the tool's own rule id and message, and
 * the line, tell them apart, at the cost of a moved finding counting as a new one.
 *
 * Captures the match marks volatile (`Match.volatileCaptures`: a removed finding's counts) are never
 * part of the key. A removed finding's text is the constant `removed`, so one more assertion
 * deleted is the same finding, and the repeat limit applies to it. Anything else that identifies a
 * finding, such as a finding id hashing its captures, must leave them out the same way.
 */
export function findingKey({ rule, match }: ClassifiedFinding): string {
  const text = match.text.trim()
  const parts = [rule.id, match.file, text]
  const stable = (name: string) => (match.volatileCaptures?.includes(name) ? "" : (match.captures[name] ?? ""))
  if (OPAQUE_TEXTS.has(text)) {
    parts.push(stable("ruleId"), stable("message"), String(match.line))
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16)
}

/**
 * The stop gate: block / allow / capReached, and in unattended mode report.
 *
 * It takes what was *found*, and nothing that could carry what survived the budget: a rule the
 * floor could not hold is still an unresolved error, and reading the trimmed list would let the
 * agent stop because its findings did not fit — which is the one thing the gate exists to prevent.
 * That used to be a comment; it is now the signature.
 *
 * Attended, a capped stop is let through and the user is told, and a finding an earlier stop already
 * sent never reaches the gate (`repeats`), a refused one included. Unattended there is no user, and a
 * stop the gate lets through ends the run, so what is left is said to the agent instead, by one more
 * block (`report`) asking it to record the findings as unresolved and finish. A finding that has
 * blocked REPEAT_LIMIT stops no longer counts towards blocking, only towards that report — except a
 * refused one, a protected file changed with the shell, which blocks until it is reverted.
 *
 * Unattended, a stop with nothing to block while configured rules did not run (`incomplete`) holds
 * the main agent once per prompt, so its report says those checks never happened (#29). A block or
 * report earlier in the prompt already said so and counts as that hold; a capped stop is never
 * held. Never a subagent: its report goes to its parent, whose own stop is held for the same reason.
 */
export function gate(
  fresh: readonly ClassifiedFinding[],
  work: WorkState,
  agent: string,
  maxBlocks: number,
  /** Files changed outside the agent's tool calls: the user's edits must never trap the agent. */
  swept: ReadonlySet<string> = new Set(),
  mode: Mode = "attended",
  /** Configured rules did not run this session: the unattended `incomplete` stop. */
  incomplete = false,
): Gated {
  const passed = gateFindings(fresh, work, agent, maxBlocks, swept, mode)
  const holds = mode === "unattended" && incomplete && agent === MAIN_AGENT && !work.incompleteReports.has(agent)
  if (!holds) return passed
  // A block or report carries the list of what did not run (adapters say it beside the findings),
  // so it is this prompt's hold. A capped stop is past every hold: it says what it says, not this.
  if (passed.stop === "block" || passed.stop === "report") {
    return { ...passed, work: [...passed.work, { t: "incompleteReport", agent }] }
  }
  if (passed.stop === "allow") return { stop: "incomplete", work: [{ t: "incompleteReport", agent }] }
  return passed
}

/** A stop's verdict, its records, and at a block or report the finding keys it rests on. */
type Gated = { stop: Exclude<Delivery["stop"], null>; work: WorkRecord[]; blocking?: string[] }

function gateFindings(
  fresh: readonly ClassifiedFinding[],
  work: WorkState,
  agent: string,
  maxBlocks: number,
  swept: ReadonlySet<string>,
  mode: Mode,
): Gated {
  const blocking = fresh.filter(({ match }) => !swept.has(match.file))
  // A protected file changed with the shell could not be refused before the write, so it blocks
  // whatever the rule's severity: unattended until it is reverted, attended once (`repeats`), since
  // the user may have asked for the change.
  const refused = ({ rule, match }: ClassifiedFinding) => rule.refuseWrite && work.editedVia.get(match.file) === "shell"
  const failing = blocking.filter((finding) => finding.rule.severity === "error" || refused(finding))
  if (failing.length === 0) return { stop: "allow", work: [] }
  const blocks = work.stopBlocks.get(agent) ?? 0
  const keys = [...new Set(failing.map(findingKey))]
  if (mode === "attended") {
    if (blocks < maxBlocks) return { stop: "block", work: [{ t: "stopBlock", agent }], blocking: keys }
    return { stop: "capReached", work: [] }
  }
  const unrepeated = keys.filter((key) => (work.blockedFindings.get(blockedKey(agent, key)) ?? 0) < REPEAT_LIMIT)
  // A refused write is not a judgement the agent may dispute by repetition: it blocks until it is
  // reverted, bounded only by the budget and the report.
  if ((unrepeated.length > 0 || failing.some(refused)) && blocks < maxBlocks) {
    const blocking = new Set([...unrepeated, ...failing.filter(refused).map(findingKey)])
    return { stop: "block", work: [{ t: "stopBlock", agent, findings: keys }], blocking: [...blocking] }
  }
  // The report holds the agent on every finding left, so each one is blocking it.
  if (!work.stopReports.has(agent)) return { stop: "report", work: [{ t: "stopReport", agent }], blocking: keys }
  return { stop: "capReached", work: [] }
}

/**
 * An attended stop says each finding once (decided with the lead sessions, 2026-11-14). A finding is
 * a repeat when a stop already sent it to this agent (`WorkState.stopSent`) and the file's content is
 * unchanged since. A repeat is named in one line (`Delivery.repeated`) and never blocks: a finding the
 * agent cannot or may not fix would otherwise cost a turn at every prompt. A sent finding is
 * forgotten once its rule runs on its file and does not find it, or its file is deleted or back to
 * its baseline (`sentRecord`), so bringing it back blocks again; one still there after its file
 * changed is sent again, as an edit meant to fix it did not.
 * Unattended keeps its own per-finding limit (`gate`, REPEAT_LIMIT) and its report.
 */
function repeats(input: DecideInput): { findings: ClassifiedFinding[]; repeated: ClassifiedFinding[] } {
  const sent = input.work.stopSent.get(input.agent)
  const hashes = input.fileHashes ?? new Map<string, string>()
  const findings: ClassifiedFinding[] = []
  const repeated: ClassifiedFinding[] = []
  for (const finding of input.findings) {
    const earlier = finding.status === "new" ? sent?.get(findingKey(finding)) : undefined
    const unchanged = earlier !== undefined && hashes.get(finding.match.file) === earlier.hash
    if (unchanged) repeated.push(finding)
    else findings.push(finding)
  }
  return { findings, repeated }
}

/**
 * How this stop changes what stops have sent the agent and still stands: an earlier finding its rule
 * ran on its file and did not find, or in a file that can hold none (`stopCleared`), is dropped; at a block or report what it
 * put before the agent is added, with its file's hash now. Null when nothing changes.
 */
function sentRecord(
  input: DecideInput,
  findings: readonly ClassifiedFinding[],
  sentNow: readonly ClassifiedFinding[],
): WorkRecord | null {
  const earlier = input.work.stopSent.get(input.agent) ?? new Map<string, Sent>()
  const found = new Set(findings.map(findingKey))
  const ran = input.stopRan ?? new Map<string, readonly string[]>()
  const cleared = new Set(input.stopCleared ?? [])
  const drop = [...earlier]
    .filter(([key, { rule, file }]) => cleared.has(file) || (!found.has(key) && ran.get(rule)?.includes(file) === true))
    .map(([key]) => key)
  const add: SentFinding[] = []
  for (const finding of sentNow) {
    const key = findingKey(finding)
    const hash = input.fileHashes?.get(finding.match.file)
    if (hash === undefined || earlier.get(key)?.hash === hash) continue
    add.push([key, finding.rule.id, finding.match.file, hash])
  }
  if (drop.length === 0 && add.length === 0) return null
  return {
    t: "stopSent",
    agent: input.agent,
    ...(add.length === 0 ? {} : { add }),
    ...(drop.length === 0 ? {} : { drop }),
  }
}

/** The most repeats the line names; past that it only counts them. */
const REPEATED_NAMED = 10

/**
 * The most of the budget the repeats line may take. It is rendered with the findings, so the budget
 * keeps this much back for it; a long list is cut to a count rather than crowd the findings out. The
 * count alone ("N findings", about 70 characters) is the floor: under a budget so small it passes
 * the share, it is still kept back, and the delivery still fits.
 */
const REPEATED_SHARE = 0.15

/**
 * The repeats as `Delivery.repeated` and `repeatedMore`: each rule and file once, named while the
 * line stays inside its share of the budget, and the findings of the rest counted.
 */
function repeatedOf(
  repeated: readonly ClassifiedFinding[],
  display: (file: string) => string,
  maxContextChars: number | null,
): Pick<Delivery, "repeated" | "repeatedMore"> {
  const seen = new Map<string, { rule: string; file: string; count: number }>()
  for (const { rule, match } of repeated) {
    const key = `${rule.id}\n${match.file}`
    const pair = seen.get(key)
    if (pair === undefined) seen.set(key, { rule: rule.id, file: display(match.file), count: 1 })
    else pair.count++
  }
  const all = [...seen.values()].sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file))
  // The findings in the pairs past the first `named`.
  const rest = (named: number) => all.slice(named).reduce((sum, pair) => sum + pair.count, 0)
  const pairs = (named: number) => all.slice(0, named).map(({ rule, file }) => ({ rule, file }))
  const room = maxContextChars === null ? Number.POSITIVE_INFINITY : Math.floor(maxContextChars * REPEATED_SHARE)
  let named = 0
  while (named < Math.min(all.length, REPEATED_NAMED)) {
    const line = repeatedListLine({ repeated: pairs(named + 1), repeatedMore: rest(named + 1) })
    if (line === null || line.length > room) break
    named++
  }
  return { repeated: pairs(named), ...(named < all.length ? { repeatedMore: rest(named) } : {}) }
}

/** Whether this decision tells repeats apart: an attended stop (`repeats`). */
function saysOnce(input: DecideInput): boolean {
  return input.stopGate && (input.mode ?? "attended") === "attended"
}

/** The input with the repeats taken out of its findings, as `decide` judges it: what `delivers` should be asked about. */
export function withoutRepeats(input: DecideInput): DecideInput {
  return saysOnce(input) ? { ...input, findings: repeats(input).findings } : input
}

/**
 * What this stop says of its repeats (#90), and what to record as said. The whole set is listed when
 * it has a finding the last stop did not say; otherwise it is a count, which only a block says.
 * A finding said before is fixed when this stop forgets it as sent (`sentRecord`): its rule ran on
 * its file and did not find it, or the file can hold none. That is said once. One whose rule did not
 * run here (a timeout, a file budget) is neither fixed nor forgotten: it stays said.
 */
function saidOf(
  input: DecideInput,
  split: { findings: ClassifiedFinding[]; repeated: ClassifiedFinding[] },
): { delivery: Partial<Delivery>; record: WorkRecord | null } {
  const before = input.work.repeatsSaid.get(input.agent) ?? new Set<string>()
  const now = new Set(split.repeated.map(findingKey))
  const found = new Set([...now, ...split.findings.map(findingKey)])
  const sent = input.work.stopSent.get(input.agent)
  const ran = input.stopRan ?? new Map<string, readonly string[]>()
  const cleared = new Set(input.stopCleared ?? [])
  const fixedKey = (key: string) => {
    if (found.has(key)) return false
    const entry = sent?.get(key)
    // Forgotten as sent at an earlier stop: not there since.
    if (entry === undefined) return true
    return cleared.has(entry.file) || ran.get(entry.rule)?.includes(entry.file) === true
  }
  const delivery: Partial<Delivery> = {}
  if ([...now].some((key) => !before.has(key))) {
    const named = repeatedOf(split.repeated, input.display ?? ((file) => file), input.maxContextChars)
    if (named.repeated !== undefined && named.repeated.length > 0) delivery.repeated = named.repeated
    if (named.repeatedMore !== undefined) delivery.repeatedMore = named.repeatedMore
  } else if (now.size > 0) {
    const rules = [...new Set(split.repeated.map(({ rule }) => rule.id))].sort()
    delivery.repeatedCount = { count: now.size, rules }
  }
  const fixed = [...before].filter(fixedKey)
  if (fixed.length > 0) delivery.repeatedFixed = { fixed: fixed.length, of: before.size }
  const gone = new Set(fixed)
  const after = new Set([...[...before].filter((key) => !gone.has(key)), ...now])
  const same = after.size === before.size && [...after].every((key) => before.has(key))
  return { delivery, record: same ? null : { t: "repeatsSaid", agent: input.agent, keys: [...after] } }
}

/** Assemble, trim, and — on a stop — gate. */
export async function decide(input: DecideInput): Promise<Decision> {
  const split = saysOnce(input) ? repeats(input) : null
  if (split === null) {
    const { sent: _, ...decided } = await decideFindings(input)
    return decided
  }
  const said = saidOf(input, split)
  // The line, and the blank line before it, come out of the budget the rest is trimmed to.
  const line = repeatedLine(said.delivery)
  const reserve = line === null ? 0 : line.length + 2
  const maxContextChars = input.maxContextChars === null ? null : Math.max(0, input.maxContextChars - reserve)
  const { sent, ...decided } = await decideFindings({ ...input, findings: split.findings, maxContextChars })
  Object.assign(decided.delivery, said.delivery)
  // The count is for the agent at a block; a stop that lets it go, or is capped, says it to nobody.
  if (decided.delivery.stop !== "block" && decided.delivery.stop !== "report") delete decided.delivery.repeatedCount
  if (said.record !== null) decided.work = [...decided.work, said.record]
  // Only a block or a report puts the findings before the agent (see the returns of decideFindings).
  const delivered = decided.delivery.stop === "block" || decided.delivery.stop === "report"
  const record = sentRecord(input, input.findings, delivered ? sent : [])
  // Only additions: whatever this stop forgets is in `record` already.
  const ifShown = delivered ? null : sentRecord({ ...input, stopRan: new Map(), stopCleared: [] }, input.findings, sent)
  return {
    ...decided,
    ...(record === null ? {} : { work: [...decided.work, record] }),
    ...(ifShown === null ? {} : { ifShown }),
  }
}

async function decideFindings(input: DecideInput): Promise<Decision & { sent: ClassifiedFinding[] }> {
  const assembled = await assemble(input)
  const trimmed = trim(assembled, {
    maxContextChars: input.maxContextChars,
    maxMatchesPerRule: input.maxMatchesPerRule,
  })
  const context = [...assembled.context, ...trimmed.context]
  // After the budget, like the notices: what did not run is never cut to make room for what did.
  const disabled = input.disabled ?? []
  if (disabled.length > 0) trimmed.delivery.disabled = disabled
  // What the agent is shown: the findings of each kept, after the budget cut whole rules and matches
  // past a rule's cap. A cut one is not sent, so a later stop sends it.
  const shown = new Set(trimmed.delivery.findings)
  const sent = assembled.fresh.filter((finding) => {
    const rendered = assembled.rendered.get(finding)
    return rendered !== undefined && shown.has(rendered)
  })
  if (!input.stopGate) return { delivery: trimmed.delivery, overflow: trimmed.overflow, work: [], context, sent }

  const mode = input.mode ?? "attended"
  const gated = gate(
    assembled.fresh,
    input.work,
    input.agent,
    input.maxBlocks,
    new Set(input.swept ?? []),
    mode,
    disabled.length > 0,
  )
  const delivery: Delivery = {
    ...trimmed.delivery,
    stop: gated.stop,
    ...(mode === "unattended" ? { unattended: true as const } : {}),
  }
  // Warnings go to the user at every stop, whatever the gate decides (adapters print them as a
  // system message), so they are recorded as said at every stop: once said, not again (#90).
  const warned = context.filter((record) => record.t === "warned")
  // An incomplete stop carries no findings: none of the delivery is context the agent was given.
  if (gated.stop === "incomplete") return { delivery, overflow: null, work: gated.work, context: warned, sent }
  // Only a block or a report reaches the agent as context; anything else must not count as
  // delivered. A capReached still prints its delivery as a system message, so it keeps the overflow
  // file — the message says rules did not fit, and the file is where they went.
  if (gated.stop === "allow") return { delivery, overflow: null, work: gated.work, context: warned, sent }
  if (gated.stop === "capReached") {
    return { delivery, overflow: trimmed.overflow, work: gated.work, context: warned, sent }
  }
  return {
    delivery,
    overflow: trimmed.overflow,
    work: gated.work,
    context,
    sent,
    ...(gated.blocking === undefined ? {} : { blocking: new Set(gated.blocking) }),
  }
}
