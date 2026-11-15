import { spawnSync } from "node:child_process"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { stringify } from "yaml"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"

// Conductor lead, 0.19.0: a linter rule whose code the project's pre-commit already runs on its
// files is said as info, "already covered by <hook> in <file>", never "drop the rule". Whether the
// code is on for a file is ruff's own answer for that file, per-file-ignores and their negated
// patterns included, never read from the config by rulecast.

/** A real ruff on this machine, before the test PATH hides it. */
const RUFF = spawnSync("/bin/sh", ["-c", "command -v ruff"], { encoding: "utf8" }).stdout.trim() || null

beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  vi.stubEnv("HOME", "/nonexistent-home")
  return () => vi.unstubAllEnvs()
})

/** Conductor's setup: SLF001 selected, and turned off everywhere but tests/ by a negated pattern. */
const PYPROJECT = `[tool.ruff.lint]
select = ["E", "SLF001"]

[tool.ruff.lint.per-file-ignores]
"!tests/**" = ["SLF001"]
`

const preCommit = (args: string[] = ["--fix"]) =>
  stringify({
    repos: [
      {
        repo: "https://github.com/astral-sh/ruff-pre-commit",
        rev: "v0.17.0",
        hooks: [{ id: "ruff-check", args, types_or: ["python", "pyi"] }],
      },
    ],
  })

const rule = (files: string, codes: string[]) => ({
  id: "py/private-reads",
  name: "No private reads",
  files,
  detect: { linter: { tool: "ruff", rules: codes } },
  message: "{{file}}:{{line}} {{message}}",
})

async function project(files: Record<string, string>): Promise<string> {
  const root = await createRepo({
    "tests/test_a.py": "x = 1\n",
    "src/a.py": "x = 1\n",
    "pyproject.toml": PYPROJECT,
    ...files,
  })
  const bin = path.join(root, "node_modules", ".bin")
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, "ruff"), `#!/bin/sh\nexec ${JSON.stringify(RUFF)} "$@"\n`)
  await chmod(path.join(bin, "ruff"), 0o755)
  return root
}

const coveredOf = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.includes("covered"))
    .join("\n")

describe.skipIf(RUFF === null)("rulecast doctor: a linter rule the git hooks already run", () => {
  test("every file the rule takes has the code on under the hook: already covered", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("^tests/.*\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": preCommit(),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe(
      "  info     py/private-reads — already covered by ruff-check in .pre-commit-config.yaml",
    )
  })

  test("files on both sides of the negated per-file-ignore: covered for 1 of 2 files", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": preCommit(),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe(
      "  info     py/private-reads — covered for 1 of 2 files by ruff-check in .pre-commit-config.yaml",
    )
  })

  test("the negated pattern read the right way round: off for src/, so a rule there is not covered", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("^src/.*\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": preCommit(),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe("")
  })

  test("the hook's own args count: --extend-ignore turns the code off", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("^tests/.*\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": preCommit(["--fix", "--extend-ignore", "SLF001"]),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe("")
  })

  test("an arg doctor can't account for: unsure, so nothing is said", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("^tests/.*\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": preCommit(["--something-new"]),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe("")
  })

  test("no hook runs ruff: nothing is said", async () => {
    const root = await project({ ".rulecast-config.yaml": localConfig([rule("^tests/.*\\.py$", ["SLF001"])]) })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe("")
  })

  test("a hook whose files the rule's files are not all given to: covered only for those it gets", async () => {
    const root = await project({
      ".rulecast-config.yaml": localConfig([rule("^tests/.*\\.py$", ["SLF001"])]),
      ".pre-commit-config.yaml": stringify({
        repos: [
          {
            repo: "https://github.com/astral-sh/ruff-pre-commit",
            rev: "v0.17.0",
            hooks: [{ id: "ruff-check", types_or: ["python", "pyi"], exclude: "^tests/" }],
          },
        ],
      }),
    })
    expect(coveredOf((await runCli(root, ["doctor"])).stdout)).toBe("")
  })
})
