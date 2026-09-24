/**
 * The plugin API (spec §16): what a third-party detector or adapter needs, and nothing else.
 *
 * Everything the CLI uses to do its own work — compiling a project, running the pipeline, locating
 * the cache, fetching rule repos — is in `@syv-ai/rulecast/internal`, which carries no stability
 * promise. Keeping the two apart is what lets those shapes change without a major version.
 */

export { claudeCodeAdapter } from "./adapters/claude-code/adapter"
export { ADAPTERS, adapterByName } from "./adapters/index"
export type { CompiledDetector, CompiledRule, DetectorRule, TouchRule } from "./core/compile/rule"
export { isDetectorRule } from "./core/compile/rule"
export { perRule } from "./core/detection/per-rule"
export { type AnyDetector, createRegistry, type DetectorRegistry } from "./core/detection/registry"
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
