/**
 * `pnpm stress` — drives rulecast under loads nobody designed it for and reports what broke.
 *
 * Each scenario runs in its own process under a watchdog (scripts/stress/measure.ts), so a
 * scenario that wedges is reported as `hung` instead of wedging the harness. Exit code is 1 when
 * anything hung, crashed or failed a check, so this can gate a branch if the user ever wants it to.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { measureScenario } from "./stress/measure"
import { renderReport } from "./stress/report"
import { SCENARIOS } from "./stress/scenarios"
import type { Outcome, ScenarioResult } from "./stress/types"

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const outDir = path.join(packageDir, "stress")

const bold = (s: string) => `\u001B[1m${s}\u001B[0m`
const dim = (s: string) => `\u001B[2m${s}\u001B[0m`
const red = (s: string) => `\u001B[31m${s}\u001B[0m`
const green = (s: string) => `\u001B[32m${s}\u001B[0m`
const yellow = (s: string) => `\u001B[33m${s}\u001B[0m`

const MARK: Record<Outcome, string> = {
  ok: green("ok      "),
  violated: yellow("violated"),
  crashed: red("crashed "),
  hung: red("hung    "),
}

/** A filter, so a single scenario can be re-run while working on it: `pnpm stress catastrophic`. */
const filters = process.argv.slice(2).filter((one) => !one.startsWith("-"))
const selected = SCENARIOS.filter((one) => filters.length === 0 || filters.some((f) => one.name.includes(f)))

if (selected.length === 0) {
  process.stderr.write(`no scenario matches ${filters.join(", ")}\n`)
  process.exit(2)
}

process.stdout.write(`\n${bold("rulecast stress")} ${dim(`· ${selected.length} scenarios, one process each`)}\n\n`)

const results: ScenarioResult[] = []
for (const scenario of selected) {
  process.stdout.write(`  ${dim("…")} ${scenario.name}`)
  const result = await measureScenario(scenario)
  results.push(result)
  const seconds = `${(result.elapsedMs / 1000).toFixed(1)} s`.padStart(8)
  process.stdout.write(`\r  ${MARK[result.outcome]} ${scenario.name.padEnd(26)}${dim(seconds)}\n`)
  for (const check of result.observation?.checks ?? []) {
    if (check.ok) continue
    process.stdout.write(`      ${red("✗")} ${check.name}: ${check.detail}\n`)
  }
  if (result.outcome === "hung") {
    process.stdout.write(`      ${red("✗")} still running at ${result.timeoutMs} ms; killed\n`)
  }
  if (result.outcome === "crashed" && result.error) {
    process.stdout.write(`      ${red("✗")} ${result.error.split("\n")[0]}\n`)
  }
}

const bad = results.filter((one) => one.outcome !== "ok")
process.stdout.write(
  `\n  ${bad.length === 0 ? green("all scenarios held") : bold(`${bad.length} of ${results.length} scenarios found something`)}\n`,
)

mkdirSync(outDir, { recursive: true })
const json = path.join(outDir, "results.json")
const html = path.join(outDir, "index.html")
writeFileSync(json, `${JSON.stringify({ generated: new Date().toISOString(), results }, null, 2)}\n`)
writeFileSync(html, renderReport(results))
process.stdout.write(
  `\n  ${dim("wrote")} ${path.relative(process.cwd(), json)}\n  ${dim("wrote")} ${path.relative(process.cwd(), html)}\n\n`,
)

process.exitCode = bad.length === 0 ? 0 : 1
