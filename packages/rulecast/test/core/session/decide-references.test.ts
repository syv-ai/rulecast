import { describe, expect, test } from "vitest"

import { fnv1a } from "../../../src/core/baseline/hash"
import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { parseReference } from "../../../src/core/references"
import { type DecideInput, decide } from "../../../src/core/session/decide"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const files = {
  "conventions/api.md": "# API\n## Errors\nMap.\n### Retries\nTwice.",
  "conventions/api.md#errors": "## Errors\nMap.\n### Retries\nTwice.",
  "conventions/api.md#retries": "### Retries\nTwice.",
  "conventions/state.md": "# State",
  "conventions/big.md": "x".repeat(500),
}
const resolver = fakeResolver(files, { "conventions/api.md#errors": ["retries"] })

const ref = (text: string, mode: "inject" | "read" = "inject") =>
  parseReference(text, mode, { dir: "/project", label: null })

const violated = (id: string, context: ReturnType<typeof ref>[]) => ({
  rule: rule({ id, message: "m", context }),
  match: { file: "a.ts", line: 1, endLine: 1, column: 1, text: "", captures: {} },
  id: "id",
  status: "new" as const,
})

function input(overrides: Partial<DecideInput>): DecideInput {
  return {
    agent: "main",
    findings: [],
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver,
    maxBytes: 100,
    maxBlocks: 3,
    maxContextChars: null,
    maxMatchesPerRule: 10,
    stopGate: false,
    ...overrides,
  }
}

