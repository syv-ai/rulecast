import { describe, expect, test } from "vitest"

import { renderBacklog, summarise } from "../../../src/adapters/cli/backlog"
import { type Delivery, emptyDelivery, type Finding } from "../../../src/core/types"

const finding = (rule: string, file: string, count = 1, line = 1): Finding => ({
  rule,
  severity: "error",
  status: "new",
  file,
  line,
  column: 1,
  message: `${file}:${line}`,
  count,
})

const delivery = (overrides: Partial<Delivery>): Delivery => ({ ...emptyDelivery(), ...overrides })

describe("summarise", () => {
  test("counts violations per rule and per file, respecting a finding's own count", () => {
    const summary = summarise(
      delivery({
        findings: [
          finding("routes/no-crud", "a.py", 3),
          finding("routes/no-crud", "b.py"),
          finding("routes/slim", "a.py", 2),
        ],
      }),
    )
    expect(summary.rules).toEqual([
      { rule: "routes/no-crud", violations: 4, files: 2 },
      { rule: "routes/slim", violations: 2, files: 1 },
    ])
    expect(summary.files).toEqual([
      { file: "a.py", violations: 5 },
      { file: "b.py", violations: 1 },
    ])
  })

  test("totalFiles is distinct files, not the sum of the per-rule file counts", () => {
    const summary = summarise(delivery({ findings: [finding("one", "a.py"), finding("two", "a.py")] }))
    expect(summary.rules.map((entry) => entry.files)).toEqual([1, 1])
    expect(summary.totalFiles).toBe(1)
    expect(summary.totalViolations).toBe(2)
  })

  test("pre-existing summaries count too: with --from-ref they are most of the backlog", () => {
    const summary = summarise(
      delivery({
        findings: [finding("routes/no-crud", "a.py")],
        preexistingSummary: [{ rule: "routes/no-crud", file: "b.py", count: 12 }],
      }),
    )
    expect(summary.rules).toEqual([{ rule: "routes/no-crud", violations: 13, files: 2 }])
    expect(summary.totalFiles).toBe(2)
  })

  test("ties break on the name, so the output is stable", () => {
    const summary = summarise(delivery({ findings: [finding("zzz", "z.py"), finding("aaa", "a.py")] }))
    expect(summary.rules.map((entry) => entry.rule)).toEqual(["aaa", "zzz"])
    expect(summary.files.map((entry) => entry.file)).toEqual(["a.py", "z.py"])
  })

  test("an empty delivery is an empty backlog", () => {
    expect(summarise(emptyDelivery())).toEqual({ rules: [], files: [], totalViolations: 0, totalFiles: 0 })
  })
})

describe("renderBacklog", () => {
  test("leads with the count, lists the rules and the worst files, and says what it means", () => {
    const summary = summarise(
      delivery({
        findings: [
          finding("routes/no-crud", "a.py", 12),
          finding("routes/no-crud", "b.py", 9),
          finding("routes/slim", "c.py", 2),
        ],
      }),
    )
    const text = renderBacklog(summary, { topFiles: 2 })
    expect(text.split("\n")).toEqual([
      "backlog: 23 violations in 3 files",
      "",
      "  rule            violations  files",
      "  routes/no-crud          21      2",
      "  routes/slim              2      1",
      "",
      "  worst files  violations",
      "  a.py                 12",
      "  b.py                  9",
      "  …and 1 more file",
      "",
      "This is the stock, not a rate. Enforcement on edits does not reduce it.",
      "Remediate a file at a time: a file that already follows a rule rarely breaks it.",
    ])
  })

  test("no percentage appears anywhere: the rate is the number that misleads", () => {
    const summary = summarise(delivery({ findings: [finding("one", "a.py", 57)] }))
    expect(renderBacklog(summary, { topFiles: 5 })).not.toContain("%")
  })

  test("nothing found says so in one line", () => {
    expect(renderBacklog(summarise(emptyDelivery()), { topFiles: 5 })).toBe("backlog: no violations")
  })
})
