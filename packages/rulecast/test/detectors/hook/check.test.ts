import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { defaultDetectorSettings } from "../../../src/core/types"
import { hookDetector } from "../../../src/detectors/hook/detector"
import { createProject } from "../../helpers/project"

beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

const CONFIG =
  "repos:\n  - repo: local\n    hooks:\n      - id: lint\n        entry: ./lint.sh\n        language: system\n"

async function bin(root: string, name: string, body: string): Promise<string> {
  const dir = path.join(root, "node_modules", ".bin")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), `#!/bin/sh\n${body}\n`)
  await chmod(path.join(dir, name), 0o755)
  return path.join(dir, name)
}

const check = (root: string, rules: { id: string; config: unknown }[]) =>
  hookDetector.check!({
    rules: rules.map((rule) => ({ id: rule.id, config: hookDetector.schema.parse(rule.config) })),
    settings: defaultDetectorSettings(),
    env: process.env,
    cwd: root,
    signal: AbortSignal.timeout(5000),
  })

describe("hook detector check", () => {
  test("reports the runner it would use, and each hook id the config does not declare", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG })
    const prek = await bin(root, "prek", "exit 0")
    expect(
      await check(root, [
        { id: "a", config: { "pre-commit": "lint" } },
        { id: "b", config: { "pre-commit": "mypy" } },
      ]),
    ).toEqual([
      { what: "prek", level: "ok", detail: prek, rules: [] },
      { what: 'hook "mypy"', level: "error", detail: "not in .pre-commit-config.yaml", rules: ["b"] },
    ])
  })

  test("no runner is an error naming every pre-commit rule", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG })
    expect(await check(root, [{ id: "a", config: { "pre-commit": "lint" } }])).toEqual([
      { what: "prek or pre-commit", level: "error", detail: "neither is installed", rules: ["a"] },
    ])
  })

  test("lefthook: the binary, and each job it cannot find", async () => {
    const root = await createProject({})
    const dump = JSON.stringify({ "pre-commit": { jobs: [{ name: "lint", run: "x" }] } })
    const lefthook = await bin(root, "lefthook", `echo '${dump}'`)
    expect(
      await check(root, [
        { id: "a", config: { lefthook: "pre-commit/lint" } },
        { id: "b", config: { lefthook: "pre-commit/nope" } },
      ]),
    ).toEqual([
      { what: "lefthook", level: "ok", detail: lefthook, rules: [] },
      {
        what: 'lefthook job "pre-commit/nope"',
        level: "error",
        detail: "no such job with a run command",
        rules: ["b"],
      },
    ])
  })
})
