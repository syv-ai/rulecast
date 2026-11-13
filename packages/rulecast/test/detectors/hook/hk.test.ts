import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { hookDetector } from "../../../src/detectors/hook/detector"
import type { HookConfig } from "../../../src/detectors/hook/schema"
import { createRepo } from "../../helpers/git"
import { fromDisk } from "../../helpers/project"

/** Recorded from hk 2.12.0 (`hk run pre-commit --check --step … --format json`), started_at fixed. */
const payloads = fileURLToPath(new URL("../../payloads/hook/", import.meta.url))
const payload = (name: string) => readFileSync(payloads + name, "utf8")

const HK_PKL = `amends "package://github.com/jdx/hk/releases/download/v2.12.0/hk@2.12.0#/Config.pkl"

local linters = new Mapping<String, Step> {
  ["noprint"] {
    glob = "*.py"
    check = "grep -Hn 'print(' {{files}} && exit 1 || exit 0"
  }
}

hooks {
  ["pre-commit"] {
    fix = true
    stash = "git"
    steps = linters
  }
}
`

/** A stub hk in the project's node_modules/.bin: records each argv, prints a payload, exits as recorded. */
async function stubHk(root: string, name: string, exitCode: number): Promise<void> {
  const bin = path.join(root, "node_modules", ".bin")
  await mkdir(bin, { recursive: true })
  const file = path.join(bin, "hk")
  const out = payload(name).replace(/\n$/, "")
  await writeFile(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(root, "hk.calls")}"\ncat <<'OUT'\n${out}\nOUT\nexit ${exitCode}\n`,
  )
  await chmod(file, 0o755)
}

const calls = async (root: string) => (await readFile(path.join(root, "hk.calls"), "utf8")).trim().split("\n")

const ruleFor = (id: string, config: unknown, files: string[]): DetectorRuleInput<HookConfig> => ({
  id,
  config: hookDetector.schema.parse(config),
  files,
  context: [],
})

const run = (cwd: string, rules: DetectorRuleInput<HookConfig>[]) =>
  hookDetector.run({
    event: "verify",
    rules,
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  })

const project = () => createRepo({ "hk.pkl": HK_PKL, "a.py": "print(1)\nx = 1\n", "b.py": "y = 2\n" })

describe("hook detector: hk (#87)", () => {
  beforeEach(() => {
    vi.stubEnv("PATH", "/usr/bin:/bin")
    return () => vi.unstubAllEnvs()
  })

  test("runs one step in check mode on the rule's files, and reads its output", async () => {
    const root = await project()
    await stubHk(root, "hk-failed.json", 1)
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["a.py", "b.py"])])
    expect(await calls(root)).toEqual([
      "run pre-commit --check --step noprint --stash none --no-stage --format json a.py b.py",
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => finding.match.file)).toEqual(["a.py"])
  })

  test.each([
    ["a step that passes", "hk-passed.json"],
    ["a step whose glob matches none of the files", "hk-skipped.json"],
  ])("%s finds nothing", async (_name, file) => {
    const root = await project()
    await stubHk(root, file, 0)
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["b.py"])])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("a step hk does not know is the rule's error, in hk's words", async () => {
    const root = await project()
    await stubHk(root, "hk-unknown-step.json", 1)
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/nope" }, ["a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toEqual([
      { rule: "r", message: "hk: unknown step 'nope' for hook 'pre-commit'.\nAvailable steps: noprint" },
    ])
  })

  test("doctor's check finds the step in hk's plan, and names one that is not there", async () => {
    const root = await project()
    await stubHk(root, "hk-plan.json", 0)
    const results = await hookDetector.check!({
      rules: [
        { id: "a", config: hookDetector.schema.parse({ hk: "pre-commit/noprint" }) },
        { id: "b", config: hookDetector.schema.parse({ hk: "pre-commit/nope" }) },
      ],
      settings: defaultDetectorSettings(),
      env: process.env,
      cwd: root,
      signal: AbortSignal.timeout(5000),
    })
    expect(results.map((result) => [result.what, result.level, result.rules])).toEqual([
      ["hk", "ok", []],
      ['hk step "pre-commit/nope"', "error", ["b"]],
    ])
  })

  test("names exactly one hook manager", () => {
    expect(hookDetector.schema.safeParse({ hk: "pre-commit/noprint", lefthook: "pre-commit/x" }).success).toBe(false)
    expect(hookDetector.schema.safeParse({ hk: "noprint" }).success).toBe(false)
  })
})

const hk = (() => {
  try {
    return execFileSync("sh", ["-c", "command -v hk"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
})()

describe.skipIf(hk === null)("hook detector: a real hk", () => {
  test("a step's findings, and the files left as they were", async () => {
    const root = await project()
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["a.py", "b.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => [finding.match.file, finding.match.line])).toEqual([["a.py", 1]])
    expect(await readFile(path.join(root, "a.py"), "utf8")).toBe("print(1)\nx = 1\n")
  })
})
