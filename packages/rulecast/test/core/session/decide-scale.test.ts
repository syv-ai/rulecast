import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { type DecideInput, decide } from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

/**
 * One rule firing tens of thousands of times in one file, which is what an ordinary pattern does to
 * a generated or minified file. `decide` and `renderAgentText` both grouped findings by rule with
 * `map.set(id, [...(map.get(id) ?? []), finding])`, copying the whole array once per finding — so
 * the cost grew with the square of the matches while every other phase stayed linear.
 *
 * Measured before the fix, through the real pipeline on one file: 16k matches 368 ms, 31k matches
 * 1.9 s, 62k matches 5.9 s, and an 8 MB file never finished inside a 60 s watchdog. The edit
 * deadline is 350 ms and cannot preempt it, because the work is synchronous (§13).
 *
 * The assertion is a time limit, which is unusual and deliberate: the defect is only visible as a
 * curve, and an assertion on the output alone would have passed throughout. The limit is loose
 * enough that machine load cannot reach it — quadratic behaviour here is seconds, not milliseconds.
 */
const resolver = fakeResolver({})

const at = (line: number): Match => ({
  file: "src/generated.ts",
  line,
  endLine: line,
  column: 1,
  text: `compute(${line})`,
  captures: { n: String(line) },
})

function input(count: number, overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    agent: "main",
    findings: Array.from({ length: count }, (_, index) => ({
      rule: rule({ id: "scale/compute", message: "{{file}}:{{line}} calls compute({{n}})" }),
      match: at(index + 1),
      status: "new" as const,
    })),
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver,
    maxBytes: 32768,
    maxBlocks: 3,
    maxContextChars: 9000,
    maxMatchesPerRule: 10,
    stopGate: false,
    ...overrides,
  }
}

describe("decide: one rule with very many matches", () => {
  test("grouping 60,000 findings of one rule stays linear", { timeout: 60_000 }, async () => {
    const started = performance.now()
    const { delivery } = await decide(input(60_000))
    const elapsed = performance.now() - started

    // The budget still does its job: ten matches shown, the rest counted.
    expect(delivery.findings).toHaveLength(10)
    expect(delivery.omitted.findings).toEqual([{ rule: "scale/compute", count: 59_990, files: 0 }])
    expect(elapsed).toBeLessThan(4_000)
  })

  test("rendering 60,000 findings of one rule stays linear", { timeout: 60_000 }, () => {
    const findings = Array.from({ length: 60_000 }, (_, index) => ({
      rule: "scale/compute",
      severity: "error" as const,
      status: "new" as const,
      file: "src/generated.ts",
      line: index + 1,
      column: 1,
      message: `src/generated.ts:${index + 1} calls compute(${index + 1})`,
      count: 1,
    }))
    const started = performance.now()
    const text = renderAgentText(
      {
        findings,
        preexistingSummary: [],
        warnings: [],
        touches: [],
        references: [],
        templates: {},
        omitted: { findings: [], rules: 0, preexisting: 0 },
        stop: null,
        overflowPath: null,
      },
      { maxMatchesPerRule: 10 },
    )
    const elapsed = performance.now() - started

    expect(text).toContain("scale/compute")
    expect(elapsed).toBeLessThan(4_000)
  })
})
