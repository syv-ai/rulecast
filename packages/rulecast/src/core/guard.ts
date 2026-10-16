import type { CompiledRule } from "./compile/rule"
import type { Config, Mode } from "./config/schema"
import type { ReferenceResolver } from "./delivery/resolve"
import type { DetectionContext } from "./detection/context"
import { readSourceFile } from "./detection/per-rule"
import { lineStarts } from "./detection/positions"
import { isInserted, propose } from "./detection/proposal"
import { runDetection } from "./detection/run"
import { selectDetectorRules } from "./detection/select"
import { findingIds } from "./finding-id"
import { assemble, trim } from "./session/decide"
import { type ContextRecord, refusalKey, type WorkRecord, type WorkState } from "./session/state"
import { type Delivery, type Event, emptyDelivery, type Match } from "./types"

export interface GuardInput {
  /** The project's detection context (detection/context.ts). */
  detection: DetectionContext
  config: Config
  event: Event
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  /** Unattended, an ignore comment the proposal writes silences nothing, as in the pipeline. */
  mode: Mode
  work: WorkState
  /**
   * Not reachable through `detection`, which exposes only `contextFor`: the delivery decision
   * resolves references itself, and that is a different consumer of the same resolver.
   */
  resolver: ReferenceResolver
  maxContextChars: number | null
  log: (line: string) => void
  record: (records: WorkRecord[]) => Promise<void>
  /** Appends to the agent's context memory: the sections a refusal delivered. */
  recordContext: (records: ContextRecord[]) => Promise<void>
  /** The findings a refusal rests on, for the findings log (core/stats/log.ts); absent without a session. */
  recordFindings?: (refusing: { id: string; rule: CompiledRule; match: Match }[]) => Promise<void>
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

  const proposal = propose(await readSourceFile(input.detection.root, file), intent)
  if (proposal === null) {
    input.log(`guard: ${file} could not be reconstructed from the tool call; allowing the write`)
    return emptyDelivery()
  }
  // A pure deletion adds nothing that a rule could fire on.
  if (proposal.inserts.length === 0) return emptyDelivery()

  // The size ceiling, measured on the proposed content rather than the file on disk: this is a
  // write that has not happened yet, and the text the agent is about to write is what a detector
  // would parse. Every rule reaching here guards, so every one of them runs in this process, ahead
  // of the write — `ast-grep` parses in native code that no timeout interrupts, so a large enough
  // proposal is seconds of an agent blocked on its own tool call. Logged, not warned about, and
  // allowing the write is what this function does with every other doubt.
  if (proposal.content.length > input.config.maxFileBytes) {
    input.log(`guard: ${file} is over max_file_bytes (${input.config.maxFileBytes}); allowing the write`)
    return emptyDelivery()
  }

  const selections = selectDetectorRules(rules, "edit", [file], input.disabled)
  if (selections.length === 0) return emptyDelivery()

  const output = await runDetection({
    detection: input.detection,
    event: "edit",
    selections,
    changes: new Map(),
    // The proposed file for the one being written; anything else a detector reaches for is real.
    read: async (name) => (name === file ? proposal.content : readSourceFile(input.detection.root, name)),
    timeoutMs: input.config.timeouts.editDeadlineMs,
  })

  // Unattended, nobody agreed to an ignore comment on a line this write adds or changes: the
  // finding it would silence is judged as if it were not there. A comment already in the file
  // still counts, even when the write changes the code under it.
  const starts = lineStarts(proposal.content)
  const written = (line: number) => {
    const from = starts[line - 1]
    if (from === undefined) return false
    const to = starts[line] ?? proposal.content.length
    return proposal.inserts.some(([start, end]) => from < end && to > start)
  }
  const wholeFile = (kind: string) => input.detection.registry.get(kind)?.wholeFile === true
  // Over ignored matches too, as the pipeline numbers them, so a match has one id at guard and verify.
  const ids = findingIds(
    [...output.findings, ...output.ignored],
    (kind) => input.detection.registry.get(kind)?.volatileCaptures ?? [],
  )
  const findings = [
    ...output.findings.map((finding, index) => ({ ...finding, id: ids[index]! })),
    ...output.ignored
      .map(({ rule, match, commentLine }, index) => ({
        rule,
        match,
        commentLine,
        id: ids[output.findings.length + index]!,
      }))
      .filter(({ commentLine }) => input.mode === "unattended" && written(commentLine))
      .map(({ commentLine: _, ...finding }) => finding),
  ]
  const evidence = findings.filter(({ rule, match }) => isInserted(proposal, match, wholeFile(rule.detector.kind)))
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

  // Assemble and trim, and no stop gate: a refusal is not a stop. No touches, no warnings and no
  // context of what was delivered earlier, so the sections come with the refusal even if the agent
  // has seen them: the message has to stand on its own. The write never happened, but its
  // explanation did reach the model — the denial reason is what it reads in place of the tool's
  // result — so the sections it carried are recorded as delivered, and the next delivery points
  // back to them instead of sending them again.
  const assembled = await assemble({
    findings: refusing.map(({ id, rule, match }) => ({ id, rule, match, status: "new" as const })),
    resolver: input.resolver,
    maxBytes: input.config.context.maxBytes,
  })
  const { delivery, context } = trim(assembled, {
    maxContextChars: input.maxContextChars,
    maxMatchesPerRule: input.config.maxMatchesPerRule,
  })
  await input.recordContext(context.filter((record) => record.t === "delivered"))
  await input.record(
    [...new Set(refusing.map(({ rule }) => rule.id))].map((rule) => ({ t: "refused" as const, rule, file })),
  )
  await input.recordFindings?.(refusing)
  return delivery
}