describe("decide: references", () => {
  test("each ref once, in order of first appearance, with states by mode, size and existence", async () => {
    const decision = await decide(
      input({
        findings: [
          violated("r1", [ref("@conventions/api.md#errors"), ref("@conventions/state.md", "read")]),
          violated("r2", [ref("@conventions/api.md#errors"), ref("@conventions/big.md"), ref("@conventions/gone.md")]),
        ],
      }),
    )
    expect(decision.delivery.references).toEqual([
      { ref: "conventions/api.md#errors", state: "full", content: files["conventions/api.md#errors"] },
      { ref: "conventions/state.md", state: "read", reason: "mode" },
      { ref: "conventions/big.md", state: "read", reason: "tooLarge" },
      { ref: "conventions/gone.md", state: "missing" },
    ])
    expect(decision.context).toEqual([
      { t: "delivered", path: "conventions/api.md", anchor: "errors", hash: fnv1a(files["conventions/api.md#errors"]) },
    ])
  })

  test("delivered content covers itself and its subsections while unchanged", async () => {
    const context = emptyContext()
    context.delivered.push({
      path: "conventions/api.md",
      anchor: "errors",
      hash: fnv1a(files["conventions/api.md#errors"]),
    })
    const decision = await decide(
      input({
        context,
        findings: [
          violated("r", [
            ref("@conventions/api.md#retries"),
            ref("@conventions/api.md#errors"),
            ref("@conventions/api.md"),
          ]),
        ],
      }),
    )
    expect(decision.delivery.references.map((r) => [r.ref, r.state])).toEqual([
      ["conventions/api.md#retries", "pointer"],
      ["conventions/api.md#errors", "pointer"],
      ["conventions/api.md", "full"],
    ])
  })

  test("changed content is delivered again", async () => {
    const context = emptyContext()
    context.delivered.push({ path: "conventions/state.md", anchor: null, hash: fnv1a("# Old state") })
    const decision = await decide(input({ context, findings: [violated("r", [ref("@conventions/state.md")])] }))
    expect(decision.delivery.references[0]!.state).toBe("full")
  })

  test("a complete read by the agent covers later references to that file", async () => {
    const decision = await decide(
      input({
        agentRead: "conventions/api.md",
        touches: [
          rule({
            id: "t",
            stages: ["touch"],
            detector: null,
            message: null,
            context: [ref("@conventions/api.md#retries")],
          }),
        ],
      }),
    )
    expect(decision.delivery.touches).toEqual(["t"])
    expect(decision.delivery.references).toEqual([{ ref: "conventions/api.md#retries", state: "pointer" }])
    expect(decision.context).toEqual([
      { t: "touched", rule: "t" },
      { t: "delivered", path: "conventions/api.md", anchor: null, hash: fnv1a(files["conventions/api.md"]) },
    ])
  })

  test("references beyond the budget become read and are not recorded", async () => {
    // big.md, not api.md#errors, since plan 9 Task 10: the budget is priced by the renderer now,
    // and the whole of this delivery with api.md#errors in full is 153 characters — it never
    // exceeded this limit. The old hand-tuned constants demoted it anyway.
    const decision = await decide(
      input({
        maxContextChars: 390,
        // Past this file's default of 100, so big.md is cut by the budget rather than as too large.
        maxBytes: 32768,
        findings: [violated("r", [ref("@conventions/state.md"), ref("@conventions/big.md")])],
      }),
    )
    expect(decision.delivery.references.map((r) => [r.ref, r.state, r.reason])).toEqual([
      ["conventions/state.md", "full", undefined],
      ["conventions/big.md", "read", "budget"],
    ])
    expect(decision.context.map((record) => record.t === "delivered" && record.path)).toEqual(["conventions/state.md"])
  })

  describe("touch rules whose sections overlap (#69)", () => {
    const touch = (id: string, refs: string[]) => rule({ id, detector: null, context: refs.map((one) => ref(one)) })
    const refsOf = (decision: Awaited<ReturnType<typeof decide>>) =>
      decision.delivery.references.map((one) => [one.ref, one.state])

    test("a section inside a whole file sent in full is not sent again, whichever rule names it first", async () => {
      const decision = await decide(
        input({
          touches: [
            touch("broad", ["@conventions/state.md", "@conventions/api.md", "@conventions/api.md#errors"]),
            touch("narrow", ["@conventions/api.md#retries"]),
          ],
        }),
      )
      expect(refsOf(decision)).toEqual([
        ["conventions/state.md", "full"],
        ["conventions/api.md", "full"],
      ])
      const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
      expect(text.split("Twice.").length - 1).toBe(1)
    })

    test("narrow rules fill first; the broad rule's whole file is the one cut to a pointer", async () => {
      const big = "conventions/big.md"
      const decision = await decide(
        input({
          maxBytes: 32768,
          maxContextChars: 420,
          touches: [
            touch("broad", [`@${big}`, "@conventions/state.md"]),
            touch("narrow", ["@conventions/api.md#retries"]),
          ],
        }),
      )
      expect(refsOf(decision)).toEqual([
        ["conventions/api.md#retries", "full"],
        [big, "read"],
        ["conventions/state.md", "full"],
      ])
    })

    test("with too little room for the whole file, the sections named alongside it still go in full", async () => {
      const resolverWith = fakeResolver(
        { ...files, "conventions/api.md": `${files["conventions/api.md"]}\n${"y".repeat(400)}` },
        { "conventions/api.md#errors": ["retries"] },
      )
      const decision = await decide(
        input({
          resolver: resolverWith,
          maxBytes: 32768,
          maxContextChars: 400,
          touches: [
            touch("broad", ["@conventions/api.md", "@conventions/state.md"]),
            touch("narrow", ["@conventions/api.md#errors"]),
          ],
        }),
      )
      expect(refsOf(decision)).toEqual([
        ["conventions/api.md#errors", "full"],
        ["conventions/api.md", "read"],
        ["conventions/state.md", "full"],
      ])
    })

    // Sizes picked so a whole file is larger than the two sections of other files together.
    const sized = fakeResolver(
      {
        "docs/a.md": `# A\n## Eq\nONLY_ONCE\n## Other\n${"o ".repeat(30)}`,
        "docs/a.md#eq": "## Eq\nONLY_ONCE",
        "docs/x.md#s": `## S\n${"s ".repeat(40)}`,
        "docs/y.md#p": `## P\n${"p ".repeat(40)}`,
        "docs/big.md": `# Big\n${"b ".repeat(150)}`,
      },
      {},
    )
    const limits = Array.from({ length: 141 }, (_, step) => 150 + step * 5)

    test("a rule citing one whole file fills after one citing smaller sections, whatever it lists first", async () => {
      const wrong: number[] = []
      for (const limit of limits) {
        const decision = await decide(
          input({
            resolver: sized,
            maxBytes: 32768,
            maxContextChars: limit,
            touches: [touch("broad", ["@docs/big.md"]), touch("narrow", ["@docs/x.md#s", "@docs/y.md#p"])],
          }),
        )
        const states = new Map(decision.delivery.references.map((one) => [one.ref, one.state]))
        if (
          states.get("docs/big.md") === "full" &&
          [states.get("docs/x.md#s"), states.get("docs/y.md#p")].includes("read")
        )
          wrong.push(limit)
      }
      expect(wrong).toEqual([])
    })

    test("a part sent before its container is replaced by it at no extra cost: its line is refunded too", async () => {
      // The smallest budget that sends the whole file and x.md#s in full is the same with or without a
      // rule naming a section of that file first: the section is replaced, so it must cost nothing.
      const smallest = async (touches: ReturnType<typeof touch>[]) => {
        for (const limit of limits) {
          const decision = await decide(input({ resolver: sized, maxBytes: 32768, maxContextChars: limit, touches }))
          const states = new Map(decision.delivery.references.map((one) => [one.ref, one.state]))
          if (states.get("docs/a.md") === "full" && states.get("docs/x.md#s") === "full") return limit
        }
        return null
      }
      const without = await smallest([touch("broad", ["@docs/a.md", "@docs/x.md#s"])])
      expect(without).not.toBeNull()
      expect(await smallest([touch("part", ["@docs/a.md#eq"]), touch("broad", ["@docs/a.md", "@docs/x.md#s"])])).toBe(
        without,
      )
    })

    test("a container a repeat brings replaces the parts of it already sent", async () => {
      // The lint rule maps eqeqeq to the whole file. The floor shows only the first finding, so the
      // file comes with the repeat, after the touch rule's section of it went in full.
      const linter = rule({
        id: "linter/eslint",
        message: "{{message}} ({{ruleId}})",
        contextByRule: new Map([["eqeqeq", [ref("@docs/a.md")]]]),
      })
      const lint = (ruleId: string, line: number) => ({
        rule: linter,
        id: `${ruleId}${line}`,
        status: "new" as const,
        match: { file: "a.ts", line, endLine: line, column: 1, text: "", captures: { message: `m ${line}`, ruleId } },
      })
      const twice: number[] = []
      let brought = 0
      for (const limit of limits) {
        const decision = await decide(
          input({
            resolver: sized,
            maxBytes: 32768,
            maxContextChars: limit,
            findings: [lint("no-console", 1), lint("eqeqeq", 2)],
            touches: [touch("t", ["@docs/a.md#eq"])],
          }),
        )
        const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
        expect(text.length, `limit ${limit}`).toBeLessThanOrEqual(limit)
        if (text.split("ONLY_ONCE").length - 1 > 1) twice.push(limit)
        if (decision.delivery.references.some((one) => one.ref === "docs/a.md" && one.state === "full")) brought++
      }
      expect(twice).toEqual([])
      expect(brought).toBeGreaterThan(0)
    })

    describe("nothing named instead of sent that would fit", () => {
      const s0 = `## S0\nM0 ${"a ".repeat(40)}`
      const t00 = "### T00\nM00 x"
      const t01 = `### T01\nM01 ${"y ".repeat(30)}`
      const s1 = `## S1\nM1 ${"b ".repeat(20)}`
      const t10 = "### T10\nM10"
      const t11 = `### T11\nM11 ${"z ".repeat(45)}`
      const texts: Record<string, string> = {
        "docs/a.md": `# A\n${s0}\n${t00}\n${t01}\n${s1}\n${t10}\n${t11}`,
        "docs/a.md#s0": `${s0}\n${t00}\n${t01}`,
        "docs/a.md#t00": t00,
        "docs/a.md#t01": t01,
        "docs/a.md#s1": `${s1}\n${t10}\n${t11}`,
        "docs/a.md#t10": t10,
        "docs/a.md#t11": t11,
        "docs/b.md": `# B\n${"q ".repeat(60)}`,
        // Shorter than the line that would name it: sending it costs less than not.
        "docs/c.md#k": "## K\nk",
      }
      const children: Record<string, string[]> = { "docs/a.md#s0": ["t00", "t01"], "docs/a.md#s1": ["t10", "t11"] }
      const nested = fakeResolver(texts, children)
      const inside = (outer: string, inner: string) => {
        const [file, anchor] = outer.split("#")
        const [innerFile, innerAnchor] = inner.split("#")
        if (file !== innerFile || outer === inner) return false
        return anchor === undefined || (innerAnchor !== undefined && (children[outer] ?? []).includes(innerAnchor))
      }
      const decideAt = (touches: ReturnType<typeof touch>[], limit: number, findings: DecideInput["findings"] = []) =>
        decide(input({ resolver: nested, maxBytes: 32768, maxContextChars: limit, touches, findings }))
      /** A linter rule mapping each of its rule ids to one reference, and its findings in a.ts. */
      const linter = (map: [string, string][]) =>
        rule({
          id: "linter/x",
          message: "{{message}} ({{ruleId}})",
          contextByRule: new Map(map.map(([id, one]) => [id, [ref(one)]])),
        })
      const lint = (linted: ReturnType<typeof linter>, ruleIds: string[]) =>
        ruleIds.map((ruleId, line) => ({
          rule: linted,
          id: `f${line}`,
          status: "new" as const,
          match: {
            file: "a.ts",
            line: line + 1,
            endLine: line + 1,
            column: 1,
            text: "",
            captures: { message: `m${line}`, ruleId },
          },
        }))
      /** What is wrong with a delivery at this limit: a named section a sent one includes, or one that fits. */
      const problems = (decision: Awaited<ReturnType<typeof decide>>, limit: number) => {
        const found: string[] = []
        const { references } = decision.delivery
        const full = references.filter((one) => one.state === "full").map((one) => one.ref)
        for (const named of references.filter((one) => one.state === "read")) {
          if (full.some((sent) => inside(sent, named.ref))) {
            found.push(`${named.ref} is named though a sent reference includes it`)
            continue
          }
          // Sent instead, with the references it includes left out.
          const instead = {
            ...decision.delivery,
            references: references
              .filter((one) => !inside(named.ref, one.ref))
              .map((one) => (one === named ? { ref: one.ref, state: "full" as const, content: texts[one.ref] } : one)),
          }
          const length = renderAgentText(instead, { maxMatchesPerRule: 10 }).length
          // Less 3: the budget prices every line with its newline, the blank line after a reference
          // and the one closing the list; when that reference is printed last, the renderer drops both
          // blank lines and the last newline.
          if (length <= limit - 3) found.push(`${named.ref} is named though sending it prints ${length}`)
        }
        return found
      }

      test("a container that comes first counts the lines of the parts it will replace", async () => {
        const touches = [touch("x", ["@docs/a.md#s1"]), touch("y", ["@docs/a.md#t11", "@docs/a.md#s1", "@docs/b.md"])]
        const decision = await decideAt(touches, 380)
        expect(problems(decision, 380)).toEqual([])
        expect(refsOf(decision)).toEqual([
          ["docs/a.md#s1", "full"],
          ["docs/b.md", "read"],
        ])
      })

      test("with findings shown, the budget does not keep room for the title printed without them", async () => {
        // The conventions title is longer than "1 rule violated in a.ts". It prints only when the
        // budget cuts every finding, and was charged even when the floor kept them.
        const linted = linter([
          ["r1", "@docs/a.md#s1"],
          ["r2", "@docs/c.md#k"],
        ])
        const findings = lint(linted, ["r2", "r1"])
        const bad: string[] = []
        let shown = 0
        for (let limit = 250; limit <= 450; limit++) {
          const decision = await decideAt([touch("t", ["@docs/a.md#s1"])], limit, findings)
          expect(renderAgentText(decision.delivery, { maxMatchesPerRule: 10 }).length).toBeLessThanOrEqual(limit)
          if (decision.overflow !== null) continue
          if (decision.delivery.findings.length === 2) shown++
          for (const problem of problems(decision, limit)) bad.push(`${limit}: ${problem}`)
        }
        expect(shown).toBeGreaterThan(0)
        expect(bad).toEqual([])
      })

      test("the floor keeps a rule that fits beside the title it prints with", async () => {
        // The smallest budget that keeps the rule's finding is what that delivery prints with every
        // reference only named: no room is held for the longer title printed when no rule is kept.
        const linted = linter([["r1", "@docs/c.md#k"]])
        const findings = lint(linted, ["r1"])
        const touches = [touch("t", ["@docs/b.md"])]
        let smallest: Awaited<ReturnType<typeof decide>> | null = null
        let at = 0
        for (let limit = 150; limit <= 450 && smallest === null; limit++) {
          const decision = await decideAt(touches, limit, findings)
          if (decision.delivery.findings.length > 0) [smallest, at] = [decision, limit]
        }
        expect(smallest).not.toBeNull()
        const named = {
          ...smallest!.delivery,
          references: smallest!.delivery.references.map((one) => ({
            ref: one.ref,
            state: "read" as const,
            reason: "budget" as const,
          })),
        }
        // Plus 2: the blank line closing the references and the newline after the last line are
        // priced, and the renderer prints neither when a reference's line is last.
        expect(at).toBeLessThanOrEqual(renderAgentText(named, { maxMatchesPerRule: 10 }).length + 2)
      })

      test("room a later section frees is given to one named earlier", async () => {
        // c.md#k costs less sent than named, so after it there is room b.md lacked at its turn.
        const touches = [touch("y", ["@docs/b.md", "@docs/c.md#k"])]
        const bad: string[] = []
        for (let limit = 200; limit <= 500; limit++) {
          const decision = await decideAt(touches, limit)
          for (const problem of problems(decision, limit)) bad.push(`${limit}: ${problem}`)
        }
        expect(bad).toEqual([])
      })

      test("a part named before its container is sent is left out with it", async () => {
        const touches = [
          touch("one", ["@docs/a.md", "@docs/a.md#t01", "@docs/a.md#s0"]),
          touch("two", ["@docs/a.md#t01", "@docs/a.md#t00"]),
          touch("three", ["@docs/a.md#t00", "@docs/b.md", "@docs/a.md#t10"]),
        ]
        const bad: string[] = []
        for (let limit = 300; limit <= 900; limit += 2) {
          const decision = await decideAt(touches, limit)
          for (const problem of problems(decision, limit)) bad.push(`${limit}: ${problem}`)
        }
        expect(bad).toEqual([])
      })

      test("random sets of overlapping touch rules, at every budget above the floor", async () => {
        let seed = 7
        const random = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648
          return seed / 2147483648
        }
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!
        const refs = Object.keys(texts).map((one) => `@${one}`)
        const bad: string[] = []
        for (let round = 0; round < 120; round++) {
          const touches = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, rule) =>
            touch(`t${rule}`, [...new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(refs)))]),
          )
          const floor = renderAgentText((await decideAt(touches, 1)).delivery, { maxMatchesPerRule: 10 }).length
          for (let limit = floor; limit <= 900; limit += 7) {
            const decision = await decideAt(touches, limit)
            const length = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 }).length
            if (length > limit) bad.push(`round ${round} at ${limit}: prints ${length}`)
            for (const problem of problems(decision, limit)) bad.push(`round ${round} at ${limit}: ${problem}`)
          }
        }
        expect(bad.slice(0, 10)).toEqual([])
      })

      test("random sets of touch rules and lint findings that cite the same sections", async () => {
        let seed = 11
        const random = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648
          return seed / 2147483648
        }
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!
        const refs = Object.keys(texts).map((one) => `@${one}`)
        const bad: string[] = []
        for (let round = 0; round < 120; round++) {
          const touches = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, rule) =>
            touch(`t${rule}`, [...new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(refs)))]),
          )
          const linted = linter([
            ["r1", pick(refs)],
            ["r2", pick(refs)],
          ])
          const findings = lint(
            linted,
            Array.from({ length: Math.floor(random() * 4) }, () => pick(["r1", "r2", "r3"])),
          )
          const floor = renderAgentText((await decideAt(touches, 1, findings)).delivery, {
            maxMatchesPerRule: 10,
          }).length
          for (let limit = floor; limit <= 900; limit += 7) {
            const decision = await decideAt(touches, limit, findings)
            const length = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 }).length
            if (length > limit) bad.push(`round ${round} at ${limit}: prints ${length}`)
            // With a whole rule cut, the budget keeps room for the lines naming the overflow file, which
            // the hook adds after decide; without them here, the room left over is not what it seems.
            if (decision.overflow !== null) continue
            for (const problem of problems(decision, limit)) bad.push(`round ${round} at ${limit}: ${problem}`)
          }
        }
        expect(bad.slice(0, 10)).toEqual([])
      })
    })
  })

  test("a section shorter than the line that would replace it is never demoted for the budget", async () => {
    // Demoting it would print "read this before continuing (not included, too long …)" in its
    // place, which is longer than the section. Exact pricing sees that; estimates could not.
    const decision = await decide(
      input({
        // Above the floor — below about 200 the rule and both its references are dropped whole.
        maxContextChars: 300,
        findings: [violated("r", [ref("@conventions/state.md"), ref("@conventions/api.md#errors")])],
      }),
    )
    expect(decision.delivery.references.map((r) => r.state)).toEqual(["full", "full"])
  })

  test("read references from a rule repo carry their absolute location", async () => {
    const repo = { dir: "/cache/repos/acme/v1", label: "acme/rules@v1" }
    const repoResolver = fakeResolver({
      "/cache/repos/acme/v1/docs/state.md": "# State",
      "/cache/repos/acme/v1/big.md": "x".repeat(500),
    })
    const decision = await decide(
      input({
        resolver: repoResolver,
        findings: [
          violated("r1", [parseReference("@docs/state.md", "read", repo), parseReference("@big.md", "inject", repo)]),
        ],
      }),
    )
    expect(decision.delivery.references).toEqual([
      {
        ref: "acme/rules@v1:docs/state.md",
        state: "read",
        reason: "mode",
        location: "/cache/repos/acme/v1/docs/state.md",
      },
      { ref: "acme/rules@v1:big.md", state: "read", reason: "tooLarge", location: "/cache/repos/acme/v1/big.md" },
    ])
  })
})

