import { readdir } from "node:fs/promises"
import { describe, expect, test } from "vitest"

import type { CompiledRule, DetectorRule } from "../../src/core/compile/rule"
import type { RuleExamples } from "../../src/core/config/schema"
import { memoryCache } from "../../src/core/detection/cache"
import {
  EXAMPLES_DIR,
  type ExampleExpectation,
  type ExampleFinding,
  type ExampleResult,
  judge,
  runExamples,
} from "../../src/core/examples"
import { defaultDetectorSettings } from "../../src/core/types"
import { registry } from "../helpers/fixture"
import { brokenTool, linkTool, stubTool } from "../helpers/linters"
import { createProject } from "../helpers/project"
import { rule as compiledRule } from "../helpers/rules"

const PY = "app/services/users.py"

function detectorRule(
  overrides: Omit<Partial<CompiledRule>, "examples"> & { examples: Partial<RuleExamples> },
): DetectorRule {
  const examples = { good: [], bad: [], baseline: [], ...overrides.examples }
  return compiledRule({ id: "test/rule", files: "", ...overrides, examples }) as DetectorRule
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

const regexRule = (examples: Partial<RuleExamples>) =>
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
    expect(result.outcomes).toEqual([
      {
        kind: "bad",
        index: 0,
        path: PY,
        passed: false,
        expected: { fires: true },
        findings: [],
        failures: ["expected at least one finding, found none"],
      },
    ])
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
      { line: 2, endLine: 2, column: 1, text: "raise HTTPException", message: `${PY}:2 raises HTTPException` },
    ])
    expect(result.outcomes[0]?.failures).toEqual(["expected no finding, found 1 on line 2"])
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

describe("expectations on bad examples", () => {
  const twoRaises = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

  test("count passes on the exact number of matches and fails one off", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({
        bad: [
          { path: PY, code: twoRaises, expect: { count: 2 } },
          { path: PY, code: twoRaises, expect: { count: 1 } },
        ],
      }),
    )
    expect(result.outcomes.map((outcome) => [outcome.passed, outcome.failures])).toEqual([
      [true, []],
      [false, ["expected 1 finding, found 2"]],
    ])
    expect(result.outcomes[1]?.expected).toEqual({ fires: true, count: 1 })
  })

  test("lines must be exactly the lines the matches are on, as a set", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({
        bad: [
          { path: PY, code: twoRaises, expect: { lines: [2, 3] } },
          { path: PY, code: twoRaises, expect: { lines: [3, 2, 3] } },
          { path: PY, code: twoRaises, expect: { lines: [2] } },
          { path: PY, code: twoRaises, expect: { lines: [1, 2, 3] } },
        ],
      }),
    )
    expect(result.outcomes.map((outcome) => outcome.failures)).toEqual([
      [],
      [],
      ["expected lines [2], found [2, 3]"],
      ["expected lines [1, 2, 3], found [2, 3]"],
    ])
  })

  test("a passing bad example carries its findings, for a reader that wants the actual result", async () => {
    const root = await createProject({})
    const result = await run(root, regexRule({ bad: [{ path: PY, code: twoRaises }] }))
    expect(result.outcomes[0]?.passed).toBe(true)
    expect(result.outcomes[0]?.findings.map((finding) => finding.line)).toEqual([2, 3])
  })
})

