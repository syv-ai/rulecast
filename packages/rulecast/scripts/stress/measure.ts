import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { type Observation, RESULT_PREFIX, type Scenario, type ScenarioResult } from "./types"

const runner = fileURLToPath(new URL("./runner.ts", import.meta.url))
/** So the child resolves `tsx` from the package's node_modules whatever the parent's cwd is. */
const packageDir = fileURLToPath(new URL("../../", import.meta.url))

/** Where the child looks the scenario up. Overridden only by the harness's own test. */
export const SCENARIOS_MODULE = new URL("./scenarios.ts", import.meta.url).href

/** Grace between SIGTERM and SIGKILL. A blocked event loop ignores SIGTERM, which is the point. */
const KILL_GRACE_MS = 250

function parseObservation(stdout: string): Observation | null {
  const line = stdout.split("\n").find((one) => one.startsWith(RESULT_PREFIX))
  if (line === undefined) return null
  try {
    return JSON.parse(line.slice(RESULT_PREFIX.length)) as Observation
  } catch {
    return null
  }
}

/**
 * Runs one scenario in its own process, under a watchdog.
 *
 * The watchdog is the whole reason for the process boundary. A scenario that blocks its own event
 * loop — one synchronous regex, one enormous file — cannot time itself out, so a harness that ran
 * scenarios in-process would hang on exactly the defect it exists to find, and report nothing.
 */
export async function measureScenario(scenario: Scenario, module = SCENARIOS_MODULE): Promise<ScenarioResult> {
  const started = Date.now()
  // tsx is named rather than inherited from execArgv: the harness's own test runs this under
  // vitest, whose execArgv has no TypeScript loader, and the child would fail to import a .ts
  // scenario at all — which would look exactly like a crashed scenario.
  const child = spawn(process.execPath, ["--import", "tsx", runner, module, scenario.name], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: packageDir,
  })

  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  let timedOut = false
  const watchdog = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref()
  }, scenario.timeoutMs)

  const code = await new Promise<number | null>((resolve) => {
    child.on("close", (status) => resolve(status))
    child.on("error", () => resolve(null))
  })
  clearTimeout(watchdog)

  const elapsedMs = Date.now() - started
  const base = {
    name: scenario.name,
    about: scenario.about,
    target: scenario.target,
    elapsedMs,
    timeoutMs: scenario.timeoutMs,
  }

  if (timedOut) return { ...base, outcome: "hung", observation: null, error: stderr.trim() || null }

  const observation = parseObservation(stdout)
  if (code !== 0 || observation === null) {
    const why = observation === null && code === 0 ? "the scenario printed no observation" : stderr.trim()
    return { ...base, outcome: "crashed", observation, error: why || `exit ${code}` }
  }

  const failed = observation.checks.some((check) => !check.ok)
  return { ...base, outcome: failed ? "violated" : "ok", observation, error: null }
}

/** Every scenario, in order. Sequential on purpose: one scenario's load must not be another's. */
export async function measureAll(scenarios: readonly Scenario[], module = SCENARIOS_MODULE): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  for (const scenario of scenarios) results.push(await measureScenario(scenario, module))
  return results
}
