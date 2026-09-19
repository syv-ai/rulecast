import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/project"
import { createRegistry } from "../../../src/core/detection/registry"
import { warmableKinds, warmDetectors } from "../../../src/core/detection/warm"
import { cachedRepos } from "../../../src/core/repos/provider"
import type { Detector, DetectorWarm } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { localConfig } from "../../helpers/config"
import { stateDirFor, TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const schema = z.object({ size: z.number() }).strict()
type Config = z.infer<typeof schema>

function warmy(calls: DetectorWarm<Config>[], fail: boolean): Detector<Config> {
  return {
    kind: "warmy",
    schema,
    captures: () => [],
    events: () => ["verify"],
    run: async () => ({ findings: [], errors: [] }),
    warm: async (input) => {
      calls.push(input)
      if (fail) throw new Error("model build failed")
    },
  }
}

async function setup(fail = false) {
  const calls: DetectorWarm<Config>[] = []
  const registry = createRegistry([...builtinDetectors, warmy(calls, fail)])
  const root = await createProject({
    ".rulecast-config.yaml": localConfig([
      { id: "warm/a", name: "Warm", files: "\\.ts$", detect: { warmy: { size: 2 } }, message: "m" },
      { id: "plain/b", name: "Plain", files: "\\.ts$", detect: { regex: { pattern: "x" } }, message: "m" },
    ]),
  })
  const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
  expect(project.diagnostics).toEqual([])
  const stateDir = stateDirFor(root)
  const warm = (kinds: string[] | null = null) =>
    warmDetectors({ root, stateDir, project, registry, kinds, timeoutMs: 5000 })
  return { root, stateDir, project, registry, calls, warm }
}

describe("detector warm-up", () => {
  test("warmable kinds are the project's detector kinds that have warm-up work", async () => {
    const { project, registry } = await setup()
    expect(warmableKinds(project, registry)).toEqual(["warmy"])
  })

  test("warms each kind once with all of its rules", async () => {
    const { root, calls, warm } = await setup()
    expect(await warm()).toEqual({ warmed: ["warmy"], skipped: [], errors: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules).toEqual([{ id: "warm/a", config: { size: 2 } }])
    expect(calls[0]!.cwd).toBe(root)
  })

  test("only the requested kinds are warmed", async () => {
    const { calls, warm } = await setup()
    expect(await warm(["regex"])).toEqual({ warmed: [], skipped: [], errors: [] })
    expect(calls).toEqual([])
  })

  test("a kind already warming elsewhere is skipped", async () => {
    const { stateDir, calls, warm } = await setup()
    await mkdir(path.join(stateDir, "warm/warmy/.lock"), { recursive: true })
    expect(await warm()).toEqual({ warmed: [], skipped: ["warmy"], errors: [] })
    expect(calls).toEqual([])
  })

  test("a failing warm-up is reported and releases its lock", async () => {
    const { stateDir, warm } = await setup(true)
    expect(await warm()).toEqual({
      warmed: [],
      skipped: [],
      errors: [{ kind: "warmy", message: "model build failed" }],
    })
    expect(existsSync(path.join(stateDir, "warm/warmy/.lock"))).toBe(false)
  })
})
