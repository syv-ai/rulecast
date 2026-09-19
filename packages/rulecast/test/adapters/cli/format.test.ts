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
        "pre-existing (not blocking): backend/x ×4 in a.py",
        "conventions: conventions/backend.md#errors, conventions/state.md",
        "",
        "warnings:",
        "  - something broke",
        "",
        "1 error, 1 warning",
      ].join("\n"),
    )
    expect(formatDelivery(emptyDelivery(), "terminal", { maxMatchesPerRule: 10 })).toBe("no findings")
  })

  test("agent uses the shared agent renderer", () => {
    expect(formatDelivery(delivery, "agent", { maxMatchesPerRule: 10 })).toContain(
      "--- conventions/backend.md#errors ---",
    )
  })

  test("json is the delivery", () => {
    expect(JSON.parse(formatDelivery(delivery, "json", { maxMatchesPerRule: 10 }))).toEqual(delivery)
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
