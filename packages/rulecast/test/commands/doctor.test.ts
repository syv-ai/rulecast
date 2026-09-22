import { existsSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { stringify } from "yaml"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { stateDirFor, TEST_HOME } from "../helpers/home"
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
    const root = await createProject({
      ".rulecast-config.yaml": localConfig([RULE("a"), RULE("b")]),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain(`project    ${root}`)
    expect(result.stdout).toContain(".rulecast-config.yaml — 2 rules, 0 errors, 0 warnings")
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stdout).toContain(`project    ${stateDirFor(root)}`)
    expect(result.stdout).toContain("no problems found")
    expect(result.code).toBe(0)
  })

  test("creates the project's state directory, so the printed path is real", async () => {
    const root = await createProject({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    await doctor(root)
    expect(existsSync(path.join(stateDirFor(root), "root"))).toBe(true)
  })

  test("an error diagnostic is printed, counted and exits 2", async () => {
    const root = await createProject({
      ".rulecast-config.yaml": localConfig([{ ...RULE("a"), files: "[" }]),
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("error    .rulecast-config.yaml (a):")
    expect(result.stdout).toContain("invalid regex")
    expect(result.stdout).toContain("0 rules, 1 error, 0 warnings")
    expect(result.stdout).toContain("1 error")
    expect(result.code).toBe(2)
  })

  test("a warning is printed and counted but does not fail", async () => {
    // compile's one warning: a branch-like rev. The repo is a real local bare repository, so the
    // fetch succeeds and the warning is the only diagnostic.
    const repo = await createRuleRepo([{ tag: "main", files: { ".rulecast-rules.yaml": MANIFEST } }])
    const root = await createProject({
      ".rulecast-config.yaml": stringify({
        repos: [{ repo, rev: "main", rules: [{ id: "demo/no-print" }] }],
      }),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("looks like a branch")
    expect(result.stdout).toContain("1 rule, 0 errors, 1 warning")
    expect(result.stdout).toContain("1 warning")
    expect(result.code).toBe(0)
  })

  test("it takes no arguments", async () => {
    const root = await createProject({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    const result = await runCli(root, ["doctor", "--all-files"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("doctor takes no arguments")
  })

  test("with no config anywhere it says so and exits 2", async () => {
    const root = await createProject({})
    const result = await doctor(root)
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
    expect(result.stderr).toContain("run rulecast init")
    expect(result.code).toBe(2)
  })
})
