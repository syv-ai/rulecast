import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { displayPath } from "../../../src/core/projects"
import { parseReference } from "../../../src/core/references"
import { type ClassifiedFinding, type DecideInput, decide, findingKey } from "../../../src/core/session/decide"
import { blockedKey, emptyContext, emptyWork } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const REPO = "/repo"
const ROOT = "/repo/backend"
const display = displayPath(ROOT, REPO)

const at = (file: string, line: number): Match => ({
  file,
  line,
  endLine: line,
  column: 1,
  text: `bad ${line}`,
  captures: {},
})
const finding = (
  file: string,
  line: number,
  status: "new" | "preexisting" = "new",
  overrides: Partial<Parameters<typeof rule>[0]> = {},
): ClassifiedFinding => ({
  id: `id-${file}-${line}`,
  rule: rule({ id: "a/rule", message: "{{file}}:{{line}} is bad", ...overrides }),
  match: at(file, line),
  status,
})

const base: DecideInput = {
  agent: "main",
  findings: [],
  touches: [],
  agentRead: null,
  warnings: [],
  work: emptyWork(),
  context: emptyContext(),
  resolver: fakeResolver({}),
  maxBytes: 10_000,
  maxBlocks: 3,
  maxContextChars: null,
  maxMatchesPerRule: 10,
  stopGate: false,
}

