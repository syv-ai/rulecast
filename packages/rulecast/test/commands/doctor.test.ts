import { existsSync } from "node:fs"
import { chmod, readdir } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { stringify } from "yaml"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stateDirFor, TEST_HOME } from "../helpers/home"
import { linkTool } from "../helpers/linters"
import { stubAgentCli } from "../helpers/llm"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

/** doctor reads a real environment; nothing the machine happens to have installed may decide a test. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

const doctor = (cwd: string) => runCli(cwd, ["doctor"])

const MANIFEST = stringify([
  {
    id: "demo/no-print",
    name: "No print calls",
    files: "\\.py$",
    detect: { regex: { pattern: "print\\(" } },
    message: "{{file}}:{{line}} prints.",
  },
])

const RULE = (id: string) => ({
  id,
  name: id,
  files: "\\.ts$",
  detect: { regex: { pattern: "forbidden" } },
  message: "{{file}}:{{line}} is forbidden.",
})

describe("rulecast doctor", () => {
  test("reports the project, a clean config and the cache paths, and exits 0", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a"), RULE("b")]),
      "src/x.ts": "const x = 1\n",
    })
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain(`project    ${root}`)
    expect(result.stdout).toContain(".rulecast-config.yaml — 2 rules, 0 errors, 0 warnings")
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stdout).toContain(`project    ${stateDirFor(root)}`)
    expect(result.stdout).toContain("no problems found")
    expect(result.code).toBe(0)
  })

  test("creates the project's state directory, so the printed path is real", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    await doctor(root)
    expect(existsSync(path.join(stateDirFor(root), "root"))).toBe(true)
  })

  test("an error diagnostic is printed, counted and exits 2", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([{ ...RULE("a"), files: "[" }]),
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("error    .rulecast-config.yaml (a):")
    expect(result.stdout).toContain("invalid regex")
    expect(result.stdout).toContain("0 rules, 1 error, 0 warnings")
    // No rules compiled, so the dry run says so rather than printing a bare heading.
    expect(result.stdout).toContain("dry run\n  nothing to run\n")
    // The summary counts the config's error together with the hooks warning.
    expect(result.stdout).toContain("1 error, 1 warning")
    expect(result.code).toBe(2)
  })

  test("a warning is printed and counted but does not fail", async () => {
    // compile's one warning: a branch-like rev. The repo is a real local bare repository, so the
    // fetch succeeds and the warning is the only diagnostic.
    const repo = await createRuleRepo([{ tag: "main", files: { ".rulecast-rules.yaml": MANIFEST } }])
    const root = await createRepo({
      ".rulecast-config.yaml": stringify({
        repos: [{ repo, rev: "main", rules: [{ id: "demo/no-print" }] }],
      }),
      "src/x.ts": "const x = 1\n",
      "app.py": "value = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("looks like a branch")
    expect(result.stdout).toContain("ok       demo/no-print — app.py, no match")
    expect(result.stdout).toContain("1 rule, 0 errors, 1 warning")
    // The summary, not the config line: the config's warning plus the uninstalled hooks. Asserted
    // on the final line so it cannot be satisfied by the substring inside "0 errors, 1 warning".
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("0 errors, 2 warnings")
    expect(result.code).toBe(0)
  })

  test("the environment section reports each detector's own checks", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "lint",
          name: "Lint",
          files: "\\.ts$",
          detect: { linter: { tool: "oxlint" } },
          message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
        },
        {
          id: "shell",
          name: "Shell",
          files: "\\.ts$",
          detect: { command: { run: ["./check.sh", "{{files}}"] } },
          message: "{{file}}:{{line}} bad.",
        },
      ]),
      "src/x.ts": "const x = 1\n",
      "check.sh": "#!/bin/sh\necho '[]'\n",
    })
    await linkTool(root, "oxlint")
    await chmod(path.join(root, "check.sh"), 0o755)
    const result = await doctor(root)
    expect(result.stdout).toContain("environment\n")
    expect(result.stdout).toContain("ok       oxlint — node_modules/.bin/oxlint")
    expect(result.stdout).toContain(`ok       ./check.sh — ${path.join(root, "check.sh")}`)
  })

  test("a command that is not executable is an error naming its rule, and exits 2", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "shell",
          name: "Shell",
          files: "\\.ts$",
          detect: { command: { run: ["./check.sh"] } },
          message: "{{file}}:{{line}} bad.",
        },
      ]),
      "src/x.ts": "const x = 1\n",
      "check.sh": "#!/bin/sh\necho '[]'\n",
    })
    await chmod(path.join(root, "check.sh"), 0o644)
    const result = await doctor(root)
    expect(result.stdout).toContain("error    ./check.sh — not executable (shell)")
    expect(result.code).toBe(2)
  })

  test("more than three rules sharing a failure are truncated", async () => {
    const rules = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: id,
      files: "\\.ts$",
      detect: { command: { run: ["definitely-not-a-real-binary-9x7"] } },
      message: "{{file}}:{{line}} bad.",
    }))
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(rules),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("not installed (a, b, c and 2 more)")
  })

  test("a project with no hooks installed warns and still exits 0", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("warning  Claude Code — not installed (run rulecast install)")
    expect(result.code).toBe(0)
  })

  test("installed hooks are reported with the file they are in", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
    })
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain("ok       Claude Code — .claude/settings.json")
  })

  describe("the dry run", () => {
    test("a rule that matches reports the file and the match count", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\nconst y = forbidden\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("dry run\n")
      expect(result.stdout).toContain("ok       a — src/x.ts, 2 matches")
      expect(result.code).toBe(0)
    })

    test("a rule that selects a file but matches nothing says no match", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const y = 1\n",
      })
      expect((await doctor(root)).stdout).toContain("ok       a — src/x.ts, no match")
    })

    test("one match is singular", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\n",
      })
      expect((await doctor(root)).stdout).toContain("ok       a — src/x.ts, 1 match")
    })

    test("a rule no file in the project matches is a warning, not a failure", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([{ ...RULE("a"), files: "^nowhere/" }]),
        "src/x.ts": "const forbidden = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("warning  a — no file in the project matches this rule")
      expect(result.code).toBe(0)
    })

    test("a rule whose detector fails is an error naming the rule, and exits 2", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "bad",
            name: "Bad",
            files: "\\.ts$",
            detect: { command: { run: ["./bad.sh", "{{files}}"] } },
            message: "{{file}}:{{line}} bad.",
          },
        ]),
        "src/x.ts": "const x = 1\n",
        "bad.sh": "#!/bin/sh\necho 'not json'\n",
      })
      await chmod(path.join(root, "bad.sh"), 0o755)
      const result = await doctor(root)
      expect(result.stdout).toMatch(/error {4}bad — /)
      // The dry run's error is counted alongside the hooks warning.
      expect(result.stdout).toContain("1 error, 1 warning")
      expect(result.code).toBe(2)
    })

    test("a touch rule has nothing to run", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "ctx", name: "Context", files: "\\.ts$", stages: ["touch"], context: ["@docs/x.md"] },
        ]),
        "docs/x.md": "# X\n",
        "src/x.ts": "const x = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("ok       ctx — context only, nothing to run")
      expect(result.code).toBe(0)
    })

    test("environment and dry-run errors are counted together", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "missing-tool",
            name: "Missing tool",
            files: "\\.ts$",
            detect: { command: { run: ["./absent.sh"] } },
            message: "{{file}}:{{line}} bad.",
          },
          {
            id: "bad-output",
            name: "Bad output",
            files: "\\.ts$",
            detect: { command: { run: ["./bad.sh", "{{files}}"] } },
            message: "{{file}}:{{line}} bad.",
          },
        ]),
        "src/x.ts": "const x = 1\n",
        "bad.sh": "#!/bin/sh\necho 'not json'\n",
      })
      await chmod(path.join(root, "bad.sh"), 0o755)
      const result = await doctor(root)
      // ./absent.sh fails the environment check and then its own dry run; ./bad.sh passes the
      // environment check and fails the dry run on its output. All three reach one summary.
      expect(result.stdout).toContain("error    ./absent.sh — no such file (missing-tool)")
      expect(result.stdout).toMatch(/error {4}missing-tool — /)
      expect(result.stdout).toMatch(/error {4}bad-output — /)
      expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("3 errors, 1 warning")
      expect(result.code).toBe(2)
    })

    test("a project that is not a git repository says so instead of throwing", async () => {
      const root = await createProject({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toMatch(/warning {2}not run — /)
      expect(result.code).toBe(0)
    })

    test("an llm rule is skipped, and no model is called", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "tone",
            name: "Tone",
            files: "\\.ts$",
            stages: ["verify"],
            detect: { llm: { model: "haiku", question: "is it rude?" } },
            message: "{{file}}:{{line}} {{reason}}",
          },
        ]),
        "src/x.ts": "const x = 1\n",
      })
      await stubAgentCli(root, "claude")
      const result = await doctor(root)
      expect(result.stdout).toContain("skipped  tone — llm rules are not dry-run (a model call costs money)")
      expect(await readdir(path.join(root, "claude.calls"))).toEqual([])
      expect(result.code).toBe(0)
    })
  })

  test("it takes no arguments", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    const result = await runCli(root, ["doctor", "--all-files"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("doctor takes no arguments")
  })

  test("with no config anywhere it says so and exits 2", async () => {
    const root = await createRepo({})
    const result = await doctor(root)
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
    expect(result.stderr).toContain("run rulecast init")
    expect(result.code).toBe(2)
  })
})
