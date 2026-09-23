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

  test("output longer than Claude Code's limit is cut with a pointer to rulecast run", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const big = delivery({ findings, stop: "block" })
    const wide = { maxMatchesPerRule: 1000 }
    const edit = JSON.parse(format(big, "edit", wide).stdout).hookSpecificOutput.additionalContext as string
    const stop = JSON.parse(format(big, "verify", wide).stdout).reason as string
    for (const text of [edit, stop]) {
      expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(text).toMatch(/Run `rulecast run --session s1 --format agent` for the full list\.$/)
    }
  })

  test("a guard with findings denies the write, with the rule and its section as the reason", () => {
    const value = delivery({
      findings: [finding()],
      references: [{ ref: "conventions/backend.md#errors", state: "full", content: "## Errors\nRaise your own." }],
    })
    const output = JSON.parse(format(value, "guard").stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny")
    const reason = output.hookSpecificOutput.permissionDecisionReason as string
    expect(reason).toContain("refuse this write")
    expect(reason).toContain("raises HTTPException(500)")
    expect(reason).toContain("## Errors")
  })

  test("a guard with nothing to say prints nothing, and the write goes ahead", () => {
    expect(format(delivery(), "guard")).toEqual({ stdout: "", exitCode: 0 })
  })

  test("the cut lands on a line break, never mid-word", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const text = JSON.parse(format(delivery({ findings }), "edit", { maxMatchesPerRule: 1000 }).stdout)
      .hookSpecificOutput.additionalContext as string
    const [kept] = text.split("\n\n…cut to fit")
    expect(kept!.endsWith("x".repeat(60))).toBe(true)
  })

  test("a cut delivery points at the file commit wrote, when there is one", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const big = delivery({ findings, overflowPath: "/cache/projects/ab12/deliveries/s1-2026-09-23.md" })
    const text = JSON.parse(format(big, "edit", { maxMatchesPerRule: 1000 }).stdout).hookSpecificOutput
      .additionalContext as string
    expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(text).toMatch(/The whole delivery is in \/cache\/projects\/ab12\/deliveries\/s1-2026-09-23\.md\.$/)
    expect(text).not.toContain("rulecast run --session")
  })

  test("a reset delivers the restored conventions as SessionStart additional context", () => {
    const value = delivery({
      touches: ["backend/services"],
      references: [{ ref: "conventions/backend.md#services", state: "full", content: "## Services\nBusiness logic." }],
    })
    expect(JSON.parse(format(value, "reset").stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: renderAgentText(value, options) },
    })
  })

  test("reset output is held to the same limit", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const output = JSON.parse(format(delivery({ findings }), "reset", { maxMatchesPerRule: 1000 }).stdout)
    expect(output.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
  })

  test("Claude Code re-attaches the 5 most recently accessed files after compaction", () => {
    expect(claudeCodeAdapter.restoredFiles).toBe(5)
  })

  test("the budget handed to commit stays under the limit", () => {
    expect(claudeCodeAdapter.maxContextChars).toBeLessThan(CONTEXT_LIMIT)
  })

  test("without a session the cut points at a plain rulecast run", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const output = claudeCodeAdapter.format(
      delivery({ findings }),
      { kind: "edit", files: [], cwd: "/project" },
      { maxMatchesPerRule: 1000 },
    )
    expect(JSON.parse(output.stdout).hookSpecificOutput.additionalContext).toMatch(
      /Run `rulecast run --format agent` for the full list\.$/,
    )
  })
})
