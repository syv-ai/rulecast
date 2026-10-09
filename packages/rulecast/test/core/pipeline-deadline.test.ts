import { expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { llmDetector } from "../../src/detectors/llm/detector"
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

test("a verify names the timeout, the setting to raise, and the rules whose results were dropped", async () => {
  // Spec §14: verify timeout → results dropped, one warning naming the rules. Found untested by
  // a field trial, where a real llm call took 89 s against the 60 s default and the warning said only
  // "timed out" — true, and no help at all.
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig(
      [
        { id: "slow/a", name: "Slow A", files: "^app/.*\\.py$", detect: { slow: {} }, message: "m" },
        { id: "slow/b", name: "Slow B", files: "^app/.*\\.py$", detect: { slow: {} }, message: "m" },
      ],
      { timeouts: { verify_ms: 20 } },
    ),
    "app/a.py": "x = 1\n",
  })
  const result = await pipelineAt(
    root,
    // No session: a session verify filters files whose change set is empty, and nothing has been
    // edited here. This is the shape `rulecast run` produces.
    { kind: "verify", files: ["app/a.py"], cwd: root },
    { registry: createRegistry([...builtinDetectors, slowDetector]) },
  )
  expect(result.failed).toBe(true)
  expect(result.delivery.warnings).toHaveLength(1)
  expect(result.delivery.warnings[0]).toBe(
    "slow detector timed out after 20 ms for slow/a, slow/b. Raise timeouts.verify_ms.",
  )
})

test("a detector's timeout hint is added to its warning, whatever the detector is called", async () => {
  // Until plan 9 Task 7 this faked a detector *named* "llm", because the pipeline compared the kind
  // to that string. The hint is now the detector's own declaration, so the fake is deliberately
  // called something else: if the wording comes back, it came from `timeoutHint`.
  const hinted: Detector<z.infer<typeof schema>> = {
    ...slowDetector,
    kind: "hinted",
    timeoutHint: "a hinted rule can need 120000 or more",
  }
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig(
      [{ id: "tone", name: "Tone", files: "^app/.*\\.py$", stages: ["verify"], detect: { hinted: {} }, message: "m" }],
      { timeouts: { verify_ms: 20 } },
    ),
    "app/a.py": "x = 1\n",
  })
  const result = await pipelineAt(
    root,
    { kind: "verify", files: ["app/a.py"], cwd: root },
    { registry: createRegistry([...builtinDetectors, hinted]) },
  )
  expect(result.delivery.warnings[0]).toBe(
    "hinted detector timed out after 20 ms for tone. Raise timeouts.verify_ms (a hinted rule can need 120000 or more).",
  )
})

test("the llm detector declares the hint a field trial showed it needs", () => {
  // A real haiku call on a 135-line file measured 89 s against the 60 s default.
  expect(llmDetector.timeoutHint).toBe("an llm rule on a large file can need 120000 or more")
})
