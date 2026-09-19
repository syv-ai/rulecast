import path from "node:path"

import type { CompiledRule } from "../compile/rule"
import type { ReferenceResolver, ResolvedRef } from "../delivery/resolve"
import type { ReferenceSpec } from "../references"
import { renderTemplate } from "../template"
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
  /** verify from a stop: decide block / allow / capReached. */
  stopGate: boolean
}

export interface Decision {
  delivery: Delivery
  work: WorkRecord[]
  context: ContextRecord[]
}

/** Characters a renderer adds around one item; used only for the budget estimate. */
const ITEM_OVERHEAD = 64

/** Rule repo references have absolute paths; the agent needs that path to read them. */
function locationOf(spec: ReferenceSpec): { location?: string } {
  return path.isAbsolute(spec.path) ? { location: spec.path } : {}
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
  for (const summary of delivery.preexistingSummary) {
    context.push({ t: "preexisting", rule: summary.rule, file: summary.file })
  }

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

  // Budget: findings, summaries and warnings always fit; references fill what is left, in order.
  let used =
    delivery.findings.reduce((sum, f) => sum + f.message.length + f.file.length + ITEM_OVERHEAD, 0) +
    delivery.preexistingSummary.reduce((sum, s) => sum + s.rule.length + s.file.length + ITEM_OVERHEAD, 0) +
    delivery.warnings.reduce((sum, w) => sum + w.length + ITEM_OVERHEAD, 0) +
    delivery.references.reduce((sum, r) => sum + (r.state === "full" ? 0 : r.ref.length + ITEM_OVERHEAD), 0)
  for (const { index, resolved } of candidates) {
    const size = resolved.content.length + resolved.spec.ref.length + ITEM_OVERHEAD
    if (input.maxContextChars !== null && used + size > input.maxContextChars) {
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
    if (delivery.stop !== "block") return { delivery, work, context: [] }
  }

  return { delivery, work, context }
}
