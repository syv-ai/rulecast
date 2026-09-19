export { claudeCodeAdapter } from "./adapters/claude-code/adapter"
export {
  type CompiledProject,
  type CompileOptions,
  compile,
  compileManifest,
  type Diagnostic,
} from "./core/compile/project"
export type { CompiledRule } from "./core/compile/rule"
export { renderAgentText } from "./core/delivery/render-agent"
export { perRule } from "./core/detection/per-rule"
export { createRegistry, type DetectorRegistry } from "./core/detection/registry"
export { type PipelineOptions, type PipelineResult, runPipeline } from "./core/pipeline"
export { cachedRepos, fetchingRepos, fixedRepo, type RepoProvider } from "./core/repos/provider"
export type * from "./core/types"
export { emptyDelivery } from "./core/types"
export { builtinDetectors } from "./detectors"
