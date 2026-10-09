import path from "node:path"

import type { CompiledRule } from "../compile/rule"
import { deliveryCost, measureRuleBlock } from "../delivery/render-agent"
import type { ReferenceResolver, ResolvedRef } from "../delivery/resolve"
import type { ReferenceSpec } from "../references"
import { renderTemplate, templateBindings } from "../template"
import { type DeliveredReference, type Delivery, emptyDelivery, type Finding, type Match } from "../types"
import {
  type ContextRecord,
  type ContextState,
  emptyContext,
  preexistingKey,
  type WorkRecord,
  type WorkState,
} from "./state"

export interface ClassifiedFinding {
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
  /** verify from a stop: decide block / allow / capReached. */
  stopGate: boolean
}

export interface Decision {
  delivery: Delivery
  /** The delivery as it stood before the budget cut whole rules out of it; null when it cut none. */
  overflow: Delivery | null
  work: WorkRecord[]
  context: ContextRecord[]
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

/** What replaces the warnings the share could not hold. */
const moreWarnings = (count: number) => `…and ${count} more (run rulecast validate)`

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

function renderFindings(findings: ClassifiedFinding[]): Finding[] {
  const merged = new Map<string, Finding>()
  for (const { rule, match } of findings) {
    const message = renderTemplate(rule.message ?? "", {
      ...match.captures,
      file: match.file,
      line: String(match.line),
      column: String(match.column),
      text: match.text,
      rule: rule.id,
    })
    const key = `${rule.id} ${match.file} ${message}`
    const existing = merged.get(key)
    if (existing) existing.count++
    else
      merged.set(key, {
        rule: rule.id,
        severity: rule.severity,
        status: "new",
        file: match.file,
        line: match.line,
        column: match.column,
        message,
        count: 1,
        captures: capturesFor(rule, match),
      })
  }
  return [...merged.values()].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  )
}

function referencesInOrder(rules: CompiledRule[]): ReferenceSpec[] {
  const seen = new Set<string>()
  const specs: ReferenceSpec[] = []
  for (const rule of rules) {
    for (const spec of rule.context) {
      if (seen.has(spec.ref)) continue
      seen.add(spec.ref)
      specs.push(spec)
    }
  }
  return specs
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
  /** References given full content, by their index in `delivery.references`. */
  candidates: { index: number; resolved: Extract<ResolvedRef, { found: true }> }[]
  /** Findings with status "new", in input order. */
  fresh: ClassifiedFinding[]
  /** Warnings not yet given in this context; `delivery.warnings` holds their texts. */
  unwarned: { key: string; text: string }[]
  touches: CompiledRule[]
  /** What assembling decided to record: touched rules, and a complete read as delivered. */
  context: ContextRecord[]
}

