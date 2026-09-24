/** Fixture and measurement helpers shared by the scenarios. Nothing here asserts anything. */
import { mkdtempSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { compile } from "../../src/core/compile/project"
import { createRegistry } from "../../src/core/detection/registry"
import { projectStateDir } from "../../src/core/home"
import { type PipelineOptions, type PipelineResult, runPipeline } from "../../src/core/pipeline"
import { cachedRepos } from "../../src/core/repos/provider"
import type { Event } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "../../test/helpers/config"
import { createRepo } from "../../test/helpers/git"
import type { Check } from "./types"

export const registry = createRegistry([...builtinDetectors])

/** Claude Code's budget, so every number here is one the agent would actually have seen. */
export const MAX_CONTEXT_CHARS = 9_000

export { createRepo, localConfig }

/** Committed in place of a file the scenario wants to look edited. Any content differs from it. */
const PLACEHOLDER = "// placeholder\n"

/**
 * A committed repo with `files`, and a config built from `rules` and top-level `settings`.
 *
 * Everything in `files` is written **after** the commit, over a placeholder, so the baseline sees
 * the whole tree as edited. Without that the fixtures measure nothing: a match on a line that has
 * not changed is classified `preexisting`, never reaches `delivery.findings`, and a scenario that
 * asserted only "nothing threw" would pass while detecting nothing at all. The first version of
 * this harness made exactly that mistake and reported four green scenarios with zero findings.
 */
export async function stressRepo(
  rules: Record<string, unknown>[],
  files: Record<string, string>,
  settings: Record<string, unknown> = {},
): Promise<string> {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig(rules, settings),
    ...Object.fromEntries(Object.keys(files).map((name) => [name, PLACEHOLDER])),
  })
  await writeFiles(root, files)
  return root
}

/** Writes repo-relative files, creating directories as needed. */
export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      const file = path.join(root, name)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, text)
    }),
  )
}

/** A repo whose config text is given verbatim — for configs that must not be well formed. */
export function rawRepo(config: string, files: Record<string, string>): Promise<string> {
  return createRepo({ ".rulecast-config.yaml": config, ...files })
}

export interface Run {
  result: PipelineResult
  elapsedMs: number
}

/**
 * One event through the real pipeline, timed. The project is recompiled per call, as a hook does:
 * a stress number that assumed a warm in-process compile would flatter every scenario.
 */
export async function runEvent(
  root: string,
  event: Omit<Event, "cwd">,
  options: Partial<Omit<PipelineOptions, "project" | "stateDir" | "event" | "registry">> = {},
): Promise<Run> {
  const project = await compile({ root, registry, repos: cachedRepos(homeFor()) })
  const started = performance.now()
  const result = await runPipeline({
    maxContextChars: MAX_CONTEXT_CHARS,
    ...options,
    registry,
    project,
    stateDir: projectStateDir(homeFor(), root),
    event: { ...event, cwd: root },
  })
  return { result, elapsedMs: performance.now() - started }
}

/** Compile only, timed — for scenarios whose cost is the config rather than detection. */
export async function compileOnly(root: string): Promise<{ elapsedMs: number; rules: number; diagnostics: number }> {
  const started = performance.now()
  const project = await compile({ root, registry, repos: cachedRepos(homeFor()) })
  return {
    elapsedMs: performance.now() - started,
    rules: project.rules.length,
    diagnostics: project.diagnostics.length,
  }
}

/**
 * One cache home per scenario process, so a stress run never touches the developer's ~/.cache and
 * never leaves state inside the fixture repo, where git would see it as an untracked change.
 */
const HOME = mkdtempSync(path.join(tmpdir(), "rulecast-stress-home-"))

export function homeFor(): string {
  return HOME
}

export function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail }
}

/** `actual` is within `limit`; the detail carries both either way, because the number is the finding. */
export function within(name: string, actual: number, limit: number, unit = "ms"): Check {
  return {
    ...check(name, actual <= limit, `${actual.toFixed(0)} ${unit} (limit ${limit} ${unit})`),
    measured: { value: actual, limit, unit },
  }
}

export const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}
