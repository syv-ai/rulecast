import path from "node:path"
import { describe, expect, test } from "vitest"

import { TEST_SCHEMA_VERSION } from "../../src/adapters/cli/contract"
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

const json = (stdout: string) => JSON.parse(stdout)

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

  test("a match that starts on a blank line shows what it matched, line break included", async () => {
    // `^\s*` under the m flag crosses the blank line: the finding is on line 2, which is empty.
    // Without the matched text the failure read as "fired at line 2" over an empty line.
    const root = await project([
      httpException({
        detect: { regex: { pattern: "^\\s*print\\(", flags: "m" } },
        examples: {
          good: [{ path: PY, code: "x = 1\n\nprint(2)\n" }],
          bad: [{ path: PY, code: "print(1)\n" }],
        },
      }),
    ])
    const result = await runTest(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("good[0] app/services/users.py — fired at line 2")
    expect(result.stdout).toContain('matched "\\nprint(", across a line break')
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
    // And the closing count says so, so "nothing failed" is not read as "every rule is tested".
    expect(result.stdout).toContain(
      "  not run: backend/judgement (rulecast test <id> runs one; it costs money per example)",
    )
  })
})

describe("rulecast test --against", () => {
  const files = {
    "app/services/a.py": "raise HTTPException(1)\nraise HTTPException(2)\n",
    "app/services/b.py": "raise HTTPException(3)\n",
    "app/services/c.py": "pass\n",
    "app/other/d.py": "raise HTTPException(4)\n",
  }
  /** `count` clean service files: enough matching files for the count to mean something. */
  const clean = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`app/services/clean${i}.py`, "pass\n"]))

  test("reports the violations and the spread, and exits 0 whatever it finds", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.code).toBe(0)
    // app/other/d.py is under the path but the rule does not match it, so it is not the denominator.
    expect(result.stdout).toContain("3 violations in 2 of 3 matching files")
    expect(result.stdout).toContain("app/services/a.py")
    // Three matching files say nothing about how often the rule is broken, and the note says so
    // instead of reading a verdict into them.
    expect(result.stdout).toContain(
      "Only 3 matching files: too few for these numbers to say how often the rule is broken.",
    )
    expect(result.stdout).toContain("Judge the rule by the doc it enforces.")
    expect(result.stdout).not.toContain("Most matching files")
    expect(result.stdout).not.toContain("Few violations")
  })

  test("violations in most of enough matching files ask whether it is a convention", async () => {
    const violating = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`app/services/bad${i}.py`, "raise HTTPException(1)\n"]),
    )
    const root = await project([httpException()], { ...violating, ...clean(10) })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.stdout).toContain("20 violations in 20 of 30 matching files")
    expect(result.stdout).toContain("Most matching files violate it: check it is a convention")
    expect(result.stdout).not.toContain("Few violations")
  })

  test("a few violations in enough matching files says a rule nobody breaks costs context", async () => {
    const root = await project([httpException()], { "app/services/a.py": files["app/services/a.py"], ...clean(29) })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.stdout).toContain("2 violations in 1 of 30 matching files")
    expect(result.stdout).toContain("Few violations: a rule nobody breaks costs an agent context")
    expect(result.stdout).not.toContain("Most matching files")
  })

  test("one violation is singular", async () => {
    const root = await project([httpException()], { "app/services/a.py": "raise HTTPException(1)\n" })
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.stdout).toContain("1 violation in 1 of 1 matching files")
  })

  test("a rule that fires nowhere still exits 0, and says what the zero does not mean", async () => {
    const root = await project([httpException()], clean(30))
    const result = await runTest(root, "backend/no-httpexception", "--against", "app")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("0 violations in 0 of 30 matching files")
    // Without this the second note reads as a verdict: rulecast's own three rules all measure 0,
    // and none of them is a rule nobody would break.
    expect(result.stdout).toContain("counts the")
    expect(result.stdout).toContain("stock, not how often an edit would break the rule.")
    expect(result.stdout).not.toContain("Few violations")
    // No empty "worst files" block when there are none.
    expect(result.stdout).not.toMatch(/\n\n\n/)
  })

  test("--against . is the whole project, from the root or a subdirectory", async () => {
    const root = await project([httpException()], files)
    const fromRoot = await runTest(root, "backend/no-httpexception", "--against", ".")
    expect(fromRoot.code).toBe(0)
    expect(fromRoot.stdout).toContain("3 violations in 2 of 3 matching files")
    const fromSub = await runTest(path.join(root, "app"), "backend/no-httpexception", "--against", "..")
    expect(fromSub.stdout).toContain("3 violations in 2 of 3 matching files")
    expect((await runTest(root, "backend/no-httpexception", "--against", root)).code).toBe(0)
  })

  test("--against without a rule id counts every rule, one line each, and never runs an llm rule", async () => {
    const other = httpException({
      id: "backend/no-other",
      files: "^app/other/",
      examples: { bad: [{ path: "app/other/x.py", code: "raise HTTPException(1)\n" }] },
    })
    const judgement = {
      id: "backend/judgement",
      name: "Judgement",
      files: "^app/services/.*\\.py$",
      detect: { llm: { model: "haiku", question: "Does this need judgement?" } },
      message: "{{file}}:{{line}} needs judgement",
    }
    const root = await project([httpException(), other, judgement], files)
    const result = await runTest(root, "--against", ".")
    expect(result.code).toBe(0)
    const lines = result.stdout.split("\n")
    expect(lines).toContain("  rule                      violations  files")
    expect(lines).toContain("  backend/no-httpexception           3  2 of 3")
    expect(lines).toContain("  backend/no-other                   1  1 of 1")
    expect(lines).toContain("  not run: backend/judgement (rulecast test <id> --against runs one; it costs money)")
    expect(result.stdout).toContain("The counts are the stock")
  })

  test("--against without a rule id says when a rule matches nothing", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "--against", "app/other")
    expect(result.stdout.split("\n")).toContain("  backend/no-httpexception           0  no files match")
  })

  test("a path the rule matches nothing under says so rather than printing zeroes", async () => {
    const root = await project([httpException()], files)
    const result = await runTest(root, "backend/no-httpexception", "--against", "app/other")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("no files under app/other match backend/no-httpexception")
  })
  describe("fixes", () => {
    const logger = (bad: Record<string, unknown>[], fix = "log.info({{args}})") => ({
      id: "py/logger",
      name: "Logger",
      files: "\\.py$",
      detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)", fix } },
      message: "{{file}}:{{line}} uses print",
      examples: { good: [{ path: "a.py", code: "log.info(1)\n" }], bad },
    })

    test("a fix that removes the finding, and gives fixed exactly, passes and is scored", async () => {
      const root = await project([
        logger([
          { path: "a.py", code: 'print("hi")\n', fixed: 'log.info("hi")\n' },
          { path: "b.py", code: "print(1)\nprint(2)\n" },
        ]),
      ])
      const result = await runTest(root)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("3/3     P 1.00  R 1.00  fix 2/2")
    })

    test("a bad example that still fires after its fix fails the rule", async () => {
      // The fix rewrites the call and leaves a second one inside the arguments.
      const root = await project([logger([{ path: "a.py", code: "print(1)\n" }], "print({{args}}) or print(0)")])
      const result = await runTest(root)
      expect(result.code).toBe(1)
      expect(result.stdout).toContain("fix 0/1")
      expect(result.stdout).toMatch(
        /bad\[0\] a\.py — (the rule still fires after its fix|a fix did not remove its own finding)/,
      )
    })

    test("fixed that differs from what the fix produced fails, with the diff", async () => {
      const root = await project([logger([{ path: "a.py", code: 'print("hi")\n', fixed: 'logger.info("hi")\n' }])])
      const result = await runTest(root)
      expect(result.code).toBe(1)
      expect(result.stdout).toContain("bad[0] a.py — the fixed code differs from fixed:")
      expect(result.stdout).toContain(
        '--- expected\n        +++ got\n        @@ -1,1 +1,1 @@\n        -logger.info("hi")\n        +log.info("hi")',
      )
    })

    test("a rule without fix has no fix score", async () => {
      const root = await project([httpException()])
      expect((await runTest(root)).stdout).not.toContain("fix ")
    })
  })
})

