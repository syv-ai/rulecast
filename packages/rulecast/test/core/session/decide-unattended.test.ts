import { describe, expect, test } from "vitest"

import { findingKey, gate, REPEAT_LIMIT } from "../../../src/core/session/decide"
import { foldWork, type WorkRecord } from "../../../src/core/session/state"
import { rule } from "../../helpers/rules"

const finding = (id: string, text: string, line = 1, severity: "error" | "warning" = "error") => ({
  rule: rule({ id, severity }),
  match: { file: "a.py", line, endLine: line, column: 1, text, captures: {} },
  id: `${id}:${line}:${text}`,
  status: "new" as const,
})

/** Runs the unattended gate over a sequence of stops, folding what each records into the next. */
function stops(sequence: ReturnType<typeof finding>[][], maxBlocks: number, between: WorkRecord[][] = []) {
  const records: WorkRecord[] = []
  return sequence.map((fresh, index) => {
    records.push(...(between[index] ?? []))
    const result = gate(fresh, foldWork(records), "main", maxBlocks, new Set(), "unattended")
    records.push(...result.work)
    return result.stop
  })
}

describe("gate, unattended", () => {
  test("blocks every stop with an error up to the budget, then holds once more to report", () => {
    const sequence = [1, 2, 3, 4, 5].map((n) => [finding("a/rule", `bad ${n}`)])
    expect(stops(sequence, 3)).toEqual(["block", "block", "block", "report", "capReached"])
  })

  test("records which findings blocked, so a repeat can be recognised", () => {
    const fresh = [finding("a/rule", "bad"), finding("a/rule", "bad", 9)]
    expect(gate(fresh, foldWork([]), "main", 3, new Set(), "unattended")).toEqual({
      stop: "block",
      work: [{ t: "stopBlock", agent: "main", findings: [findingKey(fresh[0]!)] }],
    })
  })

  test("a finding that blocked twice is reported instead, so a false positive cannot block-loop", () => {
    const same = [finding("a/rule", "x = eval(input)")]
    expect(REPEAT_LIMIT).toBe(2)
    expect(stops([same, same, same, same], 10)).toEqual(["block", "block", "report", "capReached"])
  })

  test("the same finding on a moved line is still the same finding", () => {
    expect(stops([[finding("a/rule", "x", 1)], [finding("a/rule", "x", 7)], [finding("a/rule", "x", 12)]], 10)).toEqual(
      ["block", "block", "report"],
    )
  })

  test("a new finding beside a repeated one still blocks, within the budget", () => {
    const old = finding("a/rule", "old")
    expect(stops([[old], [old], [old, finding("b/rule", "new")]], 10)).toEqual(["block", "block", "block"])
  })

  test("a prompt restores the budget and the report, but not a finding's repeat count", () => {
    const same = [finding("a/rule", "same")]
    const prompt: WorkRecord[] = [{ t: "prompt", agent: "main" }]
    expect(stops([same, same, same, same], 10, [[], [], [], prompt])).toEqual(["block", "block", "report", "report"])
  })

  test("warnings never block, and a budget of 0 goes straight to the report", () => {
    expect(stops([[finding("a/rule", "w", 1, "warning")]], 3)).toEqual(["allow"])
    expect(stops([[finding("a/rule", "e")], [finding("a/rule", "e")]], 0)).toEqual(["report", "capReached"])
  })

  test("attended, nothing of this applies: the record carries no findings and there is no report", () => {
    const fresh = [finding("a/rule", "bad")]
    expect(gate(fresh, foldWork([]), "main", 1)).toEqual({ stop: "block", work: [{ t: "stopBlock", agent: "main" }] })
    const after = foldWork([{ t: "stopBlock", agent: "main" }])
    expect(gate(fresh, after, "main", 1).stop).toBe("capReached")
  })
})

describe("gate, unattended, when configured rules did not run", () => {
  const incomplete = (fresh: ReturnType<typeof finding>[], work: WorkRecord[], agent = "main", mode = "unattended") =>
    gate(fresh, foldWork(work), agent, 10, new Set(), mode as "attended" | "unattended", true)

  test("the main agent is held once per prompt to say so, then let through", () => {
    const first = incomplete([], [])
    expect(first).toEqual({ stop: "incomplete", work: [{ t: "incompleteReport", agent: "main" }] })
    expect(incomplete([], first.work).stop).toBe("allow")
    expect(incomplete([], [...first.work, { t: "prompt", agent: "main" }]).stop).toBe("incomplete")
  })

  test("a block comes first: the findings are what the agent can act on", () => {
    expect(incomplete([finding("a/rule", "bad")], []).stop).toBe("block")
  })

  test("a capped stop that has had its report is held for what did not run", () => {
    const work: WorkRecord[] = [{ t: "stopReport", agent: "main" }]
    const same = finding("a/rule", "same")
    const blocked: WorkRecord[] = [
      { t: "stopBlock", agent: "main", findings: [findingKey(same)] },
      { t: "stopBlock", agent: "main", findings: [findingKey(same)] },
    ]
    expect(incomplete([same], [...blocked, ...work]).stop).toBe("incomplete")
  })

  test("never a subagent, and never attended", () => {
    expect(incomplete([], [], "agent-1").stop).toBe("allow")
    expect(incomplete([], [], "main", "attended").stop).toBe("allow")
  })
})
