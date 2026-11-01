import { describe, expect, test } from "vitest"

import { combineDeliveries } from "../../../src/core/delivery/combine"
import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { type Delivery, emptyDelivery, type Finding } from "../../../src/core/types"

const finding = (rule: string, file: string): Finding => ({
  rule,
  severity: "error",
  id: `${rule}:${file}`,
  status: "new",
  file,
  line: 1,
  endLine: 1,
  column: 1,
  message: `${file}:1 broke ${rule}`,
  count: 1,
})

const delivery = (part: Partial<Delivery>): Delivery => ({ ...emptyDelivery(), ...part })

/** The agent is at the repository root; one config there, one in backend/. */
const FROM = "/repo"
const top = (part: Partial<Delivery>) => ({ root: "/repo", delivery: delivery(part) })
const backend = (part: Partial<Delivery>) => ({ root: "/repo/backend", delivery: delivery(part) })

describe("combineDeliveries", () => {
  test("one part is returned as it is", () => {
    const only = top({ warnings: ["w"], findings: [finding("r", "a.ts")] })
    expect(combineDeliveries([only], FROM)).toBe(only.delivery)
  })

  const stops: Delivery["stop"][] = ["block", "report", "incomplete", "capReached", "allow", null]
  test.each(stops.flatMap((stronger, at) => stops.slice(at).map((weaker) => [stronger, weaker] as const)))(
    "stop %s wins over %s, whichever part says it",
    (stronger, weaker) => {
      expect(combineDeliveries([top({ stop: stronger }), backend({ stop: weaker })], FROM).stop).toBe(stronger)
      expect(combineDeliveries([top({ stop: weaker }), backend({ stop: stronger })], FROM).stop).toBe(stronger)
    },
  )

  test("unattended when any part is", () => {
    expect(combineDeliveries([top({}), backend({ unattended: true })], FROM).unattended).toBe(true)
    expect(combineDeliveries([top({}), backend({})], FROM).unattended).toBeUndefined()
  })

  test("warnings and notices are labelled with their config, only when there are several parts", () => {
    const alone = combineDeliveries([backend({ warnings: ["w"], notices: ["n"] })], FROM)
    expect(alone.warnings).toEqual(["w"])
    expect(alone.notices).toEqual(["n"])

    const both = combineDeliveries([top({ warnings: ["a"] }), backend({ warnings: ["b"], notices: ["n"] })], FROM)
    expect(both.warnings).toEqual([".rulecast-config.yaml: a", "backend/.rulecast-config.yaml: b"])
    expect(both.notices).toEqual(["backend/.rulecast-config.yaml: n"])
  })

  test("labels are relative to where the agent is", () => {
    const both = combineDeliveries([top({ warnings: ["a"] }), backend({ warnings: ["b"] })], "/repo/backend")
    expect(both.warnings).toEqual(["../.rulecast-config.yaml: a", ".rulecast-config.yaml: b"])
  })

  test("findings, touches and overflow paths are concatenated in part order", () => {
    const both = combineDeliveries(
      [
        top({ findings: [finding("r", "a.ts")], touches: ["a.ts"], overflowPaths: [".rulecast/deliveries/1.md"] }),
        backend({
          findings: [finding("s", "backend/b.py")],
          touches: ["backend/b.py"],
          overflowPaths: ["backend/.rulecast/deliveries/2.md"],
        }),
      ],
      FROM,
    )
    expect(both.findings.map((f) => f.file)).toEqual(["a.ts", "backend/b.py"])
    expect(both.touches).toEqual(["a.ts", "backend/b.py"])
    expect(both.overflowPaths).toEqual([".rulecast/deliveries/1.md", "backend/.rulecast/deliveries/2.md"])
    expect(both.configs).toEqual([".rulecast-config.yaml", "backend/.rulecast-config.yaml"])
  })

  test("omitted findings are merged per rule, counts and files summed", () => {
    const both = combineDeliveries(
      [
        top({ omitted: { findings: [{ rule: "r", count: 3, files: 2 }], rules: 1, preexisting: 4 } }),
        backend({
          omitted: {
            findings: [
              { rule: "r", count: 2, files: 1 },
              { rule: "r", count: 5, files: 1, swept: true },
              { rule: "s", count: 1, files: 1 },
            ],
            rules: 2,
            preexisting: 1,
          },
        }),
      ],
      FROM,
    )
    expect(both.omitted).toEqual({
      findings: [
        { rule: "r", count: 5, files: 3 },
        { rule: "r", count: 5, files: 1, swept: true },
        { rule: "s", count: 1, files: 1 },
      ],
      rules: 3,
      preexisting: 5,
    })
  })

  test("one rule from two parts, both cut: '…and N more' counts each file the rest is in once", () => {
    const at = (file: string, line: number) => ({ ...finding("r", file), id: `${file}:${line}`, line })
    const cut = (file: string) => ({
      findings: [{ rule: "r", count: 1, files: 0, inFiles: [file] }],
      rules: 0,
      preexisting: 0,
    })
    const both = combineDeliveries(
      [
        top({ findings: [1, 2, 3].map((line) => at("a.py", line)), templates: { r: "m" }, omitted: cut("a.py") }),
        backend({
          findings: [1, 2, 3].map((line) => at("backend/b.py", line)),
          templates: { r: "m" },
          omitted: cut("backend/b.py"),
        }),
      ],
      FROM,
    )
    expect(both.omitted.findings).toEqual([{ rule: "r", count: 2, files: 0, inFiles: ["a.py", "backend/b.py"] }])
    // Three of a.py shown; three of backend/b.py hidden by the cap, and one cut from each file.
    expect(renderAgentText(both, { maxMatchesPerRule: 3 })).toContain("…and 5 more in 2 files")
  })

  test("one rule id with different templates: the later part's rule is labelled with its config dir", () => {
    const both = combineDeliveries(
      [
        top({ findings: [finding("no-print", "a.py")], templates: { "no-print": "print: {{match}}" } }),
        backend({
          findings: [finding("no-print", "backend/b.py")],
          templates: { "no-print": "no print here" },
          omitted: { findings: [{ rule: "no-print", count: 2, files: 1 }], rules: 0, preexisting: 0 },
        }),
      ],
      FROM,
    )
    expect(both.findings.map((f) => f.rule)).toEqual(["no-print", "no-print (backend)"])
    expect(both.templates).toEqual({ "no-print": "print: {{match}}", "no-print (backend)": "no print here" })
    expect(both.omitted.findings).toEqual([{ rule: "no-print (backend)", count: 2, files: 1 }])
  })

  test("one rule id with identical templates groups as one rule", () => {
    const both = combineDeliveries(
      [
        top({ findings: [finding("no-print", "a.py")], templates: { "no-print": "same" } }),
        backend({ findings: [finding("no-print", "backend/b.py")], templates: { "no-print": "same" } }),
      ],
      FROM,
    )
    expect(both.findings.map((f) => f.rule)).toEqual(["no-print", "no-print"])
    expect(both.templates).toEqual({ "no-print": "same" })
  })

  test("references: the same ref at two locations are both kept; the same one keeps its fullest state", () => {
    const both = combineDeliveries(
      [
        top({
          references: [
            { ref: "docs/style.md", state: "pointer" },
            { ref: "docs/style.md", state: "read", location: ".rulecast/refs/a.md" },
          ],
        }),
        backend({
          references: [
            { ref: "docs/style.md", state: "full", content: "x" },
            { ref: "docs/style.md", state: "read", location: "backend/.rulecast/refs/a.md" },
          ],
        }),
      ],
      FROM,
    )
    expect(both.references).toEqual([
      { ref: "docs/style.md", state: "full", content: "x" },
      { ref: "docs/style.md", state: "read", location: ".rulecast/refs/a.md" },
      { ref: "docs/style.md", state: "read", location: "backend/.rulecast/refs/a.md" },
    ])
  })
})
