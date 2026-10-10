import { readdir } from "node:fs/promises"
import { describe, expect, test } from "vitest"

import type { CompiledRule, DetectorRule } from "../../src/core/compile/rule"
import type { RuleExamples } from "../../src/core/config/schema"
import { memoryCache } from "../../src/core/detection/cache"
import { EXAMPLES_DIR, type ExampleResult, runExamples } from "../../src/core/examples"
import { defaultDetectorSettings } from "../../src/core/types"
import { registry } from "../helpers/fixture"
import { brokenTool, linkTool, stubTool } from "../helpers/linters"
import { createProject } from "../helpers/project"
import { rule as compiledRule } from "../helpers/rules"

const PY = "app/services/users.py"

function detectorRule(overrides: Partial<CompiledRule> & { examples: RuleExamples }): DetectorRule {
  return compiledRule({ id: "test/rule", files: "", ...overrides }) as DetectorRule
}

const run = (root: string, rule: DetectorRule): Promise<ExampleResult> =>
  runExamples({
    detection: {
      root,
      registry,
      settings: defaultDetectorSettings(),
      cacheFor: () => memoryCache(),
      contextFor: async () => [],
    },
    rule,
    timeoutMs: 60_000,
  })

const regexRule = (examples: RuleExamples) =>
  detectorRule({
    detector: { kind: "regex", config: { pattern: "raise HTTPException", flags: "" }, captures: [] },
    message: "{{file}}:{{line}} raises HTTPException",
    examples,
  })

describe("runExamples", () => {
  test("a bad example must fire and a good one must not", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({
        good: [{ path: PY, code: "def get():\n    raise NotFound()\n" }],
        bad: [{ path: PY, code: "def get():\n    raise HTTPException(404)\n" }],
      }),
    )
    expect(result.outcomes.map((outcome) => [outcome.kind, outcome.index, outcome.passed])).toEqual([
      ["good", 0, true],
      ["bad", 0, true],
    ])
    expect(result.recall).toEqual({ matched: 1, total: 1 })
    expect(result.precision).toEqual({ correct: 1, total: 1 })
  })

  test("a bad example that produces nothing fails, carrying no findings", async () => {
    const root = await createProject({})
    const result = await run(root, regexRule({ good: [], bad: [{ path: PY, code: "def get():\n    pass\n" }] }))
    expect(result.outcomes).toEqual([{ kind: "bad", index: 0, path: PY, passed: false, findings: [] }])
    expect(result.recall).toEqual({ matched: 0, total: 1 })
  })

  test("a good example that fires fails, carrying the finding so the report can print the line", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({ good: [{ path: PY, code: "x = 1\nraise HTTPException(404)\n" }], bad: [] }),
    )
    expect(result.outcomes[0]?.passed).toBe(false)
    expect(result.outcomes[0]?.findings).toEqual([
      { line: 2, column: 1, text: "raise HTTPException", message: `${PY}:2 raises HTTPException` },
    ])
    // Precision counts it against the rule: it fired on something that was not a violation.
    expect(result.precision).toEqual({ correct: 0, total: 1 })
  })

  test("the message is rendered with the example's own path, not the scratch directory's", async () => {
    const root = await createProject({})
    const result = await run(root, regexRule({ good: [], bad: [{ path: PY, code: "raise HTTPException(1)\n" }] }))
    expect(result.outcomes[0]?.findings[0]?.message).toBe(`${PY}:1 raises HTTPException`)
  })

  test("no examples key at all, and a declared but empty one, are different results", async () => {
    const root = await createProject({})
    const none = await run(root, compiledRule({ id: "test/rule" }))
    expect(none).toMatchObject({ missing: true, empty: false, outcomes: [] })
    const declared = await run(root, regexRule({ good: [], bad: [] }))
    expect(declared).toMatchObject({ missing: false, empty: true, outcomes: [] })
  })

  test("the scratch directory is gone afterwards, including when a detector fails", async () => {
    const root = await createProject({})
    await brokenTool(root, "ruff")
    await run(
      root,
      detectorRule({
        detector: { kind: "linter", config: { tool: "ruff", rules: ["T201"] }, captures: [] },
        message: "{{file}}:{{line}}",
        examples: { good: [], bad: [{ path: PY, code: "print(1)\n" }] },
      }),
    )
    const left = (await readdir(root)).filter((entry) => entry.startsWith(EXAMPLES_DIR))
    expect(left).toEqual([])
  })

  test("a detector that fails is a failure carrying its message, not a quiet pass", async () => {
    const root = await createProject({})
    await brokenTool(root, "ruff")
    const result = await run(
      root,
      detectorRule({
        detector: { kind: "linter", config: { tool: "ruff", rules: ["T201"] }, captures: [] },
        message: "{{file}}:{{line}}",
        examples: { good: [{ path: PY, code: "pass\n" }], bad: [] },
      }),
    )
    // A good example with a broken detector produced no findings, which would otherwise read as a pass.
    expect(result.outcomes[0]?.passed).toBe(false)
    expect(result.outcomes[0]?.error).toBeTruthy()
  })

  test("an ast-grep rule is parsed by the language its example's extension names", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      detectorRule({
        detector: {
          kind: "ast-grep",
          config: { language: "python", rule: { pattern: "raise HTTPException($$$ARGS)" } },
          captures: ["ARGS"],
        },
        message: "{{file}}:{{line}} {{ARGS}}",
        examples: {
          good: [{ path: PY, code: "def get():\n    raise NotFound()\n" }],
          bad: [{ path: PY, code: "def get():\n    raise HTTPException(404)\n" }],
        },
      }),
    )
    expect(result.outcomes.map((outcome) => outcome.passed)).toEqual([true, true])
    expect(result.outcomes[1]?.findings[0]?.message).toBe(`${PY}:2 404`)
  })

  test("a linter rule runs the tool the project provides, not whatever is on PATH", async () => {
    const root = await createProject({})
    await stubTool(root, "ruff")
    const result = await run(
      root,
      detectorRule({
        // The recording reports T201 in app/a.py, so that is the example's path.
        detector: { kind: "linter", config: { tool: "ruff", rules: ["T201"] }, captures: [] },
        message: "{{file}}:{{line}} print found",
        examples: { good: [], bad: [{ path: "app/a.py", code: "print(1)\n" }] },
      }),
    )
    expect(result.outcomes[0]?.error).toBeUndefined()
  })

  test("a real external tool runs against the example and separates good from bad", async () => {
    const root = await createProject({})
    await linkTool(root, "oxlint")
    const result = await run(
      root,
      detectorRule({
        detector: { kind: "linter", config: { tool: "oxlint", rules: ["no-debugger"] }, captures: [] },
        message: "{{file}}:{{line}} debugger",
        examples: {
          good: [{ path: "app/a.js", code: "const a = 1\nexport default a\n" }],
          bad: [{ path: "app/a.js", code: "debugger\nexport default 1\n" }],
        },
      }),
    )
    expect(result.outcomes.map((outcome) => [outcome.kind, outcome.passed, outcome.error])).toEqual([
      ["good", true, undefined],
      ["bad", true, undefined],
    ])
  })
})
