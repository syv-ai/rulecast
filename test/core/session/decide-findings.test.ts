import { describe, expect, test } from "vitest"

import { type DecideInput, decide } from "../../../src/core/session/decide"
import { emptyContext, emptyWork, preexistingKey } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const at = (file: string, line: number, captures: Record<string, string> = {}): Match => ({
  file,
  line,
  endLine: line,
  column: 3,
  text: "x",
  captures,
})

const errorRule = rule({ id: "api/no-client", message: "{{file}}:{{line}} imports {{NAMES}}" })
const warningRule = rule({ id: "style/warn", severity: "warning", message: "consider {{rule}}" })

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    agent: "main",
    findings: [],
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver: fakeResolver({}),
    maxBytes: 32768,
    maxBlocks: 3,
    maxContextChars: null,
    stopGate: false,
    ...overrides,
  }
}

describe("decide: findings", () => {
  test("renders messages, merges identical findings and orders errors first", async () => {
    const { delivery } = await decide(
      input({
        findings: [
          { rule: warningRule, match: at("b.ts", 9), status: "new" },
          { rule: errorRule, match: at("a.ts", 3, { NAMES: "Docs" }), status: "new" },
          { rule: errorRule, match: at("a.ts", 3, { NAMES: "Docs" }), status: "new" },
        ],
      }),
    )
    expect(delivery.findings).toEqual([
      {
        rule: "api/no-client",
        severity: "error",
        status: "new",
        file: "a.ts",
        line: 3,
        column: 3,
        message: "a.ts:3 imports Docs",
        count: 2,
      },
      {
        rule: "style/warn",
        severity: "warning",
        status: "new",
        file: "b.ts",
        line: 9,
        column: 3,
        message: "consider style/warn",
        count: 1,
      },
    ])
  })

  test("pre-existing findings become one summary per rule and file, once per context", async () => {
    const findings = [
      { rule: errorRule, match: at("a.ts", 1, { NAMES: "A" }), status: "preexisting" as const },
      { rule: errorRule, match: at("a.ts", 7, { NAMES: "B" }), status: "preexisting" as const },
      { rule: errorRule, match: at("b.ts", 2, { NAMES: "C" }), status: "preexisting" as const },
    ]
    const first = await decide(input({ findings }))
    expect(first.delivery.findings).toEqual([])
    expect(first.delivery.preexistingSummary).toEqual([
      { rule: "api/no-client", file: "a.ts", count: 2 },
      { rule: "api/no-client", file: "b.ts", count: 1 },
    ])
    expect(first.context).toEqual([
      { t: "preexisting", rule: "api/no-client", file: "a.ts" },
      { t: "preexisting", rule: "api/no-client", file: "b.ts" },
    ])

    const context = emptyContext()
    context.preexisting.add(preexistingKey("api/no-client", "a.ts"))
    const second = await decide(input({ findings, context }))
    expect(second.delivery.preexistingSummary).toEqual([{ rule: "api/no-client", file: "b.ts", count: 1 }])
  })

  test("warnings are delivered once per context", async () => {
    const context = emptyContext()
    context.warned.add("seen")
    const { delivery, context: records } = await decide(
      input({
        context,
        warnings: [
          { key: "seen", text: "old" },
          { key: "fresh", text: "new problem" },
        ],
      }),
    )
    expect(delivery.warnings).toEqual(["new problem"])
    expect(records).toEqual([{ t: "warned", key: "fresh" }])
  })
})

describe("decide: stop gate", () => {
  const newError = { rule: errorRule, match: at("a.ts", 3, { NAMES: "X" }), status: "new" as const }
  const newWarning = { rule: warningRule, match: at("a.ts", 4), status: "new" as const }

  test("null when not a stop", async () => {
    expect((await decide(input({ findings: [newError] }))).delivery.stop).toBeNull()
  })

  test("allow without new errors", async () => {
    const decision = await decide(input({ stopGate: true, findings: [newWarning] }))
    expect(decision.delivery.stop).toBe("allow")
    expect(decision.work).toEqual([])
  })

  test("block with new errors below the cap, and count the block", async () => {
    const decision = await decide(input({ stopGate: true, agent: "sub1", findings: [newError] }))
    expect(decision.delivery.stop).toBe("block")
    expect(decision.work).toEqual([{ t: "stopBlock", agent: "sub1" }])
  })

  test("capReached at the cap", async () => {
    const work = emptyWork()
    work.stopBlocks.set("main", 3)
    const decision = await decide(input({ stopGate: true, work, findings: [newError] }))
    expect(decision.delivery.stop).toBe("capReached")
    expect(decision.work).toEqual([])
  })
})
