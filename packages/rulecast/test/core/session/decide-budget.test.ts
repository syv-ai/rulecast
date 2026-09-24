import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { parseReference } from "../../../src/core/references"
import { type DecideInput, decide } from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const MESSAGE = "{{file}}:{{line}} returns HTTP {{status}} straight from the service layer. Raise a domain exception."

const files = {
  "conventions/backend.md#errors": "## Errors\nServices raise domain exceptions.",
  "conventions/codegen.md#client": "## Client\nGenerated. Change the schema.",
}
const resolver = fakeResolver(files)
const ref = (text: string) => parseReference(text, "inject", { dir: "/project", label: null })

const at = (file: string, line: number, status: string): Match => ({
  file,
  line,
  endLine: line,
  column: 1,
  text: "raise",
  captures: { status },
})

const violation = (id: string, file: string, line: number, context: ReturnType<typeof ref>[] = []) => ({
  rule: rule({ id, message: MESSAGE, context }),
  match: at(file, line, "404"),
  status: "new" as const,
})

function input(overrides: Partial<DecideInput>): DecideInput {
  return {
    agent: "main",
    findings: [],
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver,
    maxBytes: 32768,
    maxBlocks: 3,
    maxContextChars: null,
    maxMatchesPerRule: 10,
    stopGate: false,
    ...overrides,
  }
}

const manyIn = (id: string, file: string, count: number, context: ReturnType<typeof ref>[] = []) =>
  Array.from({ length: count }, (_, index) => violation(id, file, index + 1, context))

describe("decide: the context budget", () => {
  test("without a limit nothing is trimmed: json and sarif get every finding", async () => {
    const { delivery, overflow } = await decide(input({ findings: manyIn("r", "a.py", 40) }))
    expect(delivery.findings).toHaveLength(40)
    expect(delivery.omitted).toEqual({ findings: [], rules: 0, preexisting: 0 })
    expect(overflow).toBeNull()
  })

  test("a rule's repeats are cut before the section that explains it", async () => {
    const { delivery } = await decide(
      input({
        maxContextChars: 420,
        findings: manyIn("backend/no-httpexception", "a.py", 20, [ref("@conventions/backend.md#errors")]),
      }),
    )
    expect(delivery.findings.length).toBeGreaterThanOrEqual(1)
    expect(delivery.findings.length).toBeLessThan(20)
    expect(delivery.references).toEqual([
      { ref: "conventions/backend.md#errors", state: "full", content: files["conventions/backend.md#errors"] },
    ])
    expect(delivery.omitted.findings).toEqual([
      { rule: "backend/no-httpexception", count: 20 - delivery.findings.length, files: 0 },
    ])
  })

  test("every rule that fired keeps a finding: one noisy rule cannot crowd out the others", async () => {
    const { delivery } = await decide(
      input({
        maxContextChars: 700,
        findings: [...manyIn("a/loud", "a.py", 30), ...manyIn("b/quiet", "b.py", 1), ...manyIn("c/quiet", "c.py", 1)],
      }),
    )
    expect([...new Set(delivery.findings.map((finding) => finding.rule))]).toEqual(["a/loud", "b/quiet", "c/quiet"])
    expect(delivery.omitted.rules).toBe(0)
  })

  test("pre-existing summaries are cut before a rule's first finding, and are not recorded as delivered", async () => {
    const preexisting = Array.from({ length: 30 }, (_, index) => ({
      rule: rule({ id: "old/rule", message: MESSAGE }),
      match: at(`old${index}.py`, 1, "404"),
      status: "preexisting" as const,
    }))
    const { delivery, context } = await decide(
      input({ maxContextChars: 500, findings: [...manyIn("new/rule", "a.py", 1), ...preexisting] }),
    )
    expect(delivery.findings).toHaveLength(1)
    expect(delivery.omitted.preexisting).toBeGreaterThan(0)
    expect(context.filter((record) => record.t === "preexisting")).toHaveLength(delivery.preexistingSummary.length)
  })

  test("when the floor itself does not fit, the rules dropped are counted and the whole delivery is returned", async () => {
    const findings = Array.from({ length: 12 }, (_, index) => violation(`rule/number-${index}`, `f${index}.py`, 1))
    const { delivery, overflow } = await decide(input({ maxContextChars: 600, findings }))
    expect(delivery.omitted.rules).toBeGreaterThan(0)
    expect(new Set(delivery.findings.map((finding) => finding.rule)).size).toBe(12 - delivery.omitted.rules)
    expect(overflow).not.toBeNull()
    expect(overflow!.findings).toHaveLength(12)
    expect(overflow!.omitted).toEqual({ findings: [], rules: 0, preexisting: 0 })
  })

  test("what the renderer produces stays inside the limit the budget was given", async () => {
    const { delivery } = await decide(
      input({
        maxContextChars: 900,
        findings: [
          ...manyIn("backend/one", "a.py", 40, [ref("@conventions/backend.md#errors")]),
          ...manyIn("codegen/two", "b.ts", 40, [ref("@conventions/codegen.md#client")]),
        ],
      }),
    )
    expect(delivery.findings.length).toBeLessThan(80)
    expect(renderAgentText(delivery, { maxMatchesPerRule: 10 }).length).toBeLessThanOrEqual(900)
  })
})

