import { describe, expect, test } from "vitest"
import { z } from "zod"

import { recordFingerprints } from "../../../src/core/baseline/record"
import { memoryCache } from "../../../src/core/detection/cache"
import { createRegistry } from "../../../src/core/detection/registry"
import { type Detector, defaultDetectorSettings } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { localConfig } from "../../helpers/config"
import { createRepo } from "../../helpers/git"
import { pipelineAt } from "../../helpers/pipeline"
import { rule } from "../../helpers/rules"

/**
 * Spec §6, Consent, as a declaration rather than a name.
 *
 * Until plan 9 Task 7 every rule the core applied to the llm detector was written as
 * `kind === "llm"`, at eight sites in six files, so a second detector that costs money would have
 * needed all eight edits. These tests use a detector called `paid` and never use the old name
 * in code: if they pass, the core asked the registry, and a second metered detector costs no
 * core edit at all.
 */

const schema = z.object({}).strict()

/** Fires once on every file it is given, and counts how many times it was asked. */
function paidDetector(): Detector<z.infer<typeof schema>> & { calls: number } {
  const detector = {
    kind: "paid",
    schema,
    captures: () => [],
    events: () => ["edit", "verify"] as ("edit" | "verify")[],
    metered: true,
    cost: () => "paid · bills per file",
    fileBudget: () => ({ max: 1, setting: "paid.max_files" }),
    calls: 0,
    async run(input: Parameters<Detector<z.infer<typeof schema>>["run"]>[0]) {
      detector.calls++
      return {
        findings: input.rules.flatMap((one) =>
          one.files.map((file) => ({
            rule: one.id,
            match: { file, line: 1, endLine: 1, column: 1, text: "", captures: {} },
          })),
        ),
        errors: [],
      }
    },
  }
  return detector
}

describe("a metered detector, by declaration", () => {
  test("a verify gives it only its file budget, and the warning names the setting it declared", async () => {
    const paid = paidDetector()
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "paid/rule",
          name: "Paid",
          files: "^app/.*\\.py$",
          stages: ["verify"],
          detect: { paid: {} },
          message: "m",
        },
      ]),
      "app/a.py": "x = 1\n",
      "app/b.py": "y = 2\n",
    })
    const result = await pipelineAt(
      root,
      { kind: "verify", files: ["app/a.py", "app/b.py"], cwd: root },
      { registry: createRegistry([...builtinDetectors, paid]) },
    )
    expect(result.delivery.findings).toHaveLength(1)
    expect(result.delivery.warnings).toEqual([
      "paid rules checked 1 files; 1 were not checked: app/b.py. Raise paid.max_files, or run rulecast run --files on them.",
    ])
    // Staying inside a budget the project set is normal operation, not a rulecast failure.
    expect(result.failed).toBe(false)
  })

  test("a container rule of a metered kind is never fingerprinted, so opening a file costs nothing", async () => {
    const paid = paidDetector()
    const records = await recordFingerprints({
      detection: {
        root: "/project",
        registry: createRegistry([...builtinDetectors, paid]),
        settings: defaultDetectorSettings(),
        cacheFor: () => memoryCache(),
        contextFor: async () => [],
      },
      files: ["app/a.py"],
      rules: [
        rule({
          id: "paid/container",
          files: "^app/",
          scope: "container",
          stages: ["edit"],
          detector: { kind: "paid", config: {}, captures: [] },
          message: "m",
        }),
      ],
      disabled: new Set(),
      read: async () => "x = 1\n",
      event: "edit",
      timeoutMs: 1_000,
      source: "disk",
    })
    expect(records).toEqual([])
    expect(paid.calls).toBe(0)
  })

  test("the same container rule without the declaration is fingerprinted — the test above is not vacuous", async () => {
    const free = { ...paidDetector(), metered: false }
    const records = await recordFingerprints({
      detection: {
        root: "/project",
        registry: createRegistry([...builtinDetectors, free]),
        settings: defaultDetectorSettings(),
        cacheFor: () => memoryCache(),
        contextFor: async () => [],
      },
      files: ["app/a.py"],
      rules: [
        rule({
          id: "paid/container",
          files: "^app/",
          scope: "container",
          stages: ["edit"],
          detector: { kind: "paid", config: {}, captures: [] },
          message: "m",
        }),
      ],
      disabled: new Set(),
      read: async () => "x = 1\n",
      event: "edit",
      timeoutMs: 1_000,
      source: "disk",
    })
    expect(records).toEqual([{ t: "fingerprint", file: "app/a.py", rule: "paid/container", ranges: [[1, 1]] }])
  })
})
