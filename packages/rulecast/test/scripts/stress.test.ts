import { describe, expect, test } from "vitest"

import { measureScenario } from "../../scripts/stress/measure"
import { renderReport } from "../../scripts/stress/report"
import { SCENARIOS } from "../../scripts/stress/scenarios"
import { TARGETS } from "../../scripts/stress/types"
import { SCENARIOS as FIXTURES } from "./stress-fixtures"

const FIXTURE_MODULE = new URL("./stress-fixtures.ts", import.meta.url).href
const fixture = (name: string) => FIXTURES.find((one) => one.name === name)!

/**
 * The stress harness reports whether rulecast held. A harness that silently measured nothing would
 * report every scenario green and look like the best possible result, so its own machinery is
 * tested here — especially the classification, which is the only thing that turns a wedged process
 * into a finding rather than a wedged run.
 */
describe("the stress harness", () => {
  test("a scenario whose checks hold is ok, with its metrics carried through", async () => {
    const result = await measureScenario(fixture("fixture-passes"), FIXTURE_MODULE)

    expect(result.outcome).toBe("ok")
    expect(result.observation?.metrics).toEqual({ answer: 42 })
    expect(result.observation?.notes).toEqual(["a note"])
    expect(result.error).toBeNull()
  })

  test("a failing check is a finding, not an error: the scenario still reports its numbers", async () => {
    const result = await measureScenario(fixture("fixture-violates"), FIXTURE_MODULE)

    expect(result.outcome).toBe("violated")
    expect(result.observation?.metrics).toEqual({ measured: 900 })
    expect(result.observation?.checks.filter((check) => !check.ok)).toEqual([
      { name: "does not hold", ok: false, detail: "900 ms (limit 100 ms)" },
    ])
  })

  test("a scenario that throws is crashed, and its message survives", async () => {
    const result = await measureScenario(fixture("fixture-crashes"), FIXTURE_MODULE)

    expect(result.outcome).toBe("crashed")
    expect(result.error).toContain("scenario blew up")
    expect(result.observation).toBeNull()
  })

  // The reason the harness forks at all. This scenario blocks its own event loop, so no timer
  // inside it could fire; only a watchdog in another process can end it.
  test("a scenario that blocks its event loop is killed and reported as hung", async () => {
    const result = await measureScenario(fixture("fixture-hangs"), FIXTURE_MODULE)

    expect(result.outcome).toBe("hung")
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1_000)
    // Killed near its watchdog rather than run to its 60 s completion.
    expect(result.elapsedMs).toBeLessThan(20_000)
  }, 30_000)

  test("every real scenario is well formed and named once", () => {
    expect(SCENARIOS.length).toBeGreaterThan(0)
    expect(new Set(SCENARIOS.map((one) => one.name)).size).toBe(SCENARIOS.length)
    for (const scenario of SCENARIOS) {
      expect(TARGETS, scenario.name).toContain(scenario.target)
      expect(scenario.about.length, scenario.name).toBeGreaterThan(20)
      expect(scenario.timeoutMs, scenario.name).toBeGreaterThan(0)
    }
    // All four targets the stress work was scoped to are actually driven.
    expect(new Set(SCENARIOS.map((one) => one.target))).toEqual(new Set(TARGETS))
  })

  // One real scenario end to end: the fixtures above would pass even if `runEvent` were broken.
  test("a real scenario builds a repo, runs the pipeline and detects something", async () => {
    const result = await measureScenario(SCENARIOS.find((one) => one.name === "awkward-paths")!)

    expect(result.outcome).toBe("ok")
    expect(result.observation?.metrics.matched).toBe(result.observation?.metrics.paths)
    expect(result.observation?.metrics.matched).toBeGreaterThan(0)
  }, 90_000)

  test("the report renders one document naming every scenario and its outcome", async () => {
    const results = [
      await measureScenario(fixture("fixture-passes"), FIXTURE_MODULE),
      await measureScenario(fixture("fixture-violates"), FIXTURE_MODULE),
    ]
    const html = renderReport(results)

    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html.split("<html").length - 1).toBe(1)
    expect(html.split("<body").length - 1).toBe(1)
    for (const result of results) expect(html).toContain(result.name)
    // Identity is never colour alone: the outcome is spelled out.
    expect(html).toContain("violated")
    expect(html).toContain("<table")
  }, 30_000)
})
