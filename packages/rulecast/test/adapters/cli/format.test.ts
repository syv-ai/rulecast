import { describe, expect, test } from "vitest"

import { exitCodeFor, formatDelivery } from "../../../src/adapters/cli/format"
import { type Delivery, emptyDelivery } from "../../../src/core/types"

const delivery: Delivery = {
  ...emptyDelivery(),
  findings: [
    {
      rule: "backend/x",
      severity: "error",
      status: "new",
      file: "a.py",
      line: 2,
      column: 5,
      message: "bad\nfix it",
      count: 1,
    },
    { rule: "front/y", severity: "warning", status: "new", file: "b.ts", line: 1, column: 1, message: "hmm", count: 3 },
  ],
  preexistingSummary: [{ rule: "backend/x", file: "a.py", count: 4 }],
  references: [
    { ref: "conventions/backend.md#errors", state: "full", content: "## Errors" },
    { ref: "conventions/state.md", state: "read", reason: "mode" },
  ],
  warnings: ["something broke"],
}

describe("formatDelivery", () => {
  test("terminal", () => {
    expect(formatDelivery(delivery, "terminal", { maxMatchesPerRule: 10 })).toBe(
      [
        "a.py:2:5  error    backend/x  bad fix it",
        "b.ts:1:1  warning  front/y  hmm (×3)",
        "",
        "backlog in the files checked (not from your change):",
        "  backend/x ×4 in a.py",
        "  see all of it: rulecast run --all-files --summary",
        "conventions: conventions/backend.md#errors, conventions/state.md",
        "",
        "rulecast problems:",
        "  - something broke",
        "",
        "findings: 1 error, 1 warning · rulecast: 1 problem (see above)",
      ].join("\n"),
    )
    expect(formatDelivery(emptyDelivery(), "terminal", { maxMatchesPerRule: 10 })).toBe("no findings")
  })

  test("terminal says what it checked, and nothing staged is never 'no findings'", () => {
    const options = { maxMatchesPerRule: 10 }
    const empty = emptyDelivery()
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 0, selection: "staged" } })).toBe(
      "nothing staged: 0 files checked (rulecast run --all-files checks everything)",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 3, selection: "staged" } })).toBe(
      "checked 3 staged files\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 1, selection: "range" } })).toBe(
      "checked 1 changed file\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 194, selection: "all" } })).toBe(
      "checked all 194 files\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 2, selection: "files" } })).toBe(
      "checked 2 files\nno findings",
    )
  })

  test("agent uses the shared agent renderer", () => {
    expect(formatDelivery(delivery, "agent", { maxMatchesPerRule: 10 })).toContain(
      "--- conventions/backend.md#errors ---",
    )
  })

  test("json publishes a named shape, not the whole delivery", () => {
    const parsed = JSON.parse(formatDelivery(delivery, "json", { maxMatchesPerRule: 10 }))
    expect(Object.keys(parsed).sort()).toEqual([
      "backlog",
      "checked",
      "findings",
      "preexistingSummary",
      "references",
      "skipped",
      "stop",
      "touches",
      "warnings",
    ])
    expect(parsed.findings).toEqual(delivery.findings)
    expect(parsed.references).toEqual(delivery.references)
    // The renderer's own bookkeeping stays out of the published output.
    expect(parsed).not.toHaveProperty("templates")
    expect(parsed).not.toHaveProperty("omitted")
    expect(parsed).not.toHaveProperty("overflowPath")
  })

  test("sarif lists findings as results", () => {
    const sarif = JSON.parse(formatDelivery(delivery, "sarif", { maxMatchesPerRule: 10 }))
    expect(sarif.version).toBe("2.1.0")
    expect(sarif.runs[0].tool.driver.name).toBe("rulecast")
    expect(sarif.runs[0].tool.driver.rules).toEqual([{ id: "backend/x" }, { id: "front/y" }])
    expect(sarif.runs[0].results[0]).toEqual({
      ruleId: "backend/x",
      level: "error",
      message: { text: "bad\nfix it" },
      locations: [
        { physicalLocation: { artifactLocation: { uri: "a.py" }, region: { startLine: 2, startColumn: 5 } } },
      ],
    })
  })
})

describe("exitCodeFor", () => {
  test("2 when rulecast failed, 1 for new errors, 0 otherwise", () => {
    expect(exitCodeFor(delivery, true)).toBe(2)
    expect(exitCodeFor(delivery, false)).toBe(1)
    expect(exitCodeFor({ ...delivery, findings: [delivery.findings[1]!] }, false)).toBe(0)
  })
})
