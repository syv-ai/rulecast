import type { CompiledRule } from "../compile/compile"
import { errorMessage } from "../errors"
import type { Cache, ChangeSet, DetectorEvent, DetectorResult, Match, ResolvedReference } from "../types"
import type { DetectorRegistry } from "./registry"
import type { Selection } from "./select"

export interface DetectionInput {
  root: string
  event: DetectorEvent
  selections: Selection[]
  changes: ReadonlyMap<string, ChangeSet>
  registry: DetectorRegistry
  cacheFor(kind: string): Cache
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
  timeoutMs: number
}

export interface DetectionOutput {
  findings: { rule: CompiledRule; match: Match }[]
  errors: { kind: string; rules: string[]; message: string }[]
  timedOut: { kind: string; rules: string[] }[]
}

const TIMED_OUT = Symbol("timed out")

export async function runDetection(input: DetectionInput): Promise<DetectionOutput> {
  const output: DetectionOutput = { findings: [], errors: [], timedOut: [] }
  const byKind = new Map<string, Selection[]>()
  for (const selection of input.selections) {
    const kind = selection.rule.detector!.kind
    byKind.set(kind, [...(byKind.get(kind) ?? []), selection])
  }

  const controller = new AbortController()
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(TIMED_OUT), { once: true })
  })
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)

  type Outcome =
    | { status: "ok"; kind: string; selections: Selection[]; result: DetectorResult }
    | { status: "error"; kind: string; selections: Selection[]; message: string }
    | { status: "timedOut"; kind: string; selections: Selection[] }

  const perKind = await Promise.all(
    [...byKind].map(async ([kind, selections]): Promise<Outcome> => {
      const detector = input.registry.get(kind)
      if (!detector) return { status: "error", kind, selections, message: `detector "${kind}" is not registered` }
      try {
        const rules = await Promise.all(
          selections.map(async ({ rule, files }) => ({
            id: rule.id,
            config: rule.detector!.config,
            files,
            context: await input.contextFor(rule),
          })),
        )
        const result = await Promise.race([
          detector.run({
            event: input.event,
            rules,
            changes: input.changes,
            cache: input.cacheFor(kind),
            cwd: input.root,
            signal: controller.signal,
          }),
          deadline,
        ])
        if (result === TIMED_OUT) return { status: "timedOut", kind, selections }
        return { status: "ok", kind, selections, result }
      } catch (error) {
        if (controller.signal.aborted) return { status: "timedOut", kind, selections }
        return { status: "error", kind, selections, message: errorMessage(error) }
      }
    }),
  )
  clearTimeout(timer)

  for (const outcome of perKind) {
    const ids = outcome.selections.map((selection) => selection.rule.id)
    if (outcome.status === "timedOut") {
      output.timedOut.push({ kind: outcome.kind, rules: ids })
      continue
    }
    if (outcome.status === "error") {
      output.errors.push({ kind: outcome.kind, rules: ids, message: outcome.message })
      continue
    }
    const result = outcome.result
    const rulesById = new Map(outcome.selections.map((selection) => [selection.rule.id, selection.rule]))
    const stray = result.findings.find((finding) => !rulesById.has(finding.rule))
    const wholeRun = result.errors.find((error) => error.rule === null)
    if (stray || wholeRun) {
      const message = stray ? `detector reported unknown rule "${stray.rule}"` : wholeRun!.message
      output.errors.push({ kind: outcome.kind, rules: ids, message })
      continue
    }
    const failed = new Map<string, string>()
    for (const error of result.errors) failed.set(error.rule!, error.message)
    for (const finding of result.findings) {
      const rule = rulesById.get(finding.rule)!
      const missing = rule.detector!.captures.find((name) => typeof finding.match.captures[name] !== "string")
      if (missing && !failed.has(rule.id)) failed.set(rule.id, `match is missing declared capture "${missing}"`)
    }
    for (const [rule, message] of failed) output.errors.push({ kind: outcome.kind, rules: [rule], message })
    for (const finding of result.findings) {
      if (!failed.has(finding.rule)) output.findings.push({ rule: rulesById.get(finding.rule)!, match: finding.match })
    }
  }
  return output
}
