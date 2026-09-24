/**
 * rulecast's own internals, for tooling that embeds the CLI rather than extending it — the
 * benchmark harness in `scripts/` is the first caller.
 *
 * **No stability promise.** These shapes change without a major version; `@syv-ai/rulecast` is the
 * supported surface. They are exported so that something inside this repository, or an experiment
 * outside it, can drive a pipeline without reaching into `dist/` by path.
 */

export {
  type CompiledProject,
  type CompileOptions,
  compile,
  compileManifest,
  type Diagnostic,
} from "./core/compile/project"
export { CONFIG_FILE, MANIFEST_FILE } from "./core/config/load"
export type { Config, RuleEntry, Stage } from "./core/config/schema"
export { renderAgentText } from "./core/delivery/render-agent"
export { checkableKinds, checkDetectors, type KindCheckResult } from "./core/detection/check"
export { cacheHome, type Env, projectStateDir } from "./core/home"
export { type PipelineOptions, type PipelineResult, runPipeline } from "./core/pipeline"
export { type Checkout, cachedRepos, fetchingRepos, fixedRepo, type RepoProvider } from "./core/repos/provider"
export { MODEL_ALIASES, resolveModel } from "./detectors/llm/models"
export { providerByName } from "./detectors/llm/providers/index"
