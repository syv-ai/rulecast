import { describe, expect, test } from "vitest"

import { measureScenario, tokens } from "../../scripts/bench/measure"
import { renderReport, renderReportFragment } from "../../scripts/bench/report"
import { SCENARIOS } from "../../scripts/bench/scenarios"

/**
 * The benchmark measures a claim, so its own machinery has to be checked: a harness that silently
 * measured nothing would report a saving of zero and look like a result.
 */
describe("benchmark", () => {
  test("every scenario runs and delivers something to the agent", { timeout: 120_000 }, async () => {
    for (const scenario of SCENARIOS) {
      const result = await measureScenario(scenario)
      expect(result.withMemory.steps, scenario.name).toHaveLength(scenario.steps.length)
      expect(result.withoutMemory.steps, scenario.name).toHaveLength(scenario.steps.length)
      expect(result.withMemory.totalDeliveredChars, scenario.name).toBeGreaterThan(0)
      expect(Number.isFinite(result.savedPercent), scenario.name).toBe(true)
    }
  })

  // The whole point of the A/B: a session that remembers must send less than one that does not.
  test("session memory sends strictly less than a memoryless run", { timeout: 120_000 }, async () => {
    const sustained = SCENARIOS.find((scenario) => scenario.name === "sustained-edit")
    expect(sustained).toBeDefined()
    const result = await measureScenario(sustained!)

    expect(result.savedChars).toBeGreaterThan(0)
    expect(result.withMemory.totalDeliveredChars).toBeLessThan(result.withoutMemory.totalDeliveredChars)
    // A reference delivered on the first turn comes back as a pointer later.
    expect(result.withMemory.steps.some((step) => step.pointers > 0)).toBe(true)
    expect(result.withoutMemory.steps.every((step) => step.pointers === 0)).toBe(true)
  })

  test("the guard scenario refuses a write, and the refuse gate lets the next one through", {
    timeout: 120_000,
  }, async () => {
    const guarded = SCENARIOS.find((scenario) => scenario.name === "refused-writes")
    expect(guarded).toBeDefined()
    const result = await measureScenario(guarded!)

    // max_refusals defaults to 1 per rule per file per session: the first attempt is refused, the
    // second is not, because an agent that cannot write and cannot learn why would be stuck.
    expect(result.withMemory.refusals).toBe(1)
  })

  test("tokens are characters divided by the stated divisor", () => {
    expect(tokens(400)).toBe(100)
    expect(tokens(0)).toBe(0)
  })

  test("the report renders one document, with a table view of every scenario", { timeout: 120_000 }, async () => {
    const results = [await measureScenario(SCENARIOS[0]!)]
    const html = renderReport(results, null)

    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html.split("<html").length - 1).toBe(1)
    expect(html.split("<body>").length - 1).toBe(1)
    // Identity is never colour alone, and nothing is gated behind a chart.
    expect(html).toContain("<table")
    expect(html).toContain("Table view")
    expect(html).toContain(results[0]!.name)
    // Both themes are defined, and neither is only a media query.
    expect(html).toContain("prefers-color-scheme: dark")
    expect(html).toContain('[data-theme="dark"]')
    expect(html).not.toContain("NaN")
    expect(html).not.toContain("undefined")
  })

  test("the fragment carries no document skeleton, so a host can supply its own", { timeout: 120_000 }, async () => {
    const fragment = renderReportFragment([await measureScenario(SCENARIOS[0]!)], null)

    expect(fragment).not.toContain("<!doctype")
    expect(fragment).not.toContain("<html")
    expect(fragment).not.toContain("<body")
    expect(fragment).toContain("<title>")
    expect(fragment).toContain('<div class="wrap">')
  })
})
