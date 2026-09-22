import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/project"
import { checkableKinds, checkDetectors } from "../../../src/core/detection/check"
import { createRegistry } from "../../../src/core/detection/registry"
import { cachedRepos } from "../../../src/core/repos/provider"
import { type CheckResult, type Detector, type DetectorCheck, defaultDetectorSettings } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { localConfig } from "../../helpers/config"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const schema = z.object({ size: z.number() }).strict()
type Config = z.infer<typeof schema>

/** A detector that records what its check was handed and answers with `results`. */
function checky(kind: string, calls: DetectorCheck<Config>[], results: CheckResult[] | Error): Detector<Config> {
  return {
    kind,
    schema,
    captures: () => [],
    events: () => ["verify"],
    run: async () => ({ findings: [], errors: [] }),
    check: async (input) => {
      calls.push(input)
      if (results instanceof Error) throw results
      return results
    },
  }
}

const ok = (what: string): CheckResult => ({ what, level: "ok", detail: "fine", rules: [] })

async function setup(results: CheckResult[] | Error = [ok("first"), ok("second")]) {
  const calls: DetectorCheck<Config>[] = []
  // "idle" has a check but no rule in the project; "regex" has rules but no check.
  const registry = createRegistry([
    ...builtinDetectors,
    checky("checky", calls, results),
    checky("idle", [], [ok("never")]),
  ])
  const root = await createProject({
    ".rulecast-config.yaml": localConfig([
      { id: "a", name: "A", files: "\\.ts$", detect: { checky: { size: 2 } }, message: "m" },
      { id: "b", name: "B", files: "\\.ts$", detect: { checky: { size: 3 } }, message: "m" },
      { id: "c", name: "C", files: "\\.ts$", detect: { regex: { pattern: "x" } }, message: "m" },
    ]),
  })
  const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
  expect(project.diagnostics).toEqual([])
  const env = { RULECAST_HOME: TEST_HOME, MADE_UP: "yes" }
  const check = () => checkDetectors({ project, registry, settings: defaultDetectorSettings(), env, timeoutMs: 5000 })
  return { root, project, registry, calls, env, check }
}

describe("detector checks", () => {
  test("checkable kinds are the project's detector kinds whose detector has checks", async () => {
    const { project, registry } = await setup()
    expect(checkableKinds(project, registry)).toEqual(["checky"])
  })

  test("returns each result in the order the detector gave them, tagged with the kind", async () => {
    const { check } = await setup()
    expect(await check()).toEqual([
      { kind: "checky", what: "first", level: "ok", detail: "fine", rules: [] },
      { kind: "checky", what: "second", level: "ok", detail: "fine", rules: [] },
    ])
  })

  test("hands the detector its own rules, the settings and the environment", async () => {
    const { root, calls, env, check } = await setup()
    await check()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules).toEqual([
      { id: "a", config: { size: 2 } },
      { id: "b", config: { size: 3 } },
    ])
    expect(calls[0]!.settings).toEqual(defaultDetectorSettings())
    expect(calls[0]!.env).toBe(env)
    expect(calls[0]!.cwd).toBe(root)
  })

  test("a detector with no rule in the project is not called", async () => {
    const { registry, check } = await setup()
    const idle = registry.get("idle")!
    const calls: unknown[] = []
    // The "idle" detector was built with its own empty call list; its results must not appear.
    expect(idle.check).toBeDefined()
    expect((await check()).map((result) => result.what)).toEqual(["first", "second"])
    expect(calls).toEqual([])
  })

  test("a check that throws becomes one error naming the kind and every rule of it", async () => {
    const { check } = await setup(new Error("the parser would not load"))
    expect(await check()).toEqual([
      {
        kind: "checky",
        what: "checky",
        level: "error",
        detail: "the parser would not load",
        rules: ["a", "b"],
      },
    ])
  })
})