/**
 * Warnings used to be charged before anything else and were never dropped, so enough of them could
 * empty the floor: stress testing measured 80 broken rules as 13,500 characters against a 9,000
 * character budget, with the one rule that fired dropped whole. Summarising them at the source
 * fixes the case that was measured; this is the invariant that stops it recurring from a warning
 * kind nobody has thought of yet.
 */
describe("decide: warnings are charged after the floor", () => {
  const noisy = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      key: `detector:${index}`,
      text: `llm detector failed for rule-${index}: the provider returned 429. Disabled for this session.`,
    }))

  test("a warning never displaces a finding", async () => {
    const { delivery } = await decide(
      input({ maxContextChars: 9000, warnings: noisy(80), findings: manyIn("works/compute", "a.py", 1) }),
    )
    expect(delivery.findings).toHaveLength(1)
    expect(delivery.omitted.rules).toBe(0)
  })

  test("even a floor that fills the budget leaves the warnings no room to displace it", async () => {
    const findings = Array.from({ length: 12 }, (_, index) => violation(`rule/number-${index}`, `f${index}.py`, 1))
    const withWarnings = await decide(input({ maxContextChars: 600, warnings: noisy(80), findings }))
    const without = await decide(input({ maxContextChars: 600, findings }))
    expect(withWarnings.delivery.omitted.rules).toBe(without.delivery.omitted.rules)
  })

  test("the warnings kept stay under their share of the budget, and the rest are counted", async () => {
    const { delivery } = await decide(
      input({ maxContextChars: 9000, warnings: noisy(80), findings: manyIn("works/compute", "a.py", 1) }),
    )
    expect(delivery.warnings.length).toBeLessThan(80)
    expect(delivery.warnings.at(-1)).toMatch(/^…and \d+ more \(run rulecast validate\)$/)
    const chars = delivery.warnings.reduce((sum, text) => sum + text.length, 0)
    expect(chars).toBeLessThanOrEqual(9000 * 0.15)
  })

  test("a warning the budget cut is not recorded as warned, so it is announced again", async () => {
    const { delivery, context } = await decide(
      input({ maxContextChars: 9000, warnings: noisy(80), findings: manyIn("works/compute", "a.py", 1) }),
    )
    const warned = context.flatMap((record) => (record.t === "warned" ? [record.key] : []))
    // The trailing "…and N more" is not a warning anyone can key on; every other line is.
    expect(warned).toEqual(
      noisy(80)
        .slice(0, delivery.warnings.length - 1)
        .map((warning) => warning.key),
    )
  })

  test("without a limit every warning is delivered", async () => {
    const { delivery, context } = await decide(input({ warnings: noisy(80) }))
    expect(delivery.warnings).toHaveLength(80)
    expect(context.filter((record) => record.t === "warned")).toHaveLength(80)
  })

  test("the overflow file keeps the warnings the budget cut", async () => {
    const findings = Array.from({ length: 12 }, (_, index) => violation(`rule/number-${index}`, `f${index}.py`, 1))
    const { delivery, overflow } = await decide(input({ maxContextChars: 600, warnings: noisy(80), findings }))
    expect(delivery.warnings.length).toBeLessThan(80)
    expect(overflow).not.toBeNull()
    expect(overflow!.warnings).toHaveLength(80)
  })

  test("what the renderer produces stays inside the limit, warnings included", async () => {
    const { delivery } = await decide(
      input({
        maxContextChars: 900,
        warnings: noisy(40),
        findings: manyIn("backend/one", "a.py", 40, [ref("@conventions/backend.md#errors")]),
      }),
    )
    expect(renderAgentText(delivery, { maxMatchesPerRule: 10 }).length).toBeLessThanOrEqual(900)
  })
})
