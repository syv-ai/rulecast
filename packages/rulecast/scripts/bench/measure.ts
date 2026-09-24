import { mkdtempSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { compile } from "../../src/core/compile/project"
import { renderAgentText } from "../../src/core/delivery/render-agent"
import { createRegistry } from "../../src/core/detection/registry"
import { projectStateDir } from "../../src/core/home"
import { runPipeline } from "../../src/core/pipeline"
import { cachedRepos } from "../../src/core/repos/provider"
import type { Delivery, Event } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { createRepo } from "../../test/helpers/git"
import type { Scenario, Step } from "./scenarios"

/**
 * Claude Code's budget (adapters/claude-code/adapter.ts). Measuring against the real number is the
 * point: a saving that only appears at an unlimited budget is not a saving the agent ever sees.
 */
const MAX_CONTEXT_CHARS = 9_000
const RESTORED_FILES = 5

/**
 * Characters per token. A rough, stated divisor rather than a tokenizer: rulecast's output is
 * prose and paths, the ratio is stable across it, and a dependency that has to be kept in step
 * with a vendor's vocabulary would make the number look more exact than it is. Characters are the
 * measurement; tokens are the unit people budget in.
 */
export const CHARS_PER_TOKEN = 4

export const tokens = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN)

export interface StepMeasurement {
  index: number
  label: string
  kind: Event["kind"]
  /** What the agent is actually given: the rendered hook text. */
  deliveredChars: number
  /** Reference content sent in full on this event. */
  referenceCharsFull: number
  /** References answered with a pointer because the agent has already been given them. */
  pointers: number
  /** References sent whole. */
  full: number
  findings: number
  /** Findings the context budget left out. */
  omittedFindings: number
  omittedRules: number
  stop: Delivery["stop"]
  /** Whether this event told the agent it may not stop yet. */
  blocked: boolean
  /** A guard event that refused the write: the violation never reached the file. */
  refused: boolean
  /** Conventions arrived with nothing to correct — the agent was told before it could go wrong. */
  proactive: boolean
}

export interface RunMeasurement {
  steps: StepMeasurement[]
  totalDeliveredChars: number
  /** Extra turns rulecast forced: each block is one more round before the agent may stop. */
  blocks: number
  /** Writes refused before they landed. */
  refusals: number
  /** Deliveries that carried conventions and no findings. */
  proactive: number
  /** Deliveries that carried findings: rulecast correcting rather than preventing. */
  corrective: number
}

export interface ScenarioResult {
  name: string
  about: string
  steps: number
  /** The normal run: one session, so context memory applies. */
  withMemory: RunMeasurement
  /** The same steps with a fresh session each event, so nothing is remembered. */
  withoutMemory: RunMeasurement
  /** withoutMemory − withMemory, the characters context memory kept out of the agent's window. */
  savedChars: number
  savedTokens: number
  savedPercent: number
  /**
   * Per-event wall clock, measured in process: rulecast's own work, without the Node start-up a
   * hook also pays. `pnpm perf` is the authority on the end-to-end figure; this one says where the
   * time inside a single event goes.
   */
  wallClock: { p50: number; p95: number; max: number; total: number; perKind: Record<string, number> }
}

const registry = createRegistry([...builtinDetectors])

async function applyWrites(root: string, step: Step): Promise<void> {
  for (const [file, content] of Object.entries(step.write ?? {})) {
    await writeFile(path.join(root, file), content)
  }
}

function measureStep(index: number, step: Step, delivery: Delivery): StepMeasurement {
  const text = renderAgentText(delivery, { maxMatchesPerRule: 10 })
  const full = delivery.references.filter((reference) => reference.state === "full")
  return {
    index,
    label: step.label,
    kind: step.event.kind,
    deliveredChars: text.length,
    referenceCharsFull: full.reduce((sum, reference) => sum + (reference.content?.length ?? 0), 0),
    pointers: delivery.references.filter((reference) => reference.state === "pointer").length,
    full: full.length,
    findings: delivery.findings.length,
    omittedFindings: delivery.omitted.findings.reduce((sum, entry) => sum + entry.count, 0),
    omittedRules: delivery.omitted.rules,
    stop: delivery.stop,
    blocked: delivery.stop === "block",
    refused: step.event.kind === "guard" && text !== "",
    proactive: delivery.findings.length === 0 && (delivery.references.length > 0 || delivery.touches.length > 0),
  }
}

/**
 * Runs one scenario end to end.
 *
 * `freshSessionPerStep` is the counterfactual: a new session id each event means nothing is
 * remembered, which is what rulecast would deliver with no context memory at all. Running both
 * over identical files is what turns "saves tokens" into a number.
 */
async function runScenario(
  scenario: Scenario,
  home: string,
  options: { freshSessionPerStep: boolean; timed: boolean },
): Promise<{ run: RunMeasurement; times: { kind: string; ms: number }[] }> {
  const root = await createRepo(scenario.files)
  const project = await compile({ root, registry, repos: cachedRepos(home) })
  const stateDir = projectStateDir(home, root)
  const steps: StepMeasurement[] = []
  const times: { kind: string; ms: number }[] = []

  for (const [index, step] of scenario.steps.entries()) {
    await applyWrites(root, step)
    const session = { id: options.freshSessionPerStep ? `fresh-${index}` : "bench" }
    const event: Event = { ...step.event, cwd: root, session }
    const started = performance.now()
    const result = await runPipeline({
      project,
      stateDir,
      event,
      registry,
      maxContextChars: MAX_CONTEXT_CHARS,
      restoredFiles: RESTORED_FILES,
      stopGate: event.kind === "verify",
    })
    if (options.timed) times.push({ kind: event.kind, ms: performance.now() - started })
    steps.push(measureStep(index, step, result.delivery))
  }

  return {
    run: {
      steps,
      totalDeliveredChars: steps.reduce((sum, one) => sum + one.deliveredChars, 0),
      blocks: steps.filter((one) => one.blocked).length,
      refusals: steps.filter((one) => one.refused).length,
      proactive: steps.filter((one) => one.proactive).length,
      corrective: steps.filter((one) => one.findings > 0).length,
    },
    times,
  }
}

function percentiles(times: { kind: string; ms: number }[]): ScenarioResult["wallClock"] {
  const sorted = times.map((one) => one.ms).sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0
  const perKind: Record<string, number> = {}
  for (const { kind, ms } of times) perKind[kind] = (perKind[kind] ?? 0) + ms
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? 0,
    total: sorted.reduce((sum, ms) => sum + ms, 0),
    perKind,
  }
}

export async function measureScenario(scenario: Scenario): Promise<ScenarioResult> {
  // Its own cache home per scenario, so one measurement never warms or disturbs another.
  const home = mkdtempSync(path.join(tmpdir(), "rulecast-bench-"))

  const memory = await runScenario(scenario, home, { freshSessionPerStep: false, timed: true })
  const none = await runScenario(scenario, home, { freshSessionPerStep: true, timed: false })

  const savedChars = none.run.totalDeliveredChars - memory.run.totalDeliveredChars
  return {
    name: scenario.name,
    about: scenario.about,
    steps: scenario.steps.length,
    withMemory: memory.run,
    withoutMemory: none.run,
    savedChars,
    savedTokens: tokens(savedChars),
    savedPercent:
      none.run.totalDeliveredChars === 0 ? 0 : Math.round((savedChars / none.run.totalDeliveredChars) * 100),
    wallClock: percentiles(memory.times),
  }
}