export async function assemble(input: AssembleInput): Promise<Assembled> {
  const delivery = emptyDelivery()
  const context: ContextRecord[] = []
  const touches = input.touches ?? []
  const state = input.context ?? emptyContext()

  // Findings and pre-existing summaries.
  const fresh = input.findings.filter((finding) => finding.status === "new")
  delivery.findings = renderFindings(fresh)
  for (const { rule } of fresh) if (rule.message !== null) delivery.templates[rule.id] = rule.message
  const summaries = new Map<string, { rule: string; file: string; count: number }>()
  for (const { rule, match, status } of input.findings) {
    if (status !== "preexisting") continue
    const key = preexistingKey(rule.id, match.file)
    if (state.preexisting.has(key)) continue
    const summary = summaries.get(key) ?? { rule: rule.id, file: match.file, count: 0 }
    summary.count++
    summaries.set(key, summary)
  }
  delivery.preexistingSummary = [...summaries.values()]

  // Warnings, once per context. Which of them are kept — and so which are recorded as warned — is
  // decided by the budget, after the floor.
  const unwarned = (input.warnings ?? []).filter((warning) => !state.warned.has(warning.key))
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

  // References.
  const ruleOrder = [...new Map(fresh.map((finding) => [finding.rule.id, finding.rule])).values(), ...touches]
  const candidates: Assembled["candidates"] = []
  for (const spec of referencesInOrder(ruleOrder)) {
    const resolved = await input.resolver.resolve(spec)
    if (!resolved.found) {
      delivery.references.push({ ref: spec.ref, state: "missing" })
    } else if (await isCovered(spec, delivered, input.resolver)) {
      delivery.references.push({ ref: spec.ref, state: "pointer" })
    } else if (spec.mode === "read") {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "mode", ...locationOf(spec) })
    } else if (resolved.bytes > input.maxBytes) {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "tooLarge", ...locationOf(spec) })
    } else {
      candidates.push({ index: delivery.references.length, resolved })
      delivery.references.push({ ref: spec.ref, state: "full", content: resolved.content })
    }
  }

  return { delivery, candidates, fresh, unwarned, touches, context }
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
  const byRule = new Map<string, Finding[]>()
  for (const finding of delivery.findings) {
    const group = byRule.get(finding.rule)
    if (group === undefined) byRule.set(finding.rule, [finding])
    else group.push(finding)
  }

  // Every price below comes from the renderer (deliveryCost), so the budget spends what it prints.
  // An adapter's own wrapping is not in it: the adapter keeps slack for that (claude-code: 9,000 of
  // a 10,000 character limit).
  const conventions = delivery.references.length > 0 || delivery.preexistingSummary.length > 0
  let used =
    deliveryCost.header(byRule.size, new Set(delivery.findings.map((finding) => finding.file)), conventions) +
    (delivery.references.length > 0 ? deliveryCost.referencesEnd : 0)
  const fits = (size: number) => limit === null || used + size <= limit
  const kept = new Map<string, Finding[]>()
  // A reference costs its line whatever its state: one whose content does not fit is not dropped,
  // it is demoted to "read this", which the renderer still prints. The line is charged with the rule
  // that cites it, because the two are one floor item — a finding without its section explains
  // nothing, and a section for a finding the agent cannot see explains nothing either.
  const specs = new Map<string, ReferenceSpec>()
  for (const rule of [...rulesById.values(), ...touches]) for (const spec of rule.context) specs.set(spec.ref, spec)
  const lineCost = (ref: string) => {
    const spec = specs.get(ref)
    return deliveryCost.referenceLine(ref, spec === undefined ? undefined : locationOf(spec).location)
  }
  const resolvedRefs = new Set(delivery.references.map((reference) => reference.ref))
  const charged = new Set<string>()
  const orphaned = new Set<string>()

  /** One pass at the floor. Returns what it spent, what it kept, and what it had no room for. */
  const floorWithin = (cap: number) => {
    const spent = { chars: 0, kept: new Map<string, Finding[]>(), refs: new Set<string>(), dropped: 0 }
    const uncharged = (rule: CompiledRule) => [
      ...new Set(rule.context.map((spec) => spec.ref).filter((ref) => resolvedRefs.has(ref) && !spent.refs.has(ref))),
    ]
    for (const [id, findings] of byRule) {
      const rule = rulesById.get(id)
      const refs = rule === undefined ? [] : uncharged(rule)
      const size =
        measureRuleBlock(id, [findings[0]!], findings, delivery.templates[id], render) +
        refs.reduce((sum, ref) => sum + lineCost(ref), 0)
      if (used + spent.chars + size > cap) {
        spent.dropped++
        continue
      }
      spent.chars += size
      for (const ref of refs) spent.refs.add(ref)
      spent.kept.set(id, [findings[0]!])
    }
    // Touch rules are never dropped: their reference is the whole delivery, and the session has
    // already recorded the rule as touched, so a dropped one would never be delivered again.
    for (const touch of touches) {
      for (const ref of uncharged(touch)) {
        spent.chars += lineCost(ref)
        spent.refs.add(ref)
      }
    }
    return spent
  }

  if (limit !== null) {
    // Twice when the first pass overflows: the lines naming the overflow file are part of the floor
    // too, and only the first pass can say whether there will be any.
    let floor = floorWithin(limit)
    // Priced for every rule being cut, the longest the count can be.
    const notice = deliveryCost.overflowNotice(byRule.size)
    if (floor.dropped > 0) floor = floorWithin(limit - notice)
    used += floor.chars + (floor.dropped > 0 ? notice : 0)
    delivery.omitted.rules = floor.dropped
    for (const [id, findings] of floor.kept) kept.set(id, findings)
    for (const ref of floor.refs) charged.add(ref)
    // What is left is cited only by rules that were dropped, and explains nothing the agent can see.
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
      while (held > 0 && spent + warningCost(moreWarnings(unwarned.length - held)) > ceiling) {
        held--
        spent -= warningCost(unwarned[held]!.text)
      }
    }
    delivery.warnings = unwarned.slice(0, held).map((warning) => warning.text)
    for (const warning of unwarned.slice(0, held)) context.push({ t: "warned", key: warning.key })
    const cut = unwarned.length - held
    if (cut > 0 && spent + warningCost(moreWarnings(cut)) <= ceiling) {
      spent += warningCost(moreWarnings(cut))
      delivery.warnings.push(moreWarnings(cut))
    }
    // Nothing printed, so the heading never prints either.
    used += delivery.warnings.length > 0 ? spent : 0
  }

  for (const { index, resolved } of candidates) {
    // Its line is already paid for at the floor; this is what printing it in full adds.
    const size = deliveryCost.referenceContent(resolved.spec.ref, resolved.content, locationOf(resolved.spec).location)
    if (orphaned.has(resolved.spec.ref)) continue
    if (!fits(size)) {
      delivery.references[index] = {
        ref: resolved.spec.ref,
        state: "read",
        reason: "budget",
        ...locationOf(resolved.spec),
      } satisfies DeliveredReference
      continue
    }
    used += size
    context.push({ t: "delivered", path: resolved.spec.path, anchor: resolved.spec.anchor, hash: resolved.hash })
  }

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
    context.push({ t: "preexisting", rule: summary.rule, file: summary.file })
  }
  delivery.preexistingSummary = summariesKept
  if (orphaned.size > 0) delivery.references = delivery.references.filter((one) => !orphaned.has(one.ref))

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
        const template = delivery.templates[rule]
        const delta =
          measureRuleBlock(rule, [...shown, findings[shown.length]!], findings, template, render) -
          measureRuleBlock(rule, shown, findings, template, render)
        if (!fits(delta)) continue
        used += delta
        shown.push(findings[shown.length]!)
        added = true
      }
    }

    for (const [rule, findings] of byRule) {
      const shown = kept.get(rule) ?? []
      // A rule dropped whole is counted by omitted.rules; the renderer never reaches it.
      if (shown.length === 0 || shown.length === findings.length) continue
      const shownFiles = new Set(shown.map((finding) => finding.file))
      const dropped = findings.slice(shown.length)
      delivery.omitted.findings.push({
        rule,
        count: dropped.length,
        files: new Set(dropped.map((finding) => finding.file).filter((file) => !shownFiles.has(file))).size,
      })
    }
    delivery.findings = delivery.findings.filter((finding) => kept.get(finding.rule)?.includes(finding) === true)
  }

  return { delivery, overflow: delivery.omitted.rules > 0 ? assembled.delivery : null, context }
}

