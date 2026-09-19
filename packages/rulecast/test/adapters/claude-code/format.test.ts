import { describe, expect, test } from "vitest"

import { CONTEXT_LIMIT, claudeCodeAdapter } from "../../../src/adapters/claude-code/adapter"
import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { type Delivery, type Event, type EventKind, emptyDelivery, type Finding } from "../../../src/core/types"

const options = { maxMatchesPerRule: 10 }
const event = (kind: EventKind): Event => ({ kind, files: [], cwd: "/project", session: { id: "s1" } })
const finding = (overrides: Partial<Finding> = {}): Finding => ({
  rule: "backend/no-httpexception",
  severity: "error",
  status: "new",
  file: "app/services/users.py",
  line: 3,
  column: 5,
  message: "app/services/users.py:3 raises HTTPException(500). Raise a domain exception.",
  count: 1,
  ...overrides,
})
const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({ ...emptyDelivery(), ...overrides })
const format = (value: Delivery, kind: EventKind, opts = options) => claudeCodeAdapter.format(value, event(kind), opts)

describe("Claude Code adapter: format", () => {
  test("touch and edit deliver agent text as additional context", () => {
    const value = delivery({ findings: [finding()] })
    for (const kind of ["touch", "edit"] as const) {
      const output = format(value, kind)
      expect(output.exitCode).toBe(0)
      expect(JSON.parse(output.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: renderAgentText(value, options) },
      })
    }
  })

  test("nothing to say prints nothing", () => {
    for (const kind of ["touch", "edit", "verify", "prompt", "reset"] as const) {
      expect(format(delivery(), kind)).toEqual({ stdout: "", exitCode: 0 })
    }
  })

  test("a blocked stop hands the findings to the agent as the block reason", () => {
    const output = JSON.parse(format(delivery({ findings: [finding()], stop: "block" }), "verify").stdout)
    expect(output.decision).toBe("block")
    expect(output.reason).toMatch(/^This project's rulecast rules/)
    expect(output.reason).toContain("raises HTTPException(500)")
  })

  test("an allowed stop prints nothing", () => {
    const value = delivery({ findings: [finding({ severity: "warning" })], stop: "allow" })
    expect(format(value, "verify")).toEqual({ stdout: "", exitCode: 0 })
  })

  test("a stop past the block cap tells the user what remains", () => {
    const output = JSON.parse(format(delivery({ findings: [finding()], stop: "capReached" }), "verify").stdout)
    expect(output).toEqual({ systemMessage: expect.stringContaining("raises HTTPException(500)") })
  })

  test("output longer than Claude Code's limit is cut with a pointer to rulecast check", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const big = delivery({ findings, stop: "block" })
    const wide = { maxMatchesPerRule: 1000 }
    const edit = JSON.parse(format(big, "edit", wide).stdout).hookSpecificOutput.additionalContext as string
    const stop = JSON.parse(format(big, "verify", wide).stdout).reason as string
    for (const text of [edit, stop]) {
      expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(text).toMatch(/Run `rulecast check --format agent` for the full list\.$/)
    }
  })

  test("the budget handed to commit stays under the limit", () => {
    expect(claudeCodeAdapter.maxContextChars).toBeLessThan(CONTEXT_LIMIT)
  })
})
