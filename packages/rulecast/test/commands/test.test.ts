import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stubAgentCli } from "../helpers/llm"

const PY = "app/services/users.py"

const httpException = (extra: Record<string, unknown> = {}) => ({
  id: "backend/no-httpexception",
  name: "No HTTPException in services",
  files: "^app/services/.*\\.py$",
  detect: { regex: { pattern: "raise HTTPException" } },
  message: "{{file}}:{{line}} raises HTTPException",
  examples: {
    good: [{ path: PY, code: "def get():\n    raise NotFound()\n" }],
    bad: [{ path: PY, code: "def get():\n    raise HTTPException(404)\n" }],
  },
  ...extra,
})

const project = (rules: Record<string, unknown>[], files: Record<string, string> = {}) =>
  createRepo({ ".rulecast-config.yaml": localConfig(rules), ...files })

const runTest = (cwd: string, ...argv: string[]) => runCli(cwd, ["test", ...argv])

describe("rulecast test", () => {
  test("every example passing exits 0 and scores the rule", async () => {
    const root = await project([httpException()])
    const result = await runTest(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("backend/no-httpexception")
    expect(result.stdout).toContain("2/2")
    expect(result.stdout).toContain("P 1.00")
    expect(result.stdout).toContain("R 1.00")
    expect(result.stdout).toContain("1 rule passed")
  })

  test("a good example the rule fires on exits 1 and shows the line it fired at", async () => {
    const root = await project([
      httpException({
        examples: {
          good: [{ path: PY, code: "def get():\n    raise HTTPException(404)\n" }],
          bad: [{ path: PY, code: "def get():\n    raise HTTPException(500)\n" }],
        },
      }),
    ])
    const result = await runTest(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("good[0] app/services/users.py — fired at line 2")
    expect(result.stdout).toContain("raise HTTPException(404)")
    expect(result.stdout).toContain("1 of 1 rules failed")
  })

  test("a bad example the rule misses exits 1 and says so", async () => {
    const root = await project([
      httpException({ examples: { good: [], bad: [{ path: PY, code: "def get():\n    pass\n" }] } }),
    ])
    const result = await runTest(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("bad[0] app/services/users.py — no finding")
  })

  test("rules with no examples are listed and do not fail the run", async () => {
    const root = await project([httpException({ examples: undefined })])
    const result = await runTest(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("no examples: backend/no-httpexception")
    expect(result.stdout).toContain("nothing to run")
  })

  test("a rule id runs only that rule", async () => {
    const root = await project([
      httpException(),
      httpException({ id: "backend/other", examples: { good: [], bad: [{ path: PY, code: "pass\n" }] } }),
    ])
    const result = await runTest(root, "backend/no-httpexception")
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain("backend/other")
  })

  test("a touch rule says it has nothing to test", async () => {
    const root = await project(
      [{ id: "ctx", name: "Context", files: "\\.py$", stages: ["touch"], context: ["@docs/x.md"] }],
      { "docs/x.md": "# X\n" },
    )
    for (const argv of [["ctx"], ["ctx", "--against", "app"]]) {
      const result = await runTest(root, ...argv)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("ctx is a touch rule: it delivers context and has nothing to test")
    }
  })

  test("an unknown rule id exits 2 and points at validate", async () => {
    const root = await project([httpException()])
    const result = await runTest(root, "backend/nope")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('no rule "backend/nope" (see rulecast validate)')
  })

  test("bare, llm rules are skipped and say how to run them", async () => {
    const root = await project([
      {
        id: "backend/judgement",
        name: "Judgement",
        files: "^app/services/.*\\.py$",
        detect: { llm: { model: "haiku", question: "Does this need judgement?" } },
        message: "{{file}}:{{line}} needs judgement",
        examples: { good: [], bad: [{ path: PY, code: "pass\n" }] },
      },
    ])
    await stubAgentCli(root, "claude")
    const result = await runTest(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("skipped (llm; name the rule to run it)")
    // Skipped is not failed and not "no examples": the rule has examples, they were not run.
    expect(result.stdout).not.toContain("no examples")
  })
})

describe("rulecast test --against", () => {
  const files = {
    "app/services/a.py": "raise HTTPException(1)\nraise HTTPException(2)\n",
    "app/services/b.py": "raise HTTPException(3)\n",
    "app/services/c.py": "pass\n",
    "app/other/d.py": "raise HTTPException(4)\n",
  }

  test("reports the violations and the spread, and exits 0 whatever it finds", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.code).toBe(0)
    // app/other/d.py is under the path but the rule does not match it, so it is not the denominator.
    expect(result.stdout).toContain("3 violations in 2 of 3 matching files")
    expect(result.stdout).toContain("app/services/a.py")
    // One note, chosen by the count: 2 of 3 matching files is most of them.
    expect(result.stdout).toContain("Most matching files violate it: check it is a convention")
    expect(result.stdout).not.toContain("Few violations")
  })

  test("a few violations in a minority of files says a rule nobody breaks costs context", async () => {
    const root = await project([httpException()], {
      ...files,
      "app/services/b.py": "pass\n",
      "app/services/e.py": "pass\n",
      "app/services/f.py": "pass\n",
    })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.stdout).toContain("2 violations in 1 of 5 matching files")
    expect(result.stdout).toContain("Few violations: a rule nobody breaks costs an agent context")
    expect(result.stdout).not.toContain("Most matching files")
  })

  test("one violation is singular", async () => {
    const root = await project([httpException()], { "app/services/a.py": "raise HTTPException(1)\n" })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.stdout).toContain("1 violation in 1 of 1 matching files")
  })

  test("a rule that fires nowhere still exits 0, and says what the zero does not mean", async () => {
    const root = await project([httpException()], { "app/services/c.py": "pass\n" })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("0 violations in 0 of 1 matching files")
    // Without this the second note reads as a verdict: rulecast's own three rules all measure 0,
    // and none of them is a rule nobody would break.
    expect(result.stdout).toContain("counts the")
    expect(result.stdout).toContain("stock, not how often an edit would break the rule.")
    expect(result.stdout).not.toContain("Few violations")
    // No empty "worst files" block when there are none.
    expect(result.stdout).not.toMatch(/\n\n\n/)
  })

  test("--against without a rule id exits 2", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "--against", "app")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--against needs a RULE_ID")
  })

  test("a path the rule matches nothing under says so rather than printing zeroes", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "backend/no-httpexception", "--against", "app/other")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("no files under app/other match backend/no-httpexception")
  })
})
