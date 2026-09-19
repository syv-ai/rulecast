import { expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import { runPipeline } from "../../src/core/pipeline"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"

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
    ".rulecast/config.yml": "timeouts:\n  editDeadlineMs: 20\n",
    ".rulecast/rules/slow.yml": "id: slow/rule\nfiles: app/**/*.py\ndetect: { slow: {} }\nmessage: m\n",
    "app/a.py": "x = 1\n",
  })
  const result = await runPipeline({
    root,
    stateDir: stateDirFor(root),
    event: { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
    registry: createRegistry([...builtinDetectors, slowDetector]),
    maxContextChars: null,
  })
  expect(result.deadlineMissed).toEqual(["slow"])
  expect(result.failed).toBe(false)
})
