import { createHash } from "node:crypto"
import path from "node:path"

import type { CompiledRule } from "../compile/rule"
import type { Mode } from "../config/schema"
import { deliveryCost, measureRuleBlock, SWEPT_BLOCK } from "../delivery/render-agent"
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

function renderFindings(findings: ClassifiedFinding[], status: Finding["status"]): Finding[] {
  const merged = new Map<string, Finding>()
  for (const { id, rule, match } of findings) {
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
    const site = { line: match.line, endLine: match.endLine, column: match.column }
    if (existing === undefined) {
      merged.set(key, {
        id,
        rule: rule.id,
        severity: rule.severity,
        status,
        file: match.file,
        ...site,
        message,
        count: 1,
        captures: capturesFor(rule, match),
        // Only when true, so a document from a project with no fixes is unchanged (output.md).
        ...(rule.fixable ? { fixable: true as const } : {}),
      })
      continue
    }
    existing.count++
    // The earliest match is the one shown, and its id the merged finding's: a tool's emit order
    // must not decide either.
    if (match.line < existing.line || (match.line === existing.line && match.column < existing.column)) {
      Object.assign(existing, { id, ...site, captures: capturesFor(rule, match) })
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
  if (input.via !== undefined) delivery.via = input.via
  const context: ContextRecord[] = []
  const touches = input.touches ?? []
  const state = input.context ?? emptyContext()

  // Findings and pre-existing summaries.
  const fresh = input.findings.filter((finding) => finding.status === "new")
  delivery.findings = renderFindings(fresh, "new")
  if (input.listPreexisting === true) {
    delivery.preexisting = renderFindings(
      input.findings.filter((finding) => finding.status === "preexisting"),
      "preexisting",
    )
  }
  const swept = new Set(input.swept ?? [])
  const sweptWithFindings = [...new Set(fresh.map(({ match }) => match.file))].filter((file) => swept.has(file))
  if (sweptWithFindings.length > 0) delivery.swept = sweptWithFindings.sort()
  if ((input.refused ?? []).length > 0) delivery.refused = [...(input.refused ?? [])]
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
  let used =
    deliveryCost.header(
      byRule.size,
      new Set(delivery.findings.map((finding) => finding.file)),
      conventions,
      delivery.via,
    ) +
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
    const spent = { chars: 0, kept: new Map<string, Finding[]>(), refs: new Set<string>(), dropped: new Set<string>() }
    const uncharged = (rule: CompiledRule) => [
      ...new Set(rule.context.map((spec) => spec.ref).filter((ref) => resolvedRefs.has(ref) && !spent.refs.has(ref))),
    ]
    for (const [id, findings] of byRule) {
      const rule = rulesById.get(ruleOf(id))
      const refs = rule === undefined ? [] : uncharged(rule)
      const size =
        measureRuleBlock(ruleOf(id), [findings[0]!], findings, delivery.templates[ruleOf(id)], render) +
        refs.reduce((sum, ref) => sum + lineCost(ref), 0)
      if (used + spent.chars + size > cap) {
        spent.dropped.add(id)
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

  let droppedBlocks = 0
  if (limit !== null) {
    // Twice when the first pass overflows: the lines naming the overflow file are part of the floor
    // too, and only the first pass can say whether there will be any.
    let floor = floorWithin(limit)
    // Priced for every rule being cut, the longest the count can be.
    const notice = deliveryCost.overflowNotice(byRule.size)
    if (floor.dropped.size > 0) floor = floorWithin(limit - notice)
    used += floor.chars + (floor.dropped.size > 0 ? notice : 0)
    // Rules, not blocks: a rule whose own block was kept and whose swept block was cut is still shown.
    const keptRules = new Set([...floor.kept.keys()].map(ruleOf))
    droppedBlocks = floor.dropped.size
    delivery.omitted.rules = new Set([...floor.dropped].map(ruleOf).filter((rule) => !keptRules.has(rule))).size
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
        const template = delivery.templates[ruleOf(rule)]
        const delta =
          measureRuleBlock(ruleOf(rule), [...shown, findings[shown.length]!], findings, template, render) -
          measureRuleBlock(ruleOf(rule), shown, findings, template, render)
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
        rule: ruleOf(rule),
        count: dropped.length,
        files: new Set(dropped.map((finding) => finding.file).filter((file) => !shownFiles.has(file))).size,
        ...(rule === ruleOf(rule) ? {} : { swept: true }),
      })
    }
    delivery.findings = delivery.findings.filter((finding) => kept.get(blockOf(finding))?.includes(finding) === true)
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
 * Attended, a capped stop is let through and the user is told. Unattended there is no user, and a
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
): { stop: Exclude<Delivery["stop"], null>; work: WorkRecord[] } {
  const passed = gateFindings(fresh, work, agent, maxBlocks, swept, mode)
  const holds = mode === "unattended" && incomplete && agent === MAIN_AGENT && !work.incompleteReports.has(agent)
  if (!holds) return passed
  // A block or report carries the list of what did not run (adapters say it beside the findings),
  // so it is this prompt's hold. A capped stop is past every hold: it says what it says, not this.
  if (passed.stop === "block" || passed.stop === "report") {
    return { stop: passed.stop, work: [...passed.work, { t: "incompleteReport", agent }] }
  }
  if (passed.stop === "allow") return { stop: "incomplete", work: [{ t: "incompleteReport", agent }] }
  return passed
}

function gateFindings(
  fresh: readonly ClassifiedFinding[],
  work: WorkState,
  agent: string,
  maxBlocks: number,
  swept: ReadonlySet<string>,
  mode: Mode,
): { stop: Exclude<Delivery["stop"], null>; work: WorkRecord[] } {
  const blocking = fresh.filter(({ match }) => !swept.has(match.file))
  // A protected file changed with the shell could not be refused before the write, so it blocks
  // until it is reverted, whatever the rule's severity.
  const refused = ({ rule, match }: ClassifiedFinding) => rule.refuseWrite && work.editedVia.get(match.file) === "shell"
  const failing = blocking.filter((finding) => finding.rule.severity === "error" || refused(finding))
  if (failing.length === 0) return { stop: "allow", work: [] }
  const blocks = work.stopBlocks.get(agent) ?? 0
  if (mode === "attended") {
    if (blocks < maxBlocks) return { stop: "block", work: [{ t: "stopBlock", agent }] }
    return { stop: "capReached", work: [] }
  }
  const keys = [...new Set(failing.map(findingKey))]
  const unrepeated = keys.filter((key) => (work.blockedFindings.get(blockedKey(agent, key)) ?? 0) < REPEAT_LIMIT)
  // A refused write is not a judgement the agent may dispute by repetition: it blocks until it is
  // reverted, bounded only by the budget and the report.
  if ((unrepeated.length > 0 || failing.some(refused)) && blocks < maxBlocks) {
    return { stop: "block", work: [{ t: "stopBlock", agent, findings: keys }] }
  }
  if (!work.stopReports.has(agent)) return { stop: "report", work: [{ t: "stopReport", agent }] }
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
  // After the budget, like the notices: what did not run is never cut to make room for what did.
  const disabled = input.disabled ?? []
  if (disabled.length > 0) trimmed.delivery.disabled = disabled
  if (!input.stopGate) return { delivery: trimmed.delivery, overflow: trimmed.overflow, work: [], context }

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
  // An incomplete stop carries no findings: none of the delivery is context the agent was given.
  if (gated.stop === "incomplete") return { delivery, overflow: null, work: gated.work, context: [] }
  // Only a block or a report reaches the agent as context; anything else must not count as
  // delivered. A capReached still prints its delivery as a system message, so it keeps the overflow
  // file — the message says rules did not fit, and the file is where they went.
  if (gated.stop === "allow") return { delivery, overflow: null, work: gated.work, context: [] }
  if (gated.stop === "capReached") return { delivery, overflow: trimmed.overflow, work: gated.work, context: [] }
  return { delivery, overflow: trimmed.overflow, work: gated.work, context }
}
