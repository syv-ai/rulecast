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
      id: "id",
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
        { ...delivery, overflowPaths: overflow === null ? [] : [OVERFLOW_PATH] },
        { maxMatchesPerRule: 10 },
      )
      expect(rendered.length, `seed ${seed} at limit ${limit}`).toBeLessThanOrEqual(limit)
    }
  })
})

/**
 * The plan 25 re-review's sweep: rules with sections, a touch rule, a section this session already
 * delivered, a swept file and a warning, with and without a linter rule that maps sections per lint
 * rule. The touch rule's line used to be charged after every block had passed the cap, so the
 * delivery overran (limit 582 rendered 585), and a section delivered earlier was priced as the
 * longer "read this" line.
 */
describe("decide: the budget holds with touch rules and sections delivered earlier", () => {
  const sections: Record<string, string> = {
    "docs/a.md#eq": `## Eq\n${"Use === always. ".repeat(10)}`,
    "docs/a.md#console": `## Console\n${"Use the logger. ".repeat(10)}`,
    "docs/a.md#shared": "## Shared\nShared text.",
    "docs/a.md#own": "## Own\nOwn linter context. ".repeat(3),
    "docs/b.md#plain": `## Plain\n${"Plain rule section. ".repeat(8)}`,
    "docs/b.md#plain2": `## Plain2\n${"Second. ".repeat(20)}`,
    "docs/b.md#early": "## Early\nAlready delivered earlier.",
    "docs/b.md#touch": "## Touch\nTouch section. ".repeat(4),
  }
  const ref = (text: string) => parseReference(text, "inject", { dir: "/project", label: null })
  const plain = rule({
    id: "aa/plain",
    message: "plain {{file}}:{{line}}",
    context: [ref("@docs/b.md#plain"), ref("@docs/b.md#early")],
  })
  const plain2 = rule({
    id: "zz/plain2",
    message: "p2 {{line}}",
    context: [ref("@docs/b.md#plain2"), ref("@docs/a.md#shared")],
  })
  const touch = rule({ id: "tt/touch", detector: null, context: [ref("@docs/b.md#touch")] })
  const linter = rule({
    id: "linter/eslint",
    message: "{{message}} ({{ruleId}})",
    context: [ref("@docs/a.md#own")],
    contextByRule: new Map([
      ["eqeqeq", [ref("@docs/a.md#eq")]],
      ["no-console", [ref("@docs/a.md#console"), ref("@docs/a.md#shared")]],
      ["x", [ref("@docs/a.md#shared")]],
      ["early", [ref("@docs/b.md#early")]],
      ["plainmap", [ref("@docs/b.md#plain")]],
    ]),
  })
  const at = (r: typeof plain, id: string, file: string, line: number, captures: Record<string, string> = {}) => ({
    rule: r,
    id,
    status: "new" as const,
    match: { file, line, endLine: line, column: 1, text: Object.keys(captures).length > 0 ? "" : "x", captures },
  })
  const lint = (ruleId: string, file: string, line: number, message = `msg ${line}`) =>
    at(linter, `${ruleId}${file}${line}`, file, line, { message, ruleId })
  const findingsFor = (withLinter: boolean): ClassifiedFinding[] => [
    at(plain, "p1", "b.ts", 1),
    at(plain, "p2", "b.ts", 5),
    at(plain, "p3", "c.ts", 2),
    at(plain2, "q1", "b.ts", 3),
    at(plain2, "q2", "swept.ts", 9),
    { ...at(plain, "pre1", "old.ts", 1), status: "preexisting" },
    ...(withLinter
      ? [
          lint("unmapped", "a.ts", 1),
          lint("eqeqeq", "a.ts", 2),
          lint("eqeqeq", "a.ts", 3),
          lint("no-console", "a.ts", 4),
          lint("x", "a.ts", 5),
          lint("early", "a.ts", 6),
          lint("plainmap", "a.ts", 7),
          lint("no-console", "swept.ts", 8),
          lint("eqeqeq", "a.ts", 9, "same"),
          lint("no-console", "a.ts", 10, "same"),
        ]
      : []),
  ]

  test.each([false, true])(
    "with a linter rule: %s, the delivery fits every limit from 100 to 2000",
    async (withLinter) => {
      const resolver = fakeResolver(sections)
      const hash = (await resolver.currentHash("docs/b.md", "early"))!
      const over: string[] = []
      for (const swept of [false, true]) {
        for (const maxMatchesPerRule of [1, 2, 10]) {
          const run = async (limit: number) => {
            const context = emptyContext()
            context.delivered.push({ path: "docs/b.md", anchor: "early", hash })
            const { delivery } = await decide({
              agent: "main",
              findings: findingsFor(withLinter),
              touches: [touch],
              agentRead: null,
              warnings: [{ key: "w1", text: "a warning about something" }],
              work: emptyWork(),
              context,
              resolver,
              maxBytes: 32768,
              maxBlocks: 3,
              maxContextChars: limit,
              maxMatchesPerRule,
              stopGate: false,
              ...(swept ? { swept: ["swept.ts"] } : {}),
            })
            return { delivery, text: renderAgentText(delivery, { maxMatchesPerRule }) }
          }
          // Below the floor only the touch rule's section is left, which is never dropped (§9): that
          // is the one delivery allowed past a limit.
          const floor = await run(1)
          expect(floor.delivery.findings).toEqual([])
          expect(floor.delivery.references.map((one) => one.ref)).toEqual(["docs/b.md#touch"])
          for (let limit = 100; limit <= 2000; limit++) {
            const { text } = await run(limit)
            if (text.length > Math.max(limit, floor.text.length)) {
              over.push(`${limit}:${text.length} (swept ${swept}, max ${maxMatchesPerRule})`)
            }
          }
        }
      }
      expect(over).toEqual([])
    },
  )
})
