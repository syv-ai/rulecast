import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { decide, gate } from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const at = (file: string, line: number): Match => ({ file, line, endLine: line, column: 1, text: "", captures: {} })
const finding = (file: string, line = 1, severity: "error" | "warning" = "error", id = "a/rule") => ({
  rule: rule({ id, severity }),
  match: at(file, line),
  status: "new" as const,
})

describe("gate: files changed outside the agent's tool calls", () => {
  test("their findings never block, whatever the severity", () => {
    expect(gate([finding("user.py")], emptyWork(), "main", 3, new Set(["user.py"])).stop).toBe("allow")
  })

  test("the agent's own error still blocks beside them", () => {
    const fresh = [finding("user.py"), finding("mine.py")]
    expect(gate(fresh, emptyWork(), "main", 3, new Set(["user.py"])).stop).toBe("block")
  })

  test("without a swept set the gate is as before", () => {
    expect(gate([finding("user.py")], emptyWork(), "main", 3).stop).toBe("block")
  })
})

describe("gate: refuse_write under the shell", () => {
  const protectedFinding = (file: string) => ({
    rule: rule({ id: "client/generated", severity: "warning", refuseWrite: true }),
    match: at(file, 1),
    status: "new" as const,
  })
  const workWith = (via: "tool" | "shell") => ({ ...emptyWork(), editedVia: new Map([["api.ts", via]]) })

  test("a warning blocks when the file was changed with the shell", () => {
    expect(gate([protectedFinding("api.ts")], workWith("shell"), "main", 3).stop).toBe("block")
  })

  test("the stop-block cap applies as for any block", () => {
    const work = { ...workWith("shell"), stopBlocks: new Map([["main", 3]]) }
    expect(gate([protectedFinding("api.ts")], work, "main", 3).stop).toBe("capReached")
  })

  test("changed by an edit tool, the same warning does not block: the guard had its chance", () => {
    expect(gate([protectedFinding("api.ts")], workWith("tool"), "main", 3).stop).toBe("allow")
  })
})

describe("decide at a stop with swept files", () => {
  const input = {
    agent: "main",
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver: fakeResolver({}),
    maxBytes: 10_000,
    maxBlocks: 3,
    maxMatchesPerRule: 10,
    stopGate: true,
  }

  test("swept findings are delivered under their own heading, after the agent's, and do not block", async () => {
    const decision = await decide({
      ...input,
      findings: [finding("user.py", 2), finding("mine.py", 5, "warning")],
      swept: ["user.py"],
      maxContextChars: null,
    })
    expect(decision.delivery.stop).toBe("allow")
    expect(decision.delivery.swept).toEqual(["user.py"])
    const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
    const heading = text.indexOf("changed outside your tool calls")
    expect(heading).toBeGreaterThan(text.indexOf("mine.py:5"))
    expect(text.indexOf("user.py:2")).toBeGreaterThan(heading)
  })

  test("a rule with findings on both sides is two blocks, and the budget pays for both", async () => {
    const findings = [
      ...Array.from({ length: 20 }, (_, n) => finding("mine.py", n + 1)),
      ...Array.from({ length: 20 }, (_, n) => finding("user.py", n + 1)),
    ]
    for (const limit of [200, 400, 800, 1600]) {
      const decision = await decide({ ...input, findings, swept: ["user.py"], maxContextChars: limit })
      const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
      expect(text.length, `limit ${limit}`).toBeLessThanOrEqual(limit)
    }
  })

  test("the floor keeps the agent's own blocks before swept ones, and counts rules, not blocks", async () => {
    /** Every limit at which exactly one of the two blocks fits. */
    const oneBlockFits = async (findings: ReturnType<typeof finding>[]) => {
      const decisions = []
      for (let limit = 100; limit <= 2000; limit += 10) {
        const decision = await decide({ ...input, findings, swept: ["user.py"], maxContextChars: limit })
        if (decision.delivery.findings.length === 1) decisions.push(decision)
      }
      expect(decisions.length).toBeGreaterThan(0)
      return decisions
    }

    // Blocks long enough that one fits where two do not, beside the overflow notice.
    const long = (file: string, id: string) => ({
      rule: rule({ id, message: `{{file}}:{{line}} ${"explains the convention at length. ".repeat(12)}` }),
      match: at(file, 1),
      status: "new" as const,
    })
    // Swept findings first in input order: the floor must still keep the blocking rule.
    for (const own of await oneBlockFits([long("user.py", "a/swept"), long("mine.py", "b/mine")])) {
      expect(own.delivery.stop).toBe("block")
      expect(own.delivery.findings.map((one) => one.file)).toEqual(["mine.py"])
      expect(own.delivery.omitted.rules).toBe(1)
    }

    // One rule on both sides, only its own block fitting: no rule was cut, though a block was.
    for (const decision of await oneBlockFits([long("mine.py", "a/rule"), long("user.py", "a/rule")])) {
      expect(decision.delivery.findings.map((one) => one.file)).toEqual(["mine.py"])
      expect(decision.delivery.omitted.rules).toBe(0)
      expect(decision.overflow).not.toBeNull()
    }
  })

  test("only swept files with findings are named on the delivery", async () => {
    const decision = await decide({
      ...input,
      findings: [finding("mine.py")],
      swept: ["user.py"],
      maxContextChars: null,
    })
    expect(decision.delivery.swept).toBeUndefined()
  })
})
