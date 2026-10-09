import { describe, expect, test } from "vitest"

import { fnv1a } from "../../../src/core/baseline/hash"
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
