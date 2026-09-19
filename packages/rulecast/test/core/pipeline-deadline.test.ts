import { expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

const schema = z.object({}).strict()

/** Never finishes, so it always misses the deadline. */
const slowDetector: Detector<z.infer<typeof schema>> = {
  kind: "slow",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: () => new Promise(() => {}),
}

test("an edit names the detector kinds whose results were dropped at the deadline", async () => {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig(
      [{ id: "slow/rule", name: "Slow", files: "^app/.*\\.py$", detect: { slow: {} }, message: "m" }],
      { timeouts: { edit_deadline_ms: 20 } },
    ),
    "app/a.py": "x = 1\n",
  })
  const result = await pipelineAt(
    root,
    { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
    { registry: createRegistry([...builtinDetectors, slowDetector]) },
  )
  expect(result.deadlineMissed).toEqual(["slow"])
  expect(result.failed).toBe(false)
})
