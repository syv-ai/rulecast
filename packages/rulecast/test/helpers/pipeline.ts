import { compile } from "../../src/core/compile/project"
import type { DetectorRegistry } from "../../src/core/detection/registry"
import { type PipelineOptions, type PipelineResult, runPipeline } from "../../src/core/pipeline"
import { cachedRepos } from "../../src/core/repos/provider"
import type { Event } from "../../src/core/types"
import { registry as fixtureRegistry } from "./fixture"
import { stateDirFor, TEST_HOME } from "./home"

/** Compiles the project at `root` and runs one event through the pipeline with the test cache home. */
export async function pipelineAt(
  root: string,
  event: Event,
  options: Partial<Omit<PipelineOptions, "project" | "stateDir" | "event">> = {},
): Promise<PipelineResult> {
  const registry: DetectorRegistry = options.registry ?? fixtureRegistry
  const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
  return runPipeline({ maxContextChars: null, ...options, registry, project, stateDir: stateDirFor(root), event })
}
