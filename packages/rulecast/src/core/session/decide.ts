import path from "node:path"

import type { CompiledRule } from "../compile/rule"
import { measureRuleBlock } from "../delivery/render-agent"
import type { ReferenceResolver, ResolvedRef } from "../delivery/resolve"
import type { ReferenceSpec } from "../references"
import { renderTemplate, templateBindings } from "../template"
import { type DeliveredReference, type Delivery, emptyDelivery, type Finding, type Match } from "../types"
import { type ContextRecord, type ContextState, preexistingKey, type WorkRecord, type WorkState } from "./state"

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

/** Characters a renderer adds around one item; used only for the budget estimate. */
const ITEM_OVERHEAD = 64

/** The header, the blank lines between blocks, and whatever an adapter wraps the text in. */
const HEADER_OVERHEAD = 128

/** The three lines naming the file the rest of a cut delivery was written to, path included. */
const OVERFLOW_NOTICE = 256

/** A reference's own line, at its longest: "read this before continuing (not included, …)". */
const REFERENCE_OVERHEAD = 96

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

export async function decide(input: DecideInput): Promise<Decision> {
  const delivery = emptyDelivery()
  const work: WorkRecord[] = []
  const context: ContextRecord[] = []

  // Findings and pre-existing summaries.
  const fresh = input.findings.filter((finding) => finding.status === "new")
  delivery.findings = renderFindings(fresh)
  const rulesById = new Map(fresh.map(({ rule }) => [rule.id, rule]))
  for (const { rule } of fresh) if (rule.message !== null) delivery.templates[rule.id] = rule.message
  const summaries = new Map<string, { rule: string; file: string; count: number }>()
  for (const { rule, match, status } of input.findings) {
    if (status !== "preexisting") continue
    const key = preexistingKey(rule.id, match.file)
    if (input.context.preexisting.has(key)) continue
    const summary = summaries.get(key) ?? { rule: rule.id, file: match.file, count: 0 }
    summary.count++
    summaries.set(key, summary)
  }
  delivery.preexistingSummary = [...summaries.values()]

  // Warnings, once per context.
  for (const warning of input.warnings) {
    if (input.context.warned.has(warning.key)) continue
    delivery.warnings.push(warning.text)
    context.push({ t: "warned", key: warning.key })
  }

  // Touches.
  delivery.touches = input.touches.map((rule) => rule.id)
  for (const rule of input.touches) context.push({ t: "touched", rule: rule.id })

  // A complete read by the agent counts as delivered.
  const delivered = [...input.context.delivered]
  if (input.agentRead !== null) {
    const hash = await input.resolver.currentHash(input.agentRead, null)
    if (hash !== null) {
      delivered.push({ path: input.agentRead, anchor: null, hash })
      context.push({ t: "delivered", path: input.agentRead, anchor: null, hash })
    }
  }

  // References.
  const ruleOrder = [...new Map(fresh.map((finding) => [finding.rule.id, finding.rule])).values(), ...input.touches]
  const candidates: { index: number; resolved: Extract<ResolvedRef, { found: true }> }[] = []
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

  // Budget (spec §9). The floor is the header, the warnings, and one finding for every rule that
  // fired. What is left goes to the doc sections first, then the pre-existing summaries, then the
  // rules' remaining matches — the reverse of what is worth losing. A repeat the agent does not see
  // it can still find in the file; the section that explains the rule is the part it cannot.
  const limit = input.maxContextChars
  const render = { maxMatchesPerRule: input.maxMatchesPerRule }
  // Taken before anything is cut: what the overflow file is written from. The arrays are copied
  // because the budget replaces entries in the delivery's own.
  const complete: Delivery = {
    ...delivery,
    findings: [...delivery.findings],
    preexistingSummary: [...delivery.preexistingSummary],
    references: [...delivery.references],
    omitted: { findings: [], rules: 0, preexisting: 0 },
  }
  const byRule = new Map<string, Finding[]>()
  for (const finding of delivery.findings) byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding])

  let used = HEADER_OVERHEAD + delivery.warnings.reduce((sum, warning) => sum + warning.length + ITEM_OVERHEAD, 0)
  const fits = (size: number) => limit === null || used + size <= limit
  const kept = new Map<string, Finding[]>()
  // A reference costs its line whatever its state: one whose content does not fit is not dropped,
  // it is demoted to "read this", which the renderer still prints. The line is charged with the rule
  // that cites it, because the two are one floor item — a finding without its section explains
  // nothing, and a section for a finding the agent cannot see explains nothing either.
  const lineCost = (ref: string) => ref.length + REFERENCE_OVERHEAD
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
        measureRuleBlock(id, [findings[0]!], delivery.templates[id], render) +
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
    for (const touch of input.touches) {
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
    if (floor.dropped > 0) floor = floorWithin(limit - OVERFLOW_NOTICE)
    used += floor.chars + (floor.dropped > 0 ? OVERFLOW_NOTICE : 0)
    delivery.omitted.rules = floor.dropped
    for (const [id, findings] of floor.kept) kept.set(id, findings)
    for (const ref of floor.refs) charged.add(ref)
    // What is left is cited only by rules that were dropped, and explains nothing the agent can see.
    for (const ref of resolvedRefs) if (!charged.has(ref)) orphaned.add(ref)
  }

  for (const { index, resolved } of candidates) {
    const size = resolved.content.length
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

  const summariesKept: Delivery["preexistingSummary"] = []
  for (const summary of delivery.preexistingSummary) {
    if (!fits(summary.rule.length + summary.file.length + ITEM_OVERHEAD)) {
      delivery.omitted.preexisting++
      continue
    }
    used += summary.rule.length + summary.file.length + ITEM_OVERHEAD
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
        if (shown === undefined || shown.length >= Math.min(findings.length, input.maxMatchesPerRule)) continue
        const template = delivery.templates[rule]
        const delta =
          measureRuleBlock(rule, [...shown, findings[shown.length]!], template, render) -
          measureRuleBlock(rule, shown, template, render)
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

  // Stop gate.
  if (input.stopGate) {
    const newErrors = delivery.findings.some((finding) => finding.severity === "error")
    const blocks = input.work.stopBlocks.get(input.agent) ?? 0
    if (!newErrors) delivery.stop = "allow"
    else if (blocks < input.maxBlocks) {
      delivery.stop = "block"
      work.push({ t: "stopBlock", agent: input.agent })
    } else delivery.stop = "capReached"
    // Only a block reaches the agent; anything else must not count as delivered.
    if (delivery.stop !== "block") return { delivery, overflow: null, work, context: [] }
  }

  return { delivery, overflow: delivery.omitted.rules > 0 ? complete : null, work, context }
}
