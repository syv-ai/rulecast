import type { CompiledProject } from "../compile/project"
import type { CompiledRule } from "../compile/rule"
import { type ReferenceResolver, resolveRuleContext } from "../delivery/resolve"
import type { Cache, DetectorSettings, ResolvedReference } from "../types"
import { detectorCacheDir, diskCache } from "./cache"
import type { DetectorRegistry } from "./registry"

/**
 * Detection, for one project: everything a detector run needs that does not change between runs.
 *
 * Six call sites used to assemble this by hand and five types described it, including an unexported
 * `Detection` in `commands/test.ts` that had been invented locally and collided by name with the
 * unrelated `Detection` in `init/detect.ts`. The closure
 * `diskCache(detectorCacheDir(stateDir, kind))` was written out six times and
 * `settings: { llm: config.llm }` seven.
 *
 * `timeoutMs` is deliberately **not** here. The pipeline varies it per event — the edit deadline on
 * edit, `verify_ms` on verify (§13) — so it belongs with the other things a caller passes per run.
 */
export interface DetectionContext {
  root: string
  registry: DetectorRegistry
  settings: DetectorSettings
  cacheFor(kind: string): Cache
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
}

/**
 * The context for a compiled project.
 *
 * A caller that needs to deviate spreads over it and says why — `doctor` substitutes a memory cache
 * and an empty context on purpose, and spreading makes that a visible exception rather than one of
 * six hand-assembled wirings.
 */
export function detectionFor(
  project: CompiledProject,
  /** Not on CompiledProject: the registry is an input to `compile`, not part of its result. */
  registry: DetectorRegistry,
  stateDir: string,
  resolver: ReferenceResolver,
): DetectionContext {
  return {
    root: project.root,
    registry,
    settings: { llm: project.config.llm },
    cacheFor: (kind) => diskCache(detectorCacheDir(stateDir, kind)),
    contextFor: (rule) => resolveRuleContext(resolver, rule.context),
  }
}