describe("baseline examples", () => {
  test("an instance rule's moved old violation is pre-existing and the added one is new", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({
        baseline: [
          {
            path: PY,
            before: "raise HTTPException(1)\n",
            after: "x = 1\ny = 2\nraise HTTPException(1)\nraise HTTPException(2)\n",
            expect: { new: [4], preexisting: [3] },
          },
        ],
      }),
    )
    const [outcome] = result.outcomes
    expect(outcome).toMatchObject({ kind: "baseline", index: 0, passed: true, failures: [] })
    expect(outcome?.findings.map((finding) => [finding.line, finding.status])).toEqual([
      [3, "preexisting"],
      [4, "new"],
    ])
    // A baseline example answers a different question from good and bad, and scores neither.
    expect(result.recall).toEqual({ matched: 0, total: 0 })
    expect(result.precision).toEqual({ correct: 0, total: 0 })
  })

  test("an after the same as the before is all pre-existing", async () => {
    const root = await createProject({})
    const code = "raise HTTPException(1)\nraise HTTPException(2)\n"
    const result = await run(
      root,
      regexRule({ baseline: [{ path: PY, before: code, after: code, expect: { new: [], preexisting: [1, 2] } }] }),
    )
    expect(result.outcomes[0]?.passed).toBe(true)
  })

  test("a wrong expectation names each line and what it was", async () => {
    const root = await createProject({})
    const result = await run(
      root,
      regexRule({
        baseline: [
          {
            path: PY,
            before: "raise HTTPException(1)\n",
            after: "raise HTTPException(1)\nraise HTTPException(2)\n",
            expect: { new: [1], preexisting: [] },
          },
        ],
      }),
    )
    expect(result.outcomes[0]?.passed).toBe(false)
    expect(result.outcomes[0]?.failures).toEqual([
      "line 1: expected new, was pre-existing",
      "line 2: unexpected new finding",
    ])
  })

  const slimRoutes = (expect: { new: number[]; preexisting: number[] }, before: string, after: string) =>
    detectorRule({
      scope: "container",
      detector: {
        kind: "ast-grep",
        config: {
          language: "python",
          rule: { kind: "function_definition", has: { kind: "if_statement", stopBy: "end" } },
        },
        captures: [],
      },
      message: "{{file}}:{{line}} branches",
      examples: { baseline: [{ path: "app/routes/users.py", before, after, expect }] },
    })

  test("a container rule: another if in an already-branching function is pre-existing", async () => {
    const root = await createProject({})
    const before = "def get(x):\n    if x:\n        return 1\n    return 0\n"
    const after = "def get(x):\n    if x:\n        return 1\n    if not x:\n        return 2\n    return 0\n"
    const result = await run(root, slimRoutes({ new: [], preexisting: [1] }, before, after))
    expect(result.outcomes[0]?.failures).toEqual([])
    expect(result.outcomes[0]?.findings.map((finding) => finding.status)).toEqual(["preexisting"])
  })

  test("a container rule: a clean function made to branch is new", async () => {
    const root = await createProject({})
    const before = "def get(x):\n    return 0\n"
    const after = "def get(x):\n    if x:\n        return 1\n    return 0\n"
    const result = await run(root, slimRoutes({ new: [1], preexisting: [] }, before, after))
    expect(result.outcomes[0]?.failures).toEqual([])
  })

  test("a detector that fails on the before fails the outcome, and leaves no scratch directory", async () => {
    const root = await createProject({})
    await brokenTool(root, "ruff")
    const result = await run(
      root,
      detectorRule({
        scope: "container",
        detector: { kind: "linter", config: { tool: "ruff", rules: ["T201"] }, captures: [] },
        message: "{{file}}:{{line}}",
        examples: {
          baseline: [{ path: PY, before: "print(1)\n", after: "print(1)\n", expect: { new: [], preexisting: [1] } }],
        },
      }),
    )
    expect(result.outcomes[0]?.passed).toBe(false)
    expect(result.outcomes[0]?.error).toBeTruthy()
    expect((await readdir(root)).filter((entry) => entry.startsWith(EXAMPLES_DIR))).toEqual([])
  })

  test("the scratch directory is gone after a passing baseline example too", async () => {
    const root = await createProject({})
    await run(
      root,
      regexRule({
        baseline: [{ path: PY, before: "pass\n", after: "pass\n", expect: { new: [], preexisting: [] } }],
      }),
    )
    expect((await readdir(root)).filter((entry) => entry.startsWith(EXAMPLES_DIR))).toEqual([])
  })
})

describe("judge", () => {
  const at = (line: number, status?: "new" | "preexisting"): ExampleFinding => ({
    line,
    endLine: line,
    column: 1,
    text: "x",
    message: "m",
    ...(status === undefined ? {} : { status }),
  })

  test.each([
    [{ fires: false } as const, [], undefined, []],
    [{ fires: false } as const, [at(3)], undefined, ["expected no finding, found 1 on line 3"]],
    [{ fires: false } as const, [at(3), at(4)], undefined, ["expected no finding, found 2 on lines [3, 4]"]],
    [{ fires: true } as const, [], undefined, ["expected at least one finding, found none"]],
    [{ fires: true, count: 2 } as const, [at(1)], undefined, ["expected 2 findings, found 1"]],
    [{ fires: true, lines: [3, 7] }, [at(3), at(4), at(7)], undefined, ["expected lines [3, 7], found [3, 4, 7]"]],
    [{ fires: true, lines: [3] }, [], undefined, ["expected lines [3], found none"]],
    [{ new: [4], preexisting: [] }, [at(4, "preexisting")], undefined, ["line 4: expected new, was pre-existing"]],
    [{ new: [], preexisting: [2] }, [], undefined, ["line 2: expected a pre-existing finding, found none"]],
    [{ new: [], preexisting: [] }, [at(5, "new")], undefined, ["line 5: unexpected new finding"]],
    [{ fires: false } as const, [], "boom", ["the detector failed: boom"]],
  ] satisfies [ExampleExpectation, ExampleFinding[], string | undefined, string[]][])(
    "%j with %j",
    (expected, findings, error, failures) => {
      expect(judge(expected, findings, error)).toEqual(failures)
    },
  )
})
