/**
 * The child half of the harness: runs exactly one scenario and prints its observation.
 *
 * It exists as a separate process because the thing being measured is whether rulecast can be made
 * to stop responding. A scenario that blocks its event loop cannot be timed out from inside it —
 * that is the defect class this harness was built to catch — so the watchdog has to live in a
 * process whose event loop is still turning.
 *
 * The scenario module is an argument rather than a fixed import so the harness's own test can drive
 * it with scenarios that hang, throw and fail a check on purpose, through this same path.
 */
import { RESULT_PREFIX, type Scenario } from "./types"

const [module, name] = process.argv.slice(2)
if (module === undefined || name === undefined) {
  process.stderr.write("usage: runner.ts <scenario-module> <scenario-name>\n")
  process.exit(2)
}

const { SCENARIOS } = (await import(module)) as { SCENARIOS: readonly Scenario[] }
const scenario = SCENARIOS.find((one) => one.name === name)
if (scenario === undefined) {
  process.stderr.write(`unknown scenario "${name}"\n`)
  process.exit(2)
}

try {
  const observation = await scenario.run()
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(observation)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
}