/**
 * The stop gate: block / allow / capReached.
 *
 * It takes what was *found*, and nothing that could carry what survived the budget: a rule the
 * floor could not hold is still an unresolved error, and reading the trimmed list would let the
 * agent stop because its findings did not fit — which is the one thing the gate exists to prevent.
 * That used to be a comment; it is now the signature.
 */
export function gate(
  fresh: readonly ClassifiedFinding[],
  work: WorkState,
  agent: string,
  maxBlocks: number,
): { stop: Exclude<Delivery["stop"], null>; work: WorkRecord[] } {
  if (!fresh.some(({ rule }) => rule.severity === "error")) return { stop: "allow", work: [] }
  if ((work.stopBlocks.get(agent) ?? 0) < maxBlocks) return { stop: "block", work: [{ t: "stopBlock", agent }] }
  return { stop: "capReached", work: [] }
}

/** Assemble, trim, and — on a stop — gate. */
export async function decide(input: DecideInput): Promise<Decision> {
  const assembled = await assemble(input)
  const trimmed = trim(assembled, {
    maxContextChars: input.maxContextChars,
    maxMatchesPerRule: input.maxMatchesPerRule,
  })
  const context = [...assembled.context, ...trimmed.context]
  if (!input.stopGate) return { delivery: trimmed.delivery, overflow: trimmed.overflow, work: [], context }

  const gated = gate(assembled.fresh, input.work, input.agent, input.maxBlocks)
  const delivery = { ...trimmed.delivery, stop: gated.stop }
  // Only a block reaches the agent as context; anything else must not count as delivered. A
  // capReached still prints its delivery as a system message, so it keeps the overflow file — the
  // message says rules did not fit, and the file is where they went.
  if (gated.stop === "allow") return { delivery, overflow: null, work: gated.work, context: [] }
  if (gated.stop === "capReached") return { delivery, overflow: trimmed.overflow, work: gated.work, context: [] }
  return { delivery, overflow: trimmed.overflow, work: gated.work, context }
}
