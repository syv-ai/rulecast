import { describe, expect, test } from "vitest"

import { deliveryCost, measureRuleBlock, renderAgentText } from "../../../src/core/delivery/render-agent"
import { type Delivery, emptyDelivery, type Finding } from "../../../src/core/types"

/**
 * The renderer prices its own output (plan 9 Task 10). Each price is checked against what the
 * renderer actually prints for that part alone, by rendering with and without it — so a price that
 * drifts from the renderer fails here, not as an overflow at the budget's edge.
 *
 * Where the final form is not known when the budget is spent, the price is the longest form, and
 * these assert "at least" rather than "equal". `decide-fits.test.ts` is the end-to-end check.
 */

const render = (delivery: Delivery) => renderAgentText(delivery, { maxMatchesPerRule: 10 })
const finding = (rule: string, file: string, line: number): Finding => ({
  rule,
  severity: "error",
  status: "new",
  file,
  line,
  column: 1,
  message: `${file}:${line} broke ${rule}`,
  count: 1,
})

/** What adding `part` to `base` adds to the rendered text. */
const added = (base: Delivery, part: Partial<Delivery>) => render({ ...base, ...part }).length - render(base).length

describe("deliveryCost", () => {
  // A finding first, so every later section is appended after a block and its blank line, the way
  // the budget charges them.
  const base: Delivery = { ...emptyDelivery(), findings: [finding("r", "a.ts", 1)] }

  test("one warning, after the heading the first one pays for", () => {
    const one = added(base, { warnings: ["first"] })
    // +1: the renderer drops a trailing blank line, so in `base` the rule block's blank line is
    // gone, and anything after the block brings it back. The budget charges it with the block
    // (measureRuleBlock), so the warning's own price does not include it.
    expect(one).toBe(deliveryCost.warningsFrame + deliveryCost.warning("first") + 1)
    expect(added({ ...base, warnings: ["first"] }, { warnings: ["first", "a second warning"] })).toBe(
      deliveryCost.warning("a second warning"),
    )
  })

  test("one backlog summary, inside a frame that is priced at its longest", () => {
    const summary = { rule: "old/rule", file: "app/legacy.py", count: 3 }
    const withOne = { ...base, preexistingSummary: [summary] }
    const withTwo = { ...base, preexistingSummary: [summary, { ...summary, file: "app/other.py" }] }
    expect(render(withTwo).length - render(withOne).length).toBe(
      deliveryCost.backlogSummary({ ...summary, file: "app/other.py" }),
    )
    // The frame includes the "…and N more" line, charged whether or not anything is cut.
    const frame = added(base, { preexistingSummary: [summary] }) - deliveryCost.backlogSummary(summary)
    const cutFrame =
      added(base, { preexistingSummary: [summary], omitted: { ...base.omitted, preexisting: 1 } }) -
      deliveryCost.backlogSummary(summary)
    expect(deliveryCost.backlogFrame(1)).toBeGreaterThanOrEqual(cutFrame)
    expect(cutFrame).toBeGreaterThan(frame)
  })

  test("a reference's line is the longest of its forms", () => {
    const ref = "conventions/errors.md#handling"
    const location = "/home/someone/.cache/rulecast/repos/acme/errors.md"
    const forms: Delivery["references"][number][] = [
      { ref, state: "pointer" },
      { ref, state: "missing" },
      { ref, state: "read", reason: "mode", location },
      { ref, state: "read", reason: "tooLarge", location },
      { ref, state: "read", reason: "budget", location },
    ]
    const longest = Math.max(...forms.map((one) => added(base, { references: [one] })))
    expect(deliveryCost.referenceLine(ref, location) + deliveryCost.referencesEnd).toBe(longest)
  })

  test("a reference given in full costs its line plus what printing it in full adds", () => {
    const ref = "conventions/errors.md#handling"
    const content = "## Handling\nRaise domain errors.\nNever swallow them."
    const full = added(base, { references: [{ ref, state: "full", content }] })
    expect(deliveryCost.referenceLine(ref, undefined) + deliveryCost.referenceContent(ref, content, undefined)).toBe(
      // A full reference ends in its own blank line, so the closing one is not printed again.
      full,
    )
  })

  test("the header, at its longest: the longest file it could name, or the conventions title", () => {
    const one = render({ ...emptyDelivery(), findings: [finding("r", "app/routes/a_long_name.py", 1)] })
    const files = new Set(["a.ts", "app/routes/a_long_name.py"])
    // Title and blank line, priced for the longest file it might name.
    expect(deliveryCost.header(1, files, false)).toBeGreaterThanOrEqual(one.split("\n")[0]!.length + 2)
    const conventions = render({ ...emptyDelivery(), references: [{ ref: "x.md", state: "pointer" }] })
    expect(deliveryCost.header(1, new Set(["a.ts"]), true)).toBeGreaterThanOrEqual(
      conventions.split("\n")[0]!.length + 2,
    )
  })

  test("a shell edit's header, naming one file or saying files, costs no more than it is priced", () => {
    const file = "app/routes/a_long_name.py"
    const shell = { ...emptyDelivery(), via: "shell" as const }
    const one = render({ ...shell, findings: [finding("r", file, 1)] })
    const many = render({ ...shell, findings: [finding("r", "a.ts", 1), finding("s", "b.ts", 1)] })
    expect(one.split("\n")[0]).toContain("changed by your Bash command")
    expect(deliveryCost.header(1, new Set([file]), false, "shell")).toBeGreaterThanOrEqual(
      one.split("\n")[0]!.length + 2,
    )
    expect(deliveryCost.header(2, new Set(["a.ts", "b.ts"]), false, "shell")).toBeGreaterThanOrEqual(
      many.split("\n")[0]!.length + 2,
    )
  })

  test("what to undo in a protected file costs what it prints", () => {
    for (const dirtyAtStart of [false, true]) {
      const refused = { file: "src/client/api.ts", rule: "frontend/generated", dirtyAtStart }
      expect(deliveryCost.refused(refused)).toBe(added(base, { refused: [refused] }))
    }
  })

  test("the overflow notice, with the longest path it allows for", () => {
    const path = `/${"p".repeat(191)}`
    const notice = added({ ...base, omitted: { ...base.omitted, rules: 12 } }, { overflowPath: path })
    expect(deliveryCost.overflowNotice(12)).toBeGreaterThanOrEqual(notice)
  })
})

describe("measureRuleBlock", () => {
  test("is exactly what the block adds, cut findings and blank line included", () => {
    const all = Array.from({ length: 14 }, (_, n) => finding("r", n % 3 === 0 ? "a.ts" : "b.ts", n + 1))
    for (const kept of [1, 2, 5]) {
      const shown = all.slice(0, kept)
      const cut = all.slice(kept)
      const delivery: Delivery = {
        ...emptyDelivery(),
        findings: shown,
        omitted: {
          findings: [
            {
              rule: "r",
              count: cut.length,
              files: new Set(cut.map((f) => f.file).filter((f) => !shown.some((s) => s.file === f))).size,
            },
          ],
          rules: 0,
          preexisting: 0,
        },
        warnings: ["after"],
      }
      // Without findings there is no title, only the warning — so the difference is the title, its
      // blank line, and the block. The warning after the block keeps its blank line from being dropped.
      const withoutBlock = render({ ...delivery, findings: [], omitted: { ...delivery.omitted, findings: [] } })
      const header = render(delivery).split("\n")[0]!.length + 2
      expect(render(delivery).length - header - withoutBlock.length).toBe(
        measureRuleBlock("r", shown, all, undefined, { maxMatchesPerRule: 10 }),
      )
    }
  })
})
