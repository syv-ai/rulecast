import type { CompiledRule } from "./compile/rule"
import type { Config } from "./config/schema"
import { type ReferenceResolver, resolveRuleContext } from "./delivery/resolve"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { readSourceFile } from "./detection/per-rule"
import { isInserted, propose } from "./detection/proposal"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectDetectorRules } from "./detection/select"
import { decide } from "./session/decide"
import { emptyContext, refusalKey, type WorkRecord, type WorkState } from "./session/state"
import { type Delivery, type Event, emptyDelivery } from "./types"

export interface GuardInput {
  root: string
  config: Config
  registry: DetectorRegistry
  stateDir: string
  event: Event
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  work: WorkState
  resolver: ReferenceResolver
  maxContextChars: number | null
  log: (line: string) => void
  record: (records: WorkRecord[]) => Promise<void>
}

/**
 * Decides whether to refuse a write the agent has not made yet (spec §9, Guard).
 *
 * Everything here is arranged so that the answer to a doubt is "allow". A refusal is only ever
 * raised on text the agent's own tool call contains, so a file this could not reconstruct, a
 * detector that failed or timed out, a rule that has already refused this file, or anything else
 * unexpected leaves the write alone — the edit hook reports it a moment later, as it always has.
 */
export async function guardWrite(input: GuardInput): Promise<Delivery> {
  const file = input.event.files[0]
  const intent = input.event.intent
  if (file === undefined || intent === undefined) return emptyDelivery()

  const rules = input.rules.filter((rule) => rule.refuseWrite && !input.disabled.has(rule.id) && rule.matches(file))
  if (rules.length === 0) return emptyDelivery()

  const proposal = propose(await readSourceFile(input.root, file), intent)
  if (proposal === null) {
    input.log(`guard: ${file} could not be reconstructed from the tool call; allowing the write`)
    return emptyDelivery()
  }
  // A pure deletion adds nothing that a rule could fire on.
  if (proposal.inserts.length === 0) return emptyDelivery()

  const selections = selectDetectorRules(rules, "edit", [file], input.disabled)
  if (selections.length === 0) return emptyDelivery()

  const output = await runDetection({
    root: input.root,
    event: "edit",
    selections,
    changes: new Map(),
    // The proposed file for the one being written; anything else a detector reaches for is real.
    read: async (name) => (name === file ? proposal.content : readSourceFile(input.root, name)),
    registry: input.registry,
    cacheFor: (kind) => diskCache(detectorCacheDir(input.stateDir, kind)),
    contextFor: (rule) => resolveRuleContext(input.resolver, rule.context),
    settings: { llm: input.config.llm },
    timeoutMs: input.config.timeouts.editDeadlineMs,
  })

  const evidence = output.findings.filter(({ rule, match }) => isInserted(proposal, match, rule.detector.kind))
  if (evidence.length === 0) return emptyDelivery()

  // The refuse gate, like the stop gate: a rule that has had its say about a file lets the next
  // attempt through. An agent that cannot write and cannot learn why would simply be stuck.
  const spent = (rule: string) =>
    (input.work.refusals.get(refusalKey(rule, file)) ?? 0) >= input.config.refuseGate.maxRefusals
  const refusing = evidence.filter(({ rule }) => !spent(rule.id))
  if (refusing.length === 0) {
    input.log(`guard: ${file} has spent its refusals; allowing the write`)
    return emptyDelivery()
  }

  const { delivery } = await decide({
    agent: "main",
    findings: refusing.map(({ rule, match }) => ({ rule, match, status: "new" as const })),
    touches: [],
    agentRead: null,
    warnings: [],
    work: input.work,
    // An empty context, so the sections come with the refusal even if they were delivered earlier:
    // the message has to stand on its own, and nothing here is recorded as delivered because the
    // write it explains never happened.
    context: emptyContext(),
    resolver: input.resolver,
    maxBytes: input.config.context.maxBytes,
    maxBlocks: input.config.stopGate.maxBlocks,
    maxContextChars: input.maxContextChars,
    maxMatchesPerRule: input.config.maxMatchesPerRule,
    stopGate: false,
  })
  await input.record(
    [...new Set(refusing.map(({ rule }) => rule.id))].map((rule) => ({ t: "refused" as const, rule, file })),
  )
  return delivery
}