describe("decide with a display path", () => {
  test("an edit finding names the displayed file in its message and its file; its id is unchanged", async () => {
    const { delivery } = await decide({ ...base, findings: [finding("app/x.py", 3)], display })
    expect(delivery.findings).toEqual([
      expect.objectContaining({ id: "id-app/x.py-3", file: "backend/app/x.py", message: "backend/app/x.py:3 is bad" }),
    ])
  })

  test("without one, the delivery is the root's", async () => {
    const plain = await decide({ ...base, findings: [finding("app/x.py", 3)] })
    expect(plain.delivery.findings[0]).toMatchObject({ file: "app/x.py", message: "app/x.py:3 is bad" })
  })

  test("a refused shell write advises git checkout of the displayed file", async () => {
    const protectedRule = { refuseWrite: true, severity: "warning" as const }
    const { delivery } = await decide({
      ...base,
      findings: [finding("app/x.py", 1, "new", protectedRule)],
      refused: [{ file: "app/x.py", rule: "a/rule", dirtyAtStart: false }],
      display,
    })
    expect(delivery.refused).toEqual([{ file: "backend/app/x.py", rule: "a/rule", dirtyAtStart: false }])
    expect(renderAgentText(delivery, { maxMatchesPerRule: 10 })).toContain("git checkout -- backend/app/x.py")
  })

  test("swept files are listed displayed, and their findings print under the swept heading", async () => {
    const decision = await decide({
      ...base,
      findings: [finding("app/y.py", 2), finding("app/x.py", 5)],
      swept: ["app/y.py"],
      stopGate: true,
      display,
    })
    expect(decision.delivery.swept).toEqual(["backend/app/y.py"])
    // The agent's own finding still blocks; the swept one does not.
    expect(decision.delivery.stop).toBe("block")
    const text = renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })
    const heading = text.indexOf("changed outside your tool calls")
    expect(heading).toBeGreaterThan(text.indexOf("backend/app/x.py:5"))
    expect(text.indexOf("backend/app/y.py:2")).toBeGreaterThan(heading)
  })

  test("pre-existing summaries are displayed, and recorded as told under the root's path", async () => {
    const decision = await decide({ ...base, findings: [finding("app/x.py", 1, "preexisting")], display })
    expect(decision.delivery.preexistingSummary).toEqual([{ rule: "a/rule", file: "backend/app/x.py", count: 1 }])
    expect(decision.context).toContainEqual({ t: "preexisting", rule: "a/rule", file: "app/x.py" })
  })

  test("listed pre-existing findings are displayed too", async () => {
    const { delivery } = await decide({
      ...base,
      findings: [finding("app/x.py", 1, "preexisting")],
      listPreexisting: true,
      display,
    })
    expect(delivery.preexisting?.map((one) => one.file)).toEqual(["backend/app/x.py"])
  })

  test("the stop gate's repeat counting is the root's: a finding blocked twice is not blocked again", async () => {
    const fresh = finding("app/x.py", 3)
    const key = blockedKey("main", findingKey(fresh))
    const work = { ...emptyWork(), blockedFindings: new Map([[key, 2]]) }
    const decision = await decide({ ...base, findings: [fresh], work, stopGate: true, mode: "unattended", display })
    expect(decision.delivery.stop).toBe("report")
    expect([...(decision.blocking ?? [])]).toEqual([findingKey(fresh)])
  })

  test("the budget prices the displayed paths: a trimmed delivery still renders within its limit", async () => {
    const far = displayPath(ROOT, "/repo/backend/a/very/deep/directory/the/agent/started/in")
    const findings = Array.from({ length: 40 }, (_, n) => finding(`app/module_${n}.py`, n + 1))
    for (const limit of [300, 400, 500]) {
      const { delivery } = await decide({ ...base, findings, maxContextChars: limit, display: far })
      expect(delivery.findings[0]?.file.startsWith("../")).toBe(true)
      expect(renderAgentText({ ...delivery, overflowPaths: [] }, { maxMatchesPerRule: 10 }).length).toBeLessThanOrEqual(
        limit,
      )
    }
  })

  test("a project reference is labelled from where the agent is; its delivered record stays the root's", async () => {
    const spec = parseReference("@conventions/code.md#topic", "inject", { dir: ROOT, label: null })
    const decision = await decide({
      ...base,
      findings: [finding("app/x.py", 3, "new", { context: [spec] })],
      resolver: fakeResolver({ "conventions/code.md#topic": "## Topic\nDo it." }),
      display,
    })
    expect(decision.delivery.references).toEqual([
      { ref: "backend/conventions/code.md#topic", state: "full", content: "## Topic\nDo it." },
    ])
    expect(decision.context).toContainEqual(
      expect.objectContaining({ t: "delivered", path: "conventions/code.md", anchor: "topic" }),
    )
    expect(renderAgentText(decision.delivery, { maxMatchesPerRule: 10 })).toContain(
      "--- backend/conventions/code.md#topic ---",
    )
  })

  test("a demoted project reference keeps its displayed label, and the budget prices it", async () => {
    const spec = parseReference("@conventions/code.md#topic", "inject", { dir: ROOT, label: null })
    const findings = [finding("app/x.py", 3, "new", { context: [spec] })]
    const resolver = fakeResolver({ "conventions/code.md#topic": "x".repeat(400) })
    let kept = 0
    // Around the edge where the rule and its reference line just fit: priced by the root's shorter
    // label, the reference would be kept at limits its displayed line does not fit.
    for (let limit = 180; limit <= 260; limit++) {
      const { delivery } = await decide({ ...base, findings, resolver, maxContextChars: limit, display })
      if (delivery.references.length === 0) continue
      kept++
      expect(delivery.references).toEqual([
        { ref: "backend/conventions/code.md#topic", state: "read", reason: "budget" },
      ])
      expect(renderAgentText(delivery, { maxMatchesPerRule: 10 }).length).toBeLessThanOrEqual(limit)
    }
    expect(kept).toBeGreaterThan(0)
  })
})

describe("the '…and N more' line", () => {
  test("counts the files the cut findings are in, even when every one is a file already shown", async () => {
    const findings = Array.from({ length: 11 }, (_, n) => finding("app/x.py", n + 1))
    const { delivery } = await decide({ ...base, findings, maxContextChars: 10_000 })
    const text = renderAgentText(delivery, { maxMatchesPerRule: 10 })
    expect(text).toContain("…and 1 more in 1 file")
  })

  test("counts a file once when some cut findings share it with shown ones and some are elsewhere", async () => {
    const findings = [
      ...Array.from({ length: 12 }, (_, n) => finding("app/x.py", n + 1)),
      finding("app/y.py", 1),
      finding("app/y.py", 2),
    ]
    const { delivery } = await decide({ ...base, findings, maxContextChars: 10_000 })
    const text = renderAgentText(delivery, { maxMatchesPerRule: 10 })
    expect(text).toContain("…and 4 more in 2 files")
  })
})
