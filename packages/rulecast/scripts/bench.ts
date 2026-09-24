import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { measureScenario, type ScenarioResult, tokens } from "./bench/measure"
import { renderReport } from "./bench/report"
import { SCENARIOS } from "./bench/scenarios"
import { BUDGET_MS, type Measurement, measureEditHook } from "./perf-fixture"

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const outDir = path.join(packageDir, "bench")

const bold = (s: string) => `\u001B[1m${s}\u001B[0m`
const dim = (s: string) => `\u001B[2m${s}\u001B[0m`
const green = (s: string) => `\u001B[32m${s}\u001B[0m`

const num = (value: number, width = 7) => value.toLocaleString("en-US").padStart(width)

function line(result: ScenarioResult): string {
  const saved = `${green(num(result.savedTokens))} ${dim(`(${result.savedPercent}%)`)}`
  return [
    `  ${result.name.padEnd(22)}`,
    num(result.steps, 5),
    num(tokens(result.withoutMemory.totalDeliveredChars)),
    num(tokens(result.withMemory.totalDeliveredChars)),
    `  ${saved}`,
    `  ${result.wallClock.p50.toFixed(1).padStart(6)} ms`,
    `  ${num(result.withMemory.blocks, 3)}`,
  ].join("")
}

/**
 * `--hook` adds the end-to-end figure: the built CLI spawned as Claude Code spawns it, so the
 * number includes Node start-up and config compile. It builds and replays 50 hooks, so it is off
 * by default; without it the report carries only rulecast's in-process work per event.
 */
const withHook = process.argv.includes("--hook")

const results: ScenarioResult[] = []
for (const scenario of SCENARIOS) results.push(await measureScenario(scenario))

let hook: (Measurement & { budgetMs: number }) | null = null
if (withHook) {
  process.stdout.write(`\n${dim("  measuring the end-to-end hook (builds, then replays 50 events)…")}\n`)
  hook = { ...(await measureEditHook()), budgetMs: BUDGET_MS }
}

const header = [
  "",
  bold("rulecast benchmark"),
  dim("  tokens are characters ÷ 4; delivered = what the agent is actually given"),
  "",
  dim(
    `  ${"scenario".padEnd(22)}${"steps".padStart(5)}${"no mem".padStart(7)}${"rulecast".padStart(7)}${"  saved".padEnd(16)}${"  p50".padEnd(11)}${"blocks".padStart(5)}`,
  ),
].join("\n")

const totalSaved = results.reduce((sum, one) => sum + one.savedTokens, 0)
process.stdout.write(
  [
    header,
    ...results.map(line),
    "",
    `  ${bold(`${totalSaved.toLocaleString("en-US")} tokens`)} not re-sent across all scenarios`,
    "",
  ].join("\n"),
)

if (hook !== null) {
  process.stdout.write(
    `\n  ${bold("end-to-end hook")} ${dim(`· ${hook.rules} rules · ${hook.events} events`)}\n` +
      `    p50 ${hook.p50.toFixed(0).padStart(4)} ms   p95 ${hook.p95.toFixed(0).padStart(4)} ms   ${dim(`budget ${hook.budgetMs} ms`)}\n`,
  )
}

mkdirSync(outDir, { recursive: true })
const json = path.join(outDir, "results.json")
const html = path.join(outDir, "index.html")
writeFileSync(json, `${JSON.stringify({ generated: new Date().toISOString(), results, hook }, null, 2)}\n`)
writeFileSync(html, renderReport(results, hook))
process.stdout.write(
  `\n  ${dim("wrote")} ${path.relative(process.cwd(), json)}\n  ${dim("wrote")} ${path.relative(process.cwd(), html)}\n\n`,
)
