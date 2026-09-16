import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { emptyDelivery, type Finding } from "../../../src/core/types"

const finding = (overrides: Partial<Finding>): Finding => ({
  rule: "api/no-client",
  severity: "error",
  status: "new",
  file: "src/Card.tsx",
  line: 3,
  column: 1,
  message: "src/Card.tsx:3 imports the client.\nUse a query hook.",
  count: 1,
  ...overrides,
})

describe("renderAgentText", () => {
  test("an empty delivery renders nothing", () => {
    expect(renderAgentText(emptyDelivery(), { maxMatchesPerRule: 10 })).toBe("")
  })

  test("renders findings, summaries, references and warnings", () => {
    const text = renderAgentText(
      {
        ...emptyDelivery(),
        findings: [
          finding({ count: 2 }),
          finding({ rule: "style/x", severity: "warning", message: "consider x", line: 9 }),
        ],
        preexistingSummary: [{ rule: "backend/y", file: "src/Card.tsx", count: 4 }],
        references: [
          { ref: "conventions/api.md#errors", state: "full", content: "## Errors\nMap them." },
          { ref: "conventions/state.md", state: "read", reason: "mode" },
          { ref: "conventions/big.md", state: "read", reason: "budget" },
          { ref: "conventions/design.md#spacing", state: "pointer" },
          { ref: "conventions/gone.md", state: "missing" },
        ],
        warnings: ["rule r1 disabled: detector failed"],
      },
      { maxMatchesPerRule: 10 },
    )
    expect(text).toBe(
      [
        "rulecast: 2 rules violated in src/Card.tsx",
        "",
        "error api/no-client",
        "  src/Card.tsx:3 imports the client.",
        "  Use a query hook. (×2)",
        "",
        "warning style/x",
        "  consider x",
        "",
        "pre-existing (not blocking): backend/y ×4 in src/Card.tsx",
        "",
        "--- conventions/api.md#errors ---",
        "## Errors",
        "Map them.",
        "",
        "--- conventions/state.md: read this before continuing ---",
        "--- conventions/big.md: read this before continuing (not included, too long for this message) ---",
        "--- conventions/design.md#spacing (provided earlier in this session) ---",
        "--- conventions/gone.md (missing) ---",
        "",
        "rulecast warnings:",
        "  - rule r1 disabled: detector failed",
      ].join("\n"),
    )
  })

  test("caps findings per rule and names the files of the rest", () => {
    const findings = [1, 2, 3, 4].map((line) =>
      finding({ line, file: line > 2 ? "b.ts" : "a.ts", message: `m${line}` }),
    )
    const text = renderAgentText({ ...emptyDelivery(), findings }, { maxMatchesPerRule: 2 })
    expect(text).toBe(
      ["rulecast: 1 rule violated", "", "error api/no-client", "  m1", "  m2", "  …and 2 more in 1 file"].join("\n"),
    )
  })

  test("touch-only deliveries get a conventions header", () => {
    const text = renderAgentText(
      {
        ...emptyDelivery(),
        touches: ["api/touch"],
        references: [{ ref: "conventions/api.md", state: "full", content: "# API" }],
      },
      { maxMatchesPerRule: 10 },
    )
    expect(text).toBe(
      ["rulecast: conventions for the files you are working on", "", "--- conventions/api.md ---", "# API"].join("\n"),
    )
  })
})