describe("decide: a lint rule's sections", () => {
  const linter = rule({
    id: "linter/eslint",
    message: "{{message}} ({{ruleId}})",
    context: [ref("@conventions/state.md")],
    contextByRule: new Map([
      ["eqeqeq", [ref("@conventions/api.md#errors")]],
      ["no-console", [ref("@conventions/api.md#retries")]],
    ]),
  })
  const lint = (ruleId: string, line: number) => ({
    rule: linter,
    match: { file: "a.ts", line, endLine: line, column: 1, text: "", captures: { message: `m${line}`, ruleId } },
    id: `id${line}`,
    status: "new" as const,
  })

  test("a lint rule's mapped section is delivered with the finding that fired it, and not for one that did not fire", async () => {
    const decision = await decide(input({ findings: [lint("eqeqeq", 1), lint("eqeqeq", 2), lint("other", 3)] }))
    expect(decision.delivery.references.map((one) => one.ref)).toEqual([
      "conventions/state.md",
      "conventions/api.md#errors",
    ])
    expect(decision.delivery.findings.map((finding) => finding.docs)).toEqual([
      { ref: "conventions/api.md#errors" },
      { ref: "conventions/api.md#errors" },
      undefined,
    ])
  })

  test("a mapped section already delivered is a pointer, and the finding still says see", async () => {
    const context = emptyContext()
    context.delivered.push({
      path: "conventions/api.md",
      anchor: "errors",
      hash: fnv1a(files["conventions/api.md#errors"]),
    })
    const decision = await decide(input({ context, findings: [lint("eqeqeq", 1)] }))
    expect(decision.delivery.references).toContainEqual({ ref: "conventions/api.md#errors", state: "pointer" })
    expect(decision.delivery.findings[0]!.docs).toEqual({ ref: "conventions/api.md#errors" })
    const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
    expect(text).toContain("    see conventions/api.md#errors")
    expect(text).toContain("--- conventions/api.md#errors (provided earlier in this session) ---")
  })
})
