/**
 * Spec §16's promise, as a type: the public entry point names nothing it does not export.
 *
 * `@syv-ai/rulecast` exports `CompiledRule`, so every type its fields are declared with has to be
 * nameable from there too — otherwise a third-party detector or adapter has to reach into
 * `@syv-ai/rulecast/internal`, which carries no stability promise, and internal shapes can no longer
 * change without a major version. Before this file existed, three of them could not be named from
 * either entry point: `Stage`, `ReferenceSpec` and `RuleExamples`.
 *
 * **This file has no tests in it and is not meant to run.** `tsconfig.json` includes `test`, so
 * `tsc --noEmit` is the assertion and lefthook already runs it on commit. It imports from
 * `../src/index` rather than from the package name so it needs no build.
 *
 * To break it on purpose: remove one of the promoted exports from `src/index.ts` and run
 * `pnpm typecheck`. It should fail with TS2305.
 */

import type {
  Adapter,
  AdapterInstall,
  Cache,
  CompiledDetector,
  CompiledRule,
  Delivery,
  Detector,
  DetectorRule,
  DetectorRun,
  Event,
  Match,
  ReferenceSpec,
  RenderOptions,
  RuleExamples,
  RuleScope,
  Severity,
  Stage,
} from "../src/index"
import { lineStarts, offsetAt, perRule, positionAt, renderAgentText } from "../src/index"

declare const rule: CompiledRule

// Every field of CompiledRule, named through the public entry point only.
export const id: string = rule.id
export const name: string = rule.name
export const description: string | null = rule.description
export const source: string = rule.source
export const severity: Severity = rule.severity
export const scope: RuleScope = rule.scope
export const refuseWrite: boolean = rule.refuseWrite
export const stages: Stage[] = rule.stages
export const matches: (file: string) => boolean = rule.matches
export const detector: CompiledDetector | null = rule.detector
export const message: string | null = rule.message
export const context: ReferenceSpec[] = rule.context
export const examples: RuleExamples | null = rule.examples

// An adapter has to be implementable from here: it renders a delivery and installs its own hooks.
declare const delivery: Delivery
declare const event: Event
declare const options: RenderOptions
export const rendered: string = renderAgentText(delivery, options)
export type PublicAdapter = Adapter
export type PublicInstall = AdapterInstall

// A detector has to be implementable from here: the run input, a match, the cache, and the helpers
// that turn an offset into the line and column a Match carries.
declare const run: DetectorRun<{ pattern: string }>
export const cache: Cache = run.cache
export const deadlineAt: number = run.deadlineAt
export const starts: number[] = lineStarts("a\nb")
export const at: { line: number; column: number } = positionAt(starts, 2)
export const offset: number = offsetAt(starts, 1, 1, 3)
export const built: Detector<{ pattern: string }>["run"] = perRule<{ pattern: string }>(async () => [] as Match[])
declare const detectorRule: DetectorRule
export const detectorKind: string = detectorRule.detector.kind
