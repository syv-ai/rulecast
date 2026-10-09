import { describe, expect, test } from "vitest"

import { parseReference } from "../../../src/core/references"
import { assemble, gate, trim } from "../../../src/core/session/decide"
import { emptyWork } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

/**
 * `decide` was one function doing four jobs on one mutable delivery. It is three stages now —
 * assemble, trim, gate — and `decide` composes them, so its own suites (decide-budget,
 * decide-findings, decide-references, decide-scale) and the delivery goldens are the evidence that
 * nothing moved. These pin what the split was for: properties that used to be comments.
 */

const MESSAGE = "{{file}}:{{line}} returns HTTP {{status}} straight from the service layer. Raise a domain exception."
const resolver = fakeResolver({
  "conventions/backend.md#errors": `## Errors\n${"Services raise domain exceptions. ".repeat(20)}`,
})
const errors = parseReference("@conventions/backend.md#errors", "inject", { dir: "/project", label: null })

const at = (line: number): Match => ({
  file: "a.py",
  line,
  endLine: line,
  column: 1,
  text: "",
  captures: { status: "404" },
})
const finding = (id: string, line: number, severity: "error" | "warning" = "error") => ({
  rule: rule({ id, message: MESSAGE, severity, context: [errors] }),
  match: at(line),
  status: "new" as const,
})

describe("trim", () => {
  test("never changes what it was given, so trimming twice gives the same answer", async () => {
    const assembled = await assemble({
      findings: [...Array.from({ length: 30 }, (_, n) => finding("a/rule", n + 1)), finding("b/rule", 99)],
      warnings: [{ key: "w", text: "a warning" }],
      resolver,
      maxBytes: 32768,
    })
    // Everything trim could change is plain data; the rules inside `fresh` carry functions.
    const plain = () =>
      JSON.stringify([assembled.delivery, assembled.candidates, assembled.unwarned, assembled.context])
    const before = plain()
    const limits = { maxContextChars: 600, maxMatchesPerRule: 10 }

    const first = trim(assembled, limits)
    expect(plain()).toBe(before)
    // The budget did cut something, or this proves nothing.
    expect(first.delivery.findings.length).toBeLessThan(assembled.delivery.findings.length)
    expect(trim(assembled, limits)).toEqual(first)
  })

  test("an overflow file is written from the assembled delivery, untouched by the budget", async () => {
    const assembled = await assemble({
      findings: Array.from({ length: 12 }, (_, n) => finding(`rule/${n}`, n + 1)),
      resolver,
      maxBytes: 32768,
    })
    const { delivery, overflow } = trim(assembled, { maxContextChars: 400, maxMatchesPerRule: 10 })
    expect(delivery.omitted.rules).toBeGreaterThan(0)
    expect(overflow).toBe(assembled.delivery)
    expect(overflow?.findings).toHaveLength(12)
  })

  test("without a limit nothing is cut and there is no overflow", async () => {
    const assembled = await assemble({ findings: [finding("a/rule", 1)], resolver, maxBytes: 32768 })
    const { delivery, overflow } = trim(assembled, { maxContextChars: null, maxMatchesPerRule: 10 })
    expect(delivery.findings).toEqual(assembled.delivery.findings)
    expect(overflow).toBeNull()
  })
})

describe("gate", () => {
  test("blocks on a new error, and records the block", () => {
    expect(gate([finding("a/rule", 1)], emptyWork(), "main", 3)).toEqual({
      stop: "block",
      work: [{ t: "stopBlock", agent: "main" }],
    })
  })

  test("allows a stop when what was found is only warnings", () => {
    expect(gate([finding("a/rule", 1, "warning")], emptyWork(), "main", 3)).toEqual({ stop: "allow", work: [] })
  })

  test("stops blocking once the agent has been blocked max_blocks times", () => {
    const work = emptyWork()
    work.stopBlocks.set("main", 3)
    expect(gate([finding("a/rule", 1)], work, "main", 3)).toEqual({ stop: "capReached", work: [] })
  })

  test("is decided by what was found, even when the budget could not hold it", async () => {
    // The invariant that used to be a comment in decide.ts: an error the floor dropped is still an
    // unresolved error. gate takes `fresh`; nothing a caller could pass it carries the trimmed list.
    const assembled = await assemble({
      findings: Array.from({ length: 12 }, (_, n) => finding(`rule/${n}`, n + 1)),
      resolver,
      maxBytes: 32768,
    })
    const { delivery } = trim(assembled, { maxContextChars: 400, maxMatchesPerRule: 10 })
    expect(delivery.omitted.rules).toBeGreaterThan(0)
    expect(gate(assembled.fresh, emptyWork(), "main", 3).stop).toBe("block")
  })
})
