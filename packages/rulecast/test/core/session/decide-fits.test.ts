import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { parseReference } from "../../../src/core/references"
import { type ClassifiedFinding, decide } from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

/**
 * The budget's one promise: a trimmed delivery renders within its limit.
 *
 * Since plan 9 Task 10 the budget is priced by the renderer (`deliveryCost`) rather than estimated
 * by five hand-tuned constants. Exact prices admit more than estimates did, so an under-charge
 * anywhere — one line the renderer prints that the price forgot — now shows up as an overflow
 * instead of being hidden by the slack. This sweeps seeded random deliveries across limits to find
 * one.
 *
 * Above the floor only. Below it the overflow notice alone does not fit, and a touch rule's section
 * is never dropped; both are deliberate (§9), and the adapter's own limit is the backstop there.
 */

/** Deterministic, so a failure names a seed that reproduces it. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MESSAGE = "{{file}}:{{line}} calls {{call}} from a route handler; move it into a service instead"
const OVERFLOW_PATH = `/${"p".repeat(191)}` // the longest path the price allows for

const project = { dir: "/project", label: null }
const repo = { dir: "/home/someone/.cache/rulecast/repos/acme/rules/v1.2.3", label: "acme/rules@v1.2.3" }

function scenario(seed: number) {
  const random = prng(seed)
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!
  const files: Record<string, string> = {}
  const references = Array.from({ length: 6 }, (_, n) => {
    const fromRepo = random() < 0.4
    const path = fromRepo ? `docs/rule-${n}.md` : `conventions/topic-${n}.md`
    const text = `## Topic ${n}\n${"A sentence of convention. ".repeat(Math.floor(random() * 60))}`
    files[fromRepo ? `${repo.dir}/${path}` : path] = text
    return parseReference(`@${path}`, random() < 0.2 ? "read" : "inject", fromRepo ? repo : project)
  })
  const resolver = fakeResolver(files)

  const rules = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, n) =>
    rule({
      id: `group/rule-${n}`,
      message: random() < 0.5 ? MESSAGE : "{{file}}:{{line}} {{text}}",
      severity: random() < 0.7 ? "error" : "warning",
      context: references.filter(() => random() < 0.3),
    }),
  )
  const findings: ClassifiedFinding[] = Array.from({ length: Math.floor(random() * 80) }, () => {
    const line = 1 + Math.floor(random() * 400)
    return {
      rule: pick(rules),
      match: {
        file: pick(["app/routes/users.py", "app/routes/orders_and_more.py", "app/services/a.py"]),
        line,
        endLine: line,
        column: 1,
        text: "db.query(User).filter(User.id == user_id)",
        captures: { call: pick(["db.query", "session.execute(stmt)", "crud.get"]) },
      },
      status: random() < 0.75 ? "new" : "preexisting",
    }
  })
  const warnings = Array.from({ length: Math.floor(random() * 12) }, (_, n) => ({
    key: `w${n}`,
    text: `rule group/broken-${n} failed to compile and was skipped (run rulecast validate)`,
  }))
  return { findings, warnings, resolver }
}

describe("a trimmed delivery fits its limit", () => {
  const seeds = Array.from({ length: 40 }, (_, n) => n + 1)
  const limits = [600, 750, 900, 1200, 1600, 2500, 4000, 6000, 9000]

  test.each(seeds)("seed %i, across every limit", async (seed) => {
    const { findings, warnings, resolver } = scenario(seed)
    for (const limit of limits) {
      const { delivery, overflow } = await decide({
        agent: "main",
        findings,
        touches: [],
        agentRead: null,
        warnings,
        work: emptyWork(),
        context: emptyContext(),
        resolver,
        maxBytes: 32768,
        maxBlocks: 3,
        maxContextChars: limit,
        maxMatchesPerRule: 10,
        stopGate: false,
      })
      // The pipeline names the overflow file after decide returns; price it at its longest.
      const rendered = renderAgentText(
        { ...delivery, overflowPath: overflow === null ? null : OVERFLOW_PATH },
        { maxMatchesPerRule: 10 },
      )
      expect(rendered.length, `seed ${seed} at limit ${limit}`).toBeLessThanOrEqual(limit)
    }
  })
})
