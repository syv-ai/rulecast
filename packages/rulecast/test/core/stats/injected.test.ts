import { describe, expect, test } from "vitest"

import {
  injectedRecord,
  injectedStats,
  PER_TURN_FLAG_TOKENS,
  SINGLE_FLAG_TOKENS,
  shareInjected,
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

describe("review of cec2ae0", () => {
  test("docs never count for more than what reached the model", () => {
    const delivery = {
      ...emptyDelivery(),
      references: [{ ref: "d#x", state: "full" as const, content: "z".repeat(1000) }],
    }
    const record = injectedRecord({ at, session: "s1", agent: "main", kind: "touch", delivery, chars: 500 })
    expect(record!.docs).toEqual([["d#x", 500]])
  })

  test("a session with no stop recorded has no rate, and is not flagged", () => {
    const stats = injectedStats(
      [{ v: 1, at, s: "s9", a: "main", ev: "read", chars: 40_000, docs: [], findings: 0 }],
      new Map(),
      new Map(),
    )
    expect(stats.sessions).toEqual([{ session: "s9", tokens: 10_000, turns: 0, perTurn: null }])
    expect(stats.heavySessions).toEqual([])
  })
})

describe("review of fc58d9b", () => {
  test("an answer not cut: each part's sections whole, the rest shared by its own words", () => {
    expect(shareInjected({ total: 1000, docs: [400, 100], other: [300, 100], kept: null })).toEqual([
      400 + 375,
      100 + 125,
    ])
  })

  test("an answer cut to the limit: what was cut comes off the sections, the last part's first", () => {
    // The parts' text is 400 + 300 + 100 + 200 = 1000; 700 of it was kept, then a 50-char notice.
    // The last part's 300 of sections were cut; the 350 left over is shared 1 : 2, the odd char to the last.
    expect(shareInjected({ total: 750, docs: [400, 300], other: [100, 200], kept: 700 })).toEqual([400 + 116, 0 + 234])
  })

  test("the cut notice is not counted as doc sections", () => {
    // 100 of the parts' 1100 was cut, then a 60-char notice: the last part keeps 400 of its 500 of
    // sections, and the notice goes with the rest, 80 : 80.
    expect(shareInjected({ total: 1060, docs: [500, 500], other: [50, 50], kept: 1000 })).toEqual([580, 480])
  })

  test("several parts each carry a heading the combined answer has once: no cut without the adapter saying so", () => {
    expect(shareInjected({ total: 500, docs: [200, 200], other: [100, 100], kept: null })).toEqual([250, 250])
  })

  test("an unattended hold: only rulecast's own words, no docs and no findings", () => {
    const delivery = {
      ...emptyDelivery(),
      references: [{ ref: "d#x", state: "full" as const, content: "z".repeat(100) }],
      findings: [{ rule: "r", file: "a.py", message: "m".repeat(30) }],
    } as unknown as Parameters<typeof injectedRecord>[0]["delivery"]
    const record = injectedRecord({
      at,
      session: "s1",
      agent: "main",
      kind: "verify",
      delivery,
      chars: 300,
      ownWordsOnly: true,
    })
    expect(record).toMatchObject({ ev: "stop", chars: 300, docs: [], findings: 0 })
  })
})
