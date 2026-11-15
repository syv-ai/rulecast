import { describe, expect, test } from "vitest"

import {
  injectedRecord,
  injectedStats,
  PER_TURN_FLAG_TOKENS,
  SINGLE_FLAG_TOKENS,
} from "../../../src/core/stats/injected"
import { emptyDelivery } from "../../../src/core/types"

// How much rulecast puts before the agents (agreed with both leads, 2026-11-15): characters that
// reached the model, ≈ tokens as chars ÷ 4, split into doc sections, findings and rulecast's own words.

const at = "2026-11-15T10:00:00.000Z"

describe("injectedRecord", () => {
  test("a Read's doc sections are the docs; the rest of what reached the model is rulecast's own", () => {
    const delivery = {
      ...emptyDelivery(),
      references: [
        { ref: "docs/a.md#errors", state: "full" as const, content: "x".repeat(400) },
        { ref: "docs/a.md#more", state: "pointer" as const },
      ],
    }
    const record = injectedRecord({ at, session: "s1", agent: "main", kind: "touch", delivery, chars: 500 })
    expect(record).toEqual({
      v: 1,
      at,
      s: "s1",
      a: "main",
      ev: "read",
      chars: 500,
      docs: [["docs/a.md#errors", 400]],
      findings: 0,
    })
  })

  test("docs again after a compact are marked as a repeat", () => {
    const delivery = { ...emptyDelivery(), references: [{ ref: "d#x", state: "full" as const, content: "y" }] }
    expect(injectedRecord({ at, session: "s1", agent: "main", kind: "reset", delivery, chars: 10 })).toMatchObject({
      ev: "compact",
      again: true,
    })
  })

  test("nothing reached the model: no record", () => {
    expect(
      injectedRecord({ at, session: "s1", agent: "main", kind: "edit", delivery: emptyDelivery(), chars: 0 }),
    ).toBeNull()
  })
})

describe("injectedStats", () => {
  const record = (overrides: Partial<NonNullable<ReturnType<typeof injectedRecord>>>) => ({
    v: 1 as const,
    at,
    s: "s1",
    a: "main",
    ev: "read" as const,
    chars: 400,
    docs: [] as [string, number][],
    findings: 0,
    ...overrides,
  })

  test("totals in tokens, by event, with re-deliveries apart, and each session beside its turns", () => {
    const stats = injectedStats(
      [
        record({ chars: 4000, docs: [["d#x", 3600]] }),
        record({ ev: "stop", chars: 800, findings: 600 }),
        record({ ev: "compact", chars: 2000, docs: [["d#x", 2000]], again: true }),
        record({ s: "s2", ev: "edit", chars: 400 }),
      ],
      new Map([
        ["s1", 3],
        ["s2", 1],
      ]),
      new Map([["d#x", ["backend/errors"]]]),
    )
    expect(stats.tokens).toBe(1800)
    expect(stats.events).toBe(4)
    expect(stats.again).toBe(500)
    expect(stats.byEvent).toEqual({ read: 1000, stop: 200, compact: 500, edit: 100 })
    expect(stats.sessions).toEqual([
      { session: "s1", tokens: 1700, turns: 3, perTurn: 567 },
      { session: "s2", tokens: 100, turns: 1, perTurn: 100 },
    ])
    expect(stats.docs).toEqual([{ ref: "d#x", tokens: 1400, deliveries: 2, rules: ["backend/errors"] }])
  })

  test("flags a single injection past the single limit, and a session past the per-turn rate", () => {
    const big = SINGLE_FLAG_TOKENS * 4 + 4
    const stats = injectedStats(
      [
        record({ chars: big, docs: [["d#huge", big]] }), // Two turns' worth over the rate, each injection under the single limit.
        record({ s: "s2", chars: PER_TURN_FLAG_TOKENS * 4 + 4 }),
        record({ s: "s2", chars: PER_TURN_FLAG_TOKENS * 4 + 4 }),
      ],
      new Map([
        ["s1", 10],
        ["s2", 2],
      ]),
      new Map(),
    )
    expect(stats.large).toEqual([{ at, session: "s1", ev: "read", tokens: SINGLE_FLAG_TOKENS + 1, doc: "d#huge" }])
    expect(stats.heavySessions).toEqual(["s2"])
  })
})
