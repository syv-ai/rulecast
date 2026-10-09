/**
 * The plugin API (spec §16): what a third-party detector or adapter needs, and nothing else.
 *
 * Everything the CLI uses to do its own work — compiling a project, running the pipeline, locating
 * the cache, fetching rule repos — is in `@syv-ai/rulecast/internal`, which carries no stability
 * promise. Keeping the two apart is what lets those shapes change without a major version.
 */

export { claudeCodeAdapter } from "./adapters/claude-code/adapter"
export { type BacklogSummary, renderBacklog, summarise } from "./adapters/cli/backlog"
export { ADAPTERS, adapterByName } from "./adapters/index"
export type { CompiledDetector, CompiledRule, DetectorRule, TouchRule } from "./core/compile/rule"
export { isDetectorRule } from "./core/compile/rule"
// Every type a field of `CompiledRule` is declared with, so a third-party detector or adapter can
// name them all. `test/plugin-api.ts` fails typecheck if one of them goes missing again.
export type { RuleExample, RuleExamples, RuleScope, Stage } from "./core/config/schema"
// An adapter cannot implement `Adapter.format` without the renderer, and the positions helpers are
// what a detector needs to turn an offset into the line and column a `Match` carries.
export { type RenderOptions, renderAgentText } from "./core/delivery/render-agent"
// What a detector that hands paths to another program needs, so a third-party one starts with the
// plumbing rather than a blank file: command and linter each carried their own copies.
export { repoRelative, repoRelativeTo } from "./core/detection/paths"
export { pastDeadline, perRule, sourceReader } from "./core/detection/per-rule"
export { lineStarts, offsetAt, positionAt } from "./core/detection/positions"
export { type AnyDetector, createRegistry, type DetectorRegistry } from "./core/detection/registry"
export { runTool } from "./core/detection/tool"
export type { ReferenceSpec } from "./core/references"
export type * from "./core/types"
export { emptyDelivery } from "./core/types"
export { VERSION } from "./core/version"
export { builtinDetectors } from "./detectors"
export {
  type LlmFinding,
  type LlmProvider,
  type LlmRequest,
  LlmUnavailableError,
} from "./detectors/llm/providers/types"
export { type AdapterFixture, adapterContract } from "./testing/adapter-contract"
export type { ContractCase } from "./testing/contract"
export { type DetectorFixture, detectorContract } from "./testing/detector-contract"
