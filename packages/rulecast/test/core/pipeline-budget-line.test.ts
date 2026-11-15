import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

// The developer, 2026-11-15: "llm rules checked 10 files; N were not checked" is a setting, not a
// problem anyone can fix at a stop. An agent's hooks never say it; the CLI still does.

const schema = z.object({}).strict()
/** A detector with a budget of one file per verify, which finds nothing. */
const budgeted: Detector<z.infer<typeof schema>> = {
  kind: "budgeted",
  schema,
  captures: () => [],
  events: () => ["verify"],
  fileBudget: () => ({ max: 1, setting: "budgeted.max_files" }),
  run: async () => ({ findings: [], errors: [] }),
}

describe("the file-budget line", () => {
  test.each([
    [true, false],
    [false, true],
  ])("agentHook %s: said %s", async (agentHook, said) => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        { id: "b/rule", name: "B", files: "\\.py$", detect: { budgeted: {} }, message: "m" },
      ]),
      "a.py": "a = 1\n",
      "b.py": "b = 1\n",
    })
    await writeFile(path.join(root, "a.py"), "a = 2\n")
    await writeFile(path.join(root, "b.py"), "b = 2\n")
    const session = { id: "s1" }
    const registry = createRegistry([...builtinDetectors, budgeted])
    for (const file of ["a.py", "b.py"]) {
      await pipelineAt(root, { kind: "edit", files: [file], cwd: root, session }, { registry, agentHook })
    }
    const { delivery } = await pipelineAt(
      root,
      { kind: "verify", files: [], cwd: root, session },
      { registry, agentHook, stopGate: true },
    )
    expect(delivery.warnings.some((warning) => warning.includes("were not checked"))).toBe(said)
  })
})
