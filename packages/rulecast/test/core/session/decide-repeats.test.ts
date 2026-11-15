import { describe, expect, test } from "vitest"
import { repeatedLine } from "../../../src/core/delivery/render-agent"
import {
  type ClassifiedFinding,
  type DecideInput,
  decide,
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

describe("decide: what a stop says of its repeats (#90)", () => {
  const key = findingKey(finding)
  const said = (overrides: Partial<DecideInput>) => {
    const base = input(overrides)
    base.work.repeatsSaid.set("main", new Set([key]))
    return base
  }

  test("a repeat whose rule did not run on its file is not fixed: nothing is said, nothing recorded", async () => {
    const decided = await decide(said({ findings: [], stopRan: new Map() }))
    expect(decided.delivery.repeatedFixed).toBeUndefined()
    expect(decided.work.filter((record) => record.t === "repeatsSaid")).toEqual([])
  })

  test("one whose rule ran on its file and did not find it is fixed, said plainly", async () => {
    const decided = await decide(said({ findings: [], stopRan: new Map([[errorRule.id, ["a.py"]]]) }))
    expect(decided.delivery.repeatedFixed).toEqual({ fixed: 1, of: 1 })
    expect(repeatedLine(decided.delivery)).toBe("The earlier finding is fixed.")
    expect(repeatedLine({ repeatedFixed: { fixed: 3, of: 3 } })).toBe("All 3 earlier findings are fixed.")
    expect(repeatedLine({ repeatedFixed: { fixed: 1, of: 3 } })).toBe("1 of the 3 earlier findings is fixed.")
  })

  test("the count is said only at a block: a capped or allowed stop carries none", async () => {
    const allowed = await decide(said({}))
    expect(allowed.delivery.stop).toBe("allow")
    expect(allowed.delivery.repeatedCount).toBeUndefined()
    const other: ClassifiedFinding = { ...finding, id: "f2", match: { ...finding.match, file: "b.py" } }
    const work = emptyWork()
    work.stopSent.set("main", new Map([[key, { rule: errorRule.id, file: "a.py", hash: "h1" }]]))
    work.repeatsSaid.set("main", new Set([key]))
    work.stopBlocks.set("main", 1)
    const capped = await decide(input({ work, findings: [finding, other], fileHashes: new Map([["a.py", "h1"]]) }))
    expect(capped.delivery.stop).toBe("capReached")
    expect(capped.delivery.repeatedCount).toBeUndefined()
  })

  test("findings with one key are counted once, as the list and the fixes count them", async () => {
    const twin: ClassifiedFinding = { ...finding, id: "f1b", match: { ...finding.match, line: 7 } }
    const work = emptyWork()
    work.stopSent.set("main", new Map([[key, { rule: errorRule.id, file: "a.py", hash: "h1" }]]))
    work.repeatsSaid.set("main", new Set([key]))
    const newOne: ClassifiedFinding = { ...finding, id: "n", match: { ...finding.match, file: "b.py", text: "y" } }
    const block = await decide(
      input({ work, findings: [finding, twin, newOne], fileHashes: new Map([["a.py", "h1"]]) }),
    )
    expect(block.delivery.stop).toBe("block")
    expect(block.delivery.repeatedCount).toEqual({ count: 1, rules: [errorRule.id] })
  })

  test("several projects: one's list and another's count are both said", () => {
    expect(
      repeatedLine({ repeated: [{ rule: "a/r", file: "x.py" }], repeatedCount: { count: 2, rules: ["b/r"] } }),
    ).toBe(
      "Still there from earlier stops, not repeated here: a/r (x.py). 2 findings from earlier stops are still there (b/r).",
    )
  })
})
