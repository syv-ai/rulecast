import { mkdtemp, readFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorResult, defaultDetectorSettings } from "../../../src/core/types"
import { onPath } from "../../../src/core/which"
import { hookDetector } from "../../../src/detectors/hook/detector"
import { createRepo, git } from "../../helpers/git"
import { fromDisk } from "../../helpers/project"

/**
 * Plan 16's success test for hooks: a hook the project declares works as a rule with config only.
 * Opt in with RULECAST_TOOLS=1; a runner or tool the machine does not have is skipped by name.
 */
const PRE_COMMIT = `repos:
  - repo: local
    hooks:
      - id: mypy
        name: mypy
        entry: mypy --show-column-numbers --no-error-summary
        language: system
        types: [python]
      - id: ruff-format
        name: ruff format
        entry: ruff format
        language: system
        types: [python]
`
const LEFTHOOK = "pre-commit:\n  jobs:\n    - name: lint\n      run: shellcheck -f gcc {staged_files}\n"
const FILES = {
  ".pre-commit-config.yaml": PRE_COMMIT,
  "lefthook.yml": LEFTHOOK,
  "a.py": "x: str = 1\nprint( x )\n",
  "s.sh": "#!/bin/bash\ncd foo\n",
}

function run(root: string, id: string, config: unknown, files: string[]): Promise<DetectorResult> {
  return hookDetector.run({
    event: "verify",
    rules: [{ id, config: hookDetector.schema.parse(config), files, context: [] }],
    changes: new Map(),
    read: fromDisk(root),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd: root,
    signal: AbortSignal.timeout(120_000),
    deadlineAt: Date.now() + 120_000,
  })
}

async function missing(...tools: string[]): Promise<string | null> {
  for (const tool of tools) if (!(await onPath(tool))) return tool
  return null
}

/** A PATH where `runner` is the only pre-commit runner, with the tools its hooks call. */
async function onlyRunner(runner: string, tools: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rulecast-runner-"))
  const which = async (name: string) => {
    for (const entry of (process.env.PATH ?? "").split(":")) {
      const candidate = path.join(entry, name)
      if (await onPath(candidate)) return candidate
    }
    throw new Error(`${name} not on PATH`)
  }
  for (const name of [runner, ...tools]) await symlink(await which(name), path.join(dir, name))
  return `${dir}:/usr/bin:/bin`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.runIf(process.env.RULECAST_TOOLS === "1")("live hooks", () => {
  for (const runner of ["prek", "pre-commit"]) {
    test(`a pre-commit hook through ${runner}: mypy's findings`, async () => {
      const absent = await missing(runner, "mypy")
      if (absent !== null) {
        console.log(`skipping ${runner}: ${absent} is not installed`)
        return
      }
      vi.stubEnv("PATH", await onlyRunner(runner, ["mypy"]))
      const root = await createRepo(FILES)
      const result = await run(root, "types", { "pre-commit": "mypy" }, ["a.py"])
      expect(result.errors).toEqual([])
      expect(result.findings.map((f) => [f.match.file, f.match.line, f.match.captures.ruleId])).toContainEqual([
        "a.py",
        1,
        "assignment",
      ])
    }, 180_000)
  }

  test("a formatter hook leaves the file as it was and reports the change", async () => {
    const absent = await missing("ruff")
    const runner = (await onPath("prek")) ? "prek" : (await onPath("pre-commit")) ? "pre-commit" : null
    if (absent !== null || runner === null) {
      console.log(`skipping the formatter hook: ${absent ?? "prek or pre-commit"} is not installed`)
      return
    }
    const root = await createRepo(FILES)
    const result = await run(root, "format", { "pre-commit": "ruff-format" }, ["a.py"])
    expect(await readFile(path.join(root, "a.py"), "utf8")).toBe(FILES["a.py"])
    expect(result.findings.map((f) => f.match.captures.message)).toEqual(["ruff-format would change this file"])
    expect(await git(root, "stash", "list")).toBe("")
  }, 180_000)

  test("a lefthook job: shellcheck's findings", async () => {
    const absent = await missing("lefthook", "shellcheck")
    if (absent !== null) {
      console.log(`skipping lefthook: ${absent} is not installed`)
      return
    }
    const root = await createRepo(FILES)
    const result = await run(root, "shell", { lefthook: "pre-commit/lint" }, ["s.sh"])
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => f.match.captures.ruleId)).toContain("SC2164")
  }, 60_000)
})
