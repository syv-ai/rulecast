import {
  BUDGET_MS,
  type Measurement,
  measureEditHook,
  measureShellHooks,
  SHELL_BEFORE_ADDED_MS,
  type ShellMeasurement,
} from "./perf-fixture"

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

function shellReport(result: ShellMeasurement): { text: string; pass: boolean } {
  const added = result.before.p95 - result.floor.p95
  const beforePass = added <= SHELL_BEFORE_ADDED_MS
  const afterPass = result.after.p95 < BUDGET_MS
  const row = (name: string, m: Measurement) => `  ${name.padEnd(13)}${ms(m.p50)}  ${ms(m.p95)}  ${ms(m.max)}`
  const verdict = (pass: boolean, text: string) => `  ${pass ? green("✓") : red("✗")} ${text}`
  const text = [
    `${bold("rulecast Bash hooks")} ${dim(`· ${result.after.rules} rules · ${result.dirty} dirty files · ${result.after.events} calls`)}`,
    "",
    dim("                   p50      p95      max"),
    row("before", result.before),
    row("after", result.after),
    row("floor", result.floor),
    "",
    verdict(beforePass, `before adds ${added.toFixed(0)} ms at p95 over the floor (limit ${SHELL_BEFORE_ADDED_MS} ms)`),
    verdict(afterPass, `after ${result.after.p95.toFixed(0)} ms at p95 (budget ${BUDGET_MS} ms)`),
    "",
  ].join("\n")
  return { text, pass: beforePass && afterPass }
}

const result = await measureEditHook()
process.stdout.write(report(result))
const shell = shellReport(await measureShellHooks())
process.stdout.write(`\n${shell.text}`)
process.exitCode = result.p95 < BUDGET_MS && shell.pass ? 0 : 1
