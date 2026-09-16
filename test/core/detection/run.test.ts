import { describe, expect, test } from "vitest"
import { z } from "zod"

import { memoryCache } from "../../../src/core/detection/cache"
import { createRegistry } from "../../../src/core/detection/registry"
import { runDetection } from "../../../src/core/detection/run"
import type { Detector, DetectorRun, Match } from "../../../src/core/types"
import { rule } from "../../helpers/rules"

const match = (file: string, captures: Record<string, string> = {}): Match => ({
  file,
  line: 1,
  endLine: 1,
  column: 1,
  text: "x",
  captures,
})

function detector(kind: string, run: Detector<unknown>["run"]): Detector<unknown> {
  return { kind, schema: z.unknown(), captures: () => [], events: () => ["edit", "verify"], run }
}

const detectorRule = (id: string, kind: string, captures: string[] = []) =>
  rule({ id, detector: { kind, config: { id }, captures, events: ["edit", "verify"] } })

function input(
  selections: { rule: ReturnType<typeof rule>; files: string[] }[],
  detectors: Detector<unknown>[],
  timeoutMs = 1000,
) {
  return {
    root: "/project",
    event: "edit" as const,
    selections,
    changes: new Map(),
    registry: createRegistry(detectors),
    cacheFor: () => memoryCache(),
    contextFor: async () => [],
    timeoutMs,
  }
}

describe("runDetection", () => {
  test("calls each detector kind once with all its rules", async () => {
    const calls: DetectorRun<unknown>[] = []
    const a = detector("a", async (run) => {
      calls.push(run)
      return { findings: run.rules.map((r) => ({ rule: r.id, match: match(r.files[0]!) })), errors: [] }
    })
    const r1 = detectorRule("r1", "a")
    const r2 = detectorRule("r2", "a")
    const output = await runDetection(
      input(
        [
          { rule: r1, files: ["x.ts"] },
          { rule: r2, files: ["y.ts"] },
        ],
        [a],
      ),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules.map((r) => [r.id, r.config, r.files])).toEqual([
      ["r1", { id: "r1" }, ["x.ts"]],
      ["r2", { id: "r2" }, ["y.ts"]],
    ])
    expect(output.findings.map((f) => [f.rule.id, f.match.file])).toEqual([
      ["r1", "x.ts"],
      ["r2", "y.ts"],
    ])
    expect(output.errors).toEqual([])
    expect(output.timedOut).toEqual([])
  })

  test("runs detector kinds in parallel", async () => {
    const order: string[] = []
    const slow = detector("slow", async () => {
      order.push("slow:start")
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push("slow:end")
      return { findings: [], errors: [] }
    })
    const fast = detector("fast", async () => {
      order.push("fast")
      return { findings: [], errors: [] }
    })
    await runDetection(
      input(
        [
          { rule: detectorRule("s", "slow"), files: ["a"] },
          { rule: detectorRule("f", "fast"), files: ["a"] },
        ],
        [slow, fast],
      ),
    )
    expect(order).toEqual(["slow:start", "fast", "slow:end"])
  })

  test("per-rule errors drop that rule's findings; thrown errors fail the whole run", async () => {
    const partial = detector("partial", async () => ({
      findings: [
        { rule: "good", match: match("a") },
        { rule: "bad", match: match("a") },
      ],
      errors: [{ rule: "bad", message: "config broke" }],
    }))
    const crashing = detector("crashing", async () => {
      throw new Error("process died")
    })
    const output = await runDetection(
      input(
        [
          { rule: detectorRule("good", "partial"), files: ["a"] },
          { rule: detectorRule("bad", "partial"), files: ["a"] },
          { rule: detectorRule("c1", "crashing"), files: ["a"] },
          { rule: detectorRule("c2", "crashing"), files: ["a"] },
        ],
        [partial, crashing],
      ),
    )
    expect(output.findings.map((f) => f.rule.id)).toEqual(["good"])
    expect(output.errors).toEqual([
      { kind: "partial", rules: ["bad"], message: "config broke" },
      { kind: "crashing", rules: ["c1", "c2"], message: "process died" },
    ])
  })

  test("a match missing a declared capture is a rule error", async () => {
    const d = detector("caps", async () => ({
      findings: [{ rule: "r", match: match("a", { other: "1" }) }],
      errors: [],
    }))
    const output = await runDetection(input([{ rule: detectorRule("r", "caps", ["NAMES"]), files: ["a"] }], [d]))
    expect(output.findings).toEqual([])
    expect(output.errors).toEqual([
      { kind: "caps", rules: ["r"], message: 'match is missing declared capture "NAMES"' },
    ])
  })

  test("findings for unselected rules are a whole-run error", async () => {
    const d = detector("stray", async () => ({ findings: [{ rule: "someone-else", match: match("a") }], errors: [] }))
    const output = await runDetection(input([{ rule: detectorRule("r", "stray"), files: ["a"] }], [d]))
    expect(output.errors).toEqual([
      { kind: "stray", rules: ["r"], message: 'detector reported unknown rule "someone-else"' },
    ])
  })

  test("runs past the deadline are aborted and reported as timed out", async () => {
    let aborted = false
    const hanging = detector("hanging", async (run) => {
      await new Promise((resolve) => run.signal.addEventListener("abort", resolve))
      aborted = true
      return { findings: [{ rule: "h", match: match("a") }], errors: [] }
    })
    const quick = detector("quick", async () => ({ findings: [{ rule: "q", match: match("a") }], errors: [] }))
    const output = await runDetection(
      input(
        [
          { rule: detectorRule("h", "hanging"), files: ["a"] },
          { rule: detectorRule("q", "quick"), files: ["a"] },
        ],
        [hanging, quick],
        20,
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(aborted).toBe(true)
    expect(output.findings.map((f) => f.rule.id)).toEqual(["q"])
    expect(output.timedOut).toEqual([{ kind: "hanging", rules: ["h"] }])
  })
})
