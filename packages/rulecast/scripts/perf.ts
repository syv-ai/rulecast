import { BUDGET_MS, type Measurement, measureEditHook } from "./perf-fixture"

const bold = (s: string) => `\u001B[1m${s}\u001B[0m`
const dim = (s: string) => `\u001B[2m${s}\u001B[0m`
const green = (s: string) => `\u001B[32m${s}\u001B[0m`
const red = (s: string) => `\u001B[31m${s}\u001B[0m`

const ms = (value: number) => `${value.toFixed(0)} ms`.padStart(7)

function report(result: Measurement): string {
  const headroom = Math.round((1 - result.p95 / BUDGET_MS) * 100)
  const pass = result.p95 < BUDGET_MS
  return [
    "",
    `${bold("rulecast edit hook")} ${dim(`· ${result.rules} rules · ${result.events} events`)}`,
    "",
    `  p50  ${ms(result.p50)}`,
    `  p95  ${ms(result.p95)}   ${dim(`budget ${BUDGET_MS} ms`)}`,
    `  max  ${ms(result.max)}`,
    "",
    pass
      ? `  ${green("✓")} ${headroom}% under budget`
      : `  ${red("✗")} over budget by ${(result.p95 - BUDGET_MS).toFixed(0)} ms`,
    "",
  ].join("\n")
}

const result = await measureEditHook()
process.stdout.write(report(result))
process.exitCode = result.p95 < BUDGET_MS ? 0 : 1