describe("rulecast test --format json", () => {
  test("prints one document: a version, a verdict, and every outcome with its findings", async () => {
    const root = await project([
      httpException({
        examples: {
          good: [{ path: PY, code: "def get():\n    raise NotFound()\n" }],
          bad: [
            { path: PY, code: "def get():\n    raise HTTPException(404)\n", expect: { lines: [2] } },
            { path: PY, code: "def get():\n    raise HTTPException(404)\n    return\n", expect: { lines: [3] } },
          ],
        },
      }),
    ])
    const result = await runTest(root, "--format", "json")
    expect(result.code).toBe(1)
    const document = json(result.stdout)
    expect(Object.keys(document)).toEqual(["schemaVersion", "passed", "rules"])
    expect(document.schemaVersion).toBe(TEST_SCHEMA_VERSION)
    expect(document.passed).toBe(false)
    const [rule] = document.rules
    expect(rule).toMatchObject({
      rule: "backend/no-httpexception",
      detector: "regex",
      scope: "instance",
      status: "failed",
      against: null,
      examples: { precision: { correct: 2, total: 2 }, recall: { matched: 2, total: 2 } },
    })
    expect(rule.examples.outcomes.map((outcome: { failures: string[] }) => outcome.failures)).toEqual([
      [],
      [],
      ["expected lines [3], found [2]"],
    ])
    expect(rule.examples.outcomes[1]).toEqual({
      kind: "bad",
      index: 0,
      path: PY,
      passed: true,
      expected: { fires: true, lines: [2] },
      findings: [
        {
          line: 2,
          endLine: 2,
          column: 5,
          text: "raise HTTPException",
          message: `${PY}:2 raises HTTPException`,
        },
      ],
      failures: [],
    })
  })

  test("a failing pinned example in the terminal says what it expected and where it fired", async () => {
    const root = await project([
      httpException({
        examples: { bad: [{ path: PY, code: "def get():\n    raise HTTPException(404)\n", expect: { count: 2 } }] },
      }),
    ])
    const result = await runTest(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("bad[0] app/services/users.py — expected 2 findings, found 1")
    expect(result.stdout).toContain("bad[0] app/services/users.py — fired at line 2")
  })

  test("a failing baseline example in the terminal names the line and its status", async () => {
    const root = await project([
      httpException({
        examples: {
          baseline: [
            {
              path: PY,
              before: "raise HTTPException(1)\n",
              after: "x = 1\nraise HTTPException(1)\n",
              expect: { new: [2] },
            },
          ],
        },
      }),
    ])
    const result = await runTest(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("baseline[0] app/services/users.py — line 2: expected new, was pre-existing")
    expect(result.stdout).toContain("baseline[0] app/services/users.py — fired at line 2 (pre-existing)")
  })

  test("statuses for a passing rule, a rule with no examples, a touch rule and an unnamed llm rule", async () => {
    const root = await project(
      [
        httpException(),
        httpException({ id: "backend/bare", examples: undefined }),
        {
          id: "backend/judgement",
          name: "Judgement",
          files: "^app/services/.*\\.py$",
          detect: { llm: { model: "haiku", question: "Does this need judgement?" } },
          message: "{{file}}:{{line}} needs judgement",
          examples: { bad: [{ path: PY, code: "pass\n" }] },
        },
        { id: "ctx", name: "Context", files: "\\.py$", stages: ["touch"], context: ["@docs/x.md"] },
      ],
      { "docs/x.md": "# X\n" },
    )
    await stubAgentCli(root, "claude")
    const result = await runTest(root, "--format", "json")
    expect(result.code).toBe(0)
    const document = json(result.stdout)
    expect(document.passed).toBe(true)
    expect(document.rules.map((rule: { rule: string; status: string }) => [rule.rule, rule.status])).toEqual([
      ["backend/no-httpexception", "passed"],
      ["backend/bare", "no-examples"],
      ["backend/judgement", "not-run"],
    ])
    const touch = await runTest(root, "ctx", "--format", "json")
    expect(json(touch.stdout).rules).toEqual([
      { rule: "ctx", detector: null, scope: "instance", status: "touch", examples: null, against: null },
    ])
  })

  test("a rule that failed to compile fails the run, and its diagnostic is on stderr", async () => {
    const broken = httpException({
      id: "backend/broken",
      examples: { bad: [{ path: PY, code: "x\n", expect: { lines: [9] } }] },
    })
    const root = await project([httpException(), broken])
    const result = await runTest(root, "--format", "json")
    expect(result.code).toBe(1)
    expect(json(result.stdout)).toMatchObject({ passed: false })
    expect(json(result.stdout).rules.map((rule: { rule: string }) => rule.rule)).toEqual(["backend/no-httpexception"])
    expect(result.stderr).toContain("backend/broken")
    expect(result.stderr).toContain("expects line 9")
    const text = await runTest(root)
    expect(text.code).toBe(1)
    expect(text.stdout).toContain("1 rule did not compile: backend/broken")
    // Naming a rule that compiled tests that rule alone; another rule's diagnostic is not its failure.
    expect((await runTest(root, "backend/no-httpexception")).code).toBe(0)
  })

  test("a config that does not load exits 2, rather than passing with nothing tested", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": "repos: [" })
    const result = await runTest(root, "--format", "json")
    expect(result.code).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(".rulecast-config.yaml")
  })

  test("a usage error prints nothing on stdout and exits 2", async () => {
    const root = await project([httpException()])
    for (const argv of [
      ["--format", "yaml"],
      ["--max-rate", "0.5"],
      ["--against", ".", "--max-rate", "1.5"],
      ["--against", ".", "--max-rate", "x"],
      ["--against", ".", "--max-rate", ""],
    ]) {
      const result = await runTest(root, ...argv, "--format", argv[0] === "--format" ? argv[1]! : "json")
      expect(result.code, argv.join(" ")).toBe(2)
      expect(result.stdout).toBe("")
    }
    expect((await runTest(root, "--max-rate", "0.5")).stderr).toContain("--max-rate needs --against")
    expect((await runTest(root, "--against", ".", "--max-rate", "2")).stderr).toContain(
      "--max-rate takes a share of files between 0 and 1, such as 0.2",
    )
    expect((await runTest(root, "--format", "yaml")).stderr).toContain('unknown format "yaml" (use terminal or json)')
  })
})

describe("rulecast test --against --max-rate", () => {
  /** `violating` files with the violation and `clean` without, all matching the rule. */
  const services = (violating: number, clean: number) => ({
    ...Object.fromEntries(
      Array.from({ length: violating }, (_, i) => [`app/services/bad${i}.py`, "raise HTTPException(1)\n"]),
    ),
    ...Object.fromEntries(Array.from({ length: clean }, (_, i) => [`app/services/clean${i}.py`, "pass\n"])),
  })

  test("exits 1 when the share of violating files is over it, and says so", async () => {
    const root = await project([httpException()], services(20, 10))
    const result = await runTest(root, "backend/no-httpexception", "--against", ".", "--max-rate", "0.5")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("  rate 0.67: over --max-rate 0.5")
    const document = json(
      (await runTest(root, "backend/no-httpexception", "--against", ".", "--max-rate", "0.5", "--format", "json"))
        .stdout,
    )
    expect(document.passed).toBe(false)
    expect(document.rules[0]).toMatchObject({ status: "failed", examples: null })
    expect(document.rules[0].against).toMatchObject({
      paths: ["."],
      matchingFiles: 30,
      violatingFiles: 20,
      violations: 20,
      maxRate: 0.5,
      exceeded: true,
      smallSample: false,
    })
    expect(document.rules[0].against.rate).toBeCloseTo(20 / 30)
    // Every violating file, not the terminal's ten.
    expect(document.rules[0].against.files).toHaveLength(20)
  })

  test("exits 0 when within it", async () => {
    const root = await project([httpException()], services(5, 25))
    const result = await runTest(root, "backend/no-httpexception", "--against", ".", "--max-rate", "0.5")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("  rate 0.17: within --max-rate 0.5")
  })

  test("a rate that rounds to --max-rate shows enough digits to tell which side it is on", async () => {
    // 126 of 250 is 0.504: printed as 0.50 it read "rate 0.50: over --max-rate 0.5".
    const close = await project([httpException()], services(126, 124))
    const closer = await runTest(close, "backend/no-httpexception", "--against", ".", "--max-rate", "0.5")
    expect(closer.code).toBe(1)
    expect(closer.stdout).toContain("  rate 0.504: over --max-rate 0.5")
    const table = await runTest(close, "--against", ".", "--max-rate", "0.5")
    expect(table.stdout).toContain("0.504 over")
  })

  test("is not applied to too few matching files", async () => {
    const root = await project([httpException()], services(4, 0))
    const result = await runTest(root, "backend/no-httpexception", "--against", ".", "--max-rate", "0.1")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("  --max-rate not applied: only 4 matching files")
    const document = json(
      (await runTest(root, "backend/no-httpexception", "--against", ".", "--max-rate", "0.1", "--format", "json"))
        .stdout,
    )
    expect(document.rules[0].against).toMatchObject({ rate: 1, exceeded: false, smallSample: true })
  })

  test("without a rule id, any rule over it exits 1, and each row shows its rate", async () => {
    const other = httpException({ id: "backend/no-other", files: "^app/other/", examples: undefined })
    const root = await project([httpException(), other], services(20, 10))
    const result = await runTest(root, "--against", ".", "--max-rate", "0.5")
    expect(result.code).toBe(1)
    const lines = result.stdout.split("\n")
    expect(lines).toContain("  rule                      violations  files           rate")
    expect(lines).toContain("  backend/no-httpexception          20  20 of 30        0.67 over")
    expect(lines).toContain("  backend/no-other                   0  no files match")
    const document = json((await runTest(root, "--against", ".", "--max-rate", "0.5", "--format", "json")).stdout)
    expect(document.rules.map((rule: { status: string }) => rule.status)).toEqual(["failed", "passed"])
    expect(document.rules[1].against).toMatchObject({ matchingFiles: 0, rate: null, exceeded: false })
  })
})
