import { describe, expect, test } from "vitest"

import {
  type ClassifiedFinding,
  type DecideInput,
  delivers,
  findingKey,
  withoutRepeats,
} from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const errorRule = rule({ id: "api/no-client", message: "{{file}}:{{line}}" })
const finding: ClassifiedFinding = {
  rule: errorRule,
  match: { file: "a.py", line: 1, endLine: 1, column: 1, text: "x", captures: {} },
  id: "f1",
  status: "new",
}

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  const work = emptyWork()
  work.stopSent.set("main", new Map([[findingKey(finding), { rule: errorRule.id, file: "a.py", hash: "h1" }]]))
  return {
    agent: "main",
    findings: [finding],
    touches: [],
    agentRead: null,
    warnings: [],
    work,
    context: emptyContext(),
    resolver: fakeResolver({}),
    maxBytes: 32768,
    maxBlocks: 1,
    maxContextChars: null,
    maxMatchesPerRule: 10,
    stopGate: true,
    fileHashes: new Map([["a.py", "h1"]]),
    ...overrides,
  }
}

describe("decide: repeats and the shared budget", () => {
  // Several projects share one budget, each claiming a share only if it puts something before the
  // agent (PipelineOptions.shareBudget). A stop with only repeats puts nothing there.
  test("a stop with only repeats claims no share of the budget", () => {
    expect(delivers(withoutRepeats(input()))).toBe(false)
  })

  test("a finding in a changed file, or at an unattended stop, still claims one", () => {
    expect(delivers(withoutRepeats(input({ fileHashes: new Map([["a.py", "h2"]]) })))).toBe(true)
    expect(delivers(withoutRepeats(input({ mode: "unattended" })))).toBe(true)
    expect(delivers(withoutRepeats(input({ stopGate: false })))).toBe(true)
  })
})
