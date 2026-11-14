import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { hookDetector } from "../../../src/detectors/hook/detector"
import { type HkPlan, hkNeedsNetwork, hkPlan } from "../../../src/detectors/hook/resolve"
import { HK_COMMIT_MSG, type HookConfig } from "../../../src/detectors/hook/schema"
import { createRepo, git } from "../../helpers/git"
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
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(root, "hk.calls")}"\nprintf '%s\\n' "$HK_PKL_OFFLINE" >> "${path.join(root, "hk.offline")}"\ncat <<'OUT'\n${out}\nOUT\nexit ${exitCode}\n`,
  )
  await chmod(file, 0o755)
}

/** A stub hk that prints `stderr` and exits 1 for every call: hk's own error. */
async function stubHkError(root: string, stderr: string): Promise<void> {
  const bin = path.join(root, "node_modules", ".bin")
  await mkdir(bin, { recursive: true })
  const file = path.join(bin, "hk")
  await writeFile(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(root, "hk.calls")}"\ncat >&2 <<'OUT'\n${stderr}\nOUT\nexit 1\n`,
  )
  await chmod(file, 0o755)
}

/** HOME in a scratch directory, with hk's Pkl package in pklr's cache when `cached`. */
async function pklHome(cached: boolean): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "rulecast-hk-home-"))
  vi.stubEnv("HOME", home)
  vi.stubEnv("XDG_CACHE_HOME", path.join(home, ".cache"))
  vi.stubEnv("HK_PKL_CACHE_DIR", "")
  if (cached) {
    for (const base of [path.join(home, "Library", "Caches"), path.join(home, ".cache")]) {
      const dir = path.join(base, "pklr", "packages")
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, "417dbb373e7e979d.url"), `${HK_ZIP}\n`)
    }
  }
  return home
}

const HK_ZIP = "https://github.com/jdx/hk/releases/download/v2.12.0/hk@2.12.0.zip"

const doctor = (root: string, specs: string[]) =>
  hookDetector.check!({
    rules: specs.map((hk, index) => ({
      id: String.fromCharCode(97 + index),
      config: hookDetector.schema.parse({ hk }),
    })),
    settings: defaultDetectorSettings(),
    env: process.env,
    cwd: root,
    signal: AbortSignal.timeout(5000),
  })

const what = (results: Awaited<ReturnType<typeof doctor>>) =>
  results.map((result) => [result.what, result.level, result.rules])

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
  beforeEach(async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin")
    await pklHome(true)
    return () => vi.unstubAllEnvs()
  })

  test("a step is not run when hk would first download its Pkl package: the rule says how to fetch it", async () => {
    const root = await project()
    await pklHome(false)
    await stubHk(root, "hk-failed.json", 1)
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toEqual([
      {
        rule: "r",
        message: `not run: hk's Pkl package ${HK_ZIP} is not in hk's cache, and reading hk.pkl would download it; run \`hk validate\` once to download it, and the rule runs from then on`,
      },
    ])
    await expect(calls(root)).rejects.toThrow()
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

  test("hk is always run offline, so it can never download its Pkl package: runs, plans and init", async () => {
    const root = await project()
    await stubHk(root, "hk-failed.json", 1)
    await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["a.py"])])
    await stubHk(root, "hk-plan.json", 0)
    await doctor(root, ["pre-commit/noprint"])
    await hkPlan(path.join(root, "node_modules", ".bin", "hk"), root, "check", AbortSignal.timeout(5000))
    const offline = (await readFile(path.join(root, "hk.offline"), "utf8")).trim().split("\n")
    expect(offline).toEqual(["1", "1", "1"])
  })

  test("a pre-push step gets stand-ins for the remote and a ref range, so hk never asks the git remote", async () => {
    const root = await project()
    await stubHk(root, "hk-failed.json", 1)
    await run(root, [ruleFor("r", { hk: "pre-push/noprint" }, ["a.py"])])
    expect(await calls(root)).toEqual([
      "run pre-push --check --step noprint --stash none --no-stage --format json --from-ref HEAD --to-ref HEAD rulecast rulecast a.py",
    ])
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
    await pklHome(true)
    await stubHk(root, "hk-plan.json", 0)
    expect(what(await doctor(root, ["pre-commit/noprint", "pre-commit/nope"]))).toEqual([
      ["hk", "ok", []],
      ['hk step "pre-commit/nope"', "error", ["b"]],
    ])
    expect(await calls(root)).toEqual(["run pre-commit --plan --json --all --check"])
  })

  test("doctor's check does not ask hk when its Pkl package would be downloaded", async () => {
    const root = await project()
    await pklHome(false)
    await stubHk(root, "hk-plan.json", 0)
    const results = await doctor(root, ["pre-commit/noprint"])
    expect(what(results)).toEqual([
      ["hk", "ok", []],
      ["hk steps", "warning", []],
    ])
    expect(results[1]!.detail).toBe(
      `not checked: hk's Pkl package ${HK_ZIP} is not in hk's cache, and reading hk.pkl would download it`,
    )
    await expect(calls(root)).rejects.toThrow()
  })

  test("doctor's check never plans pre-push, which asks the git remote", async () => {
    const root = await project()
    await pklHome(true)
    await stubHk(root, "hk-plan.json", 0)
    expect(what(await doctor(root, ["pre-push/noprint"]))).toEqual([
      ["hk", "ok", []],
      ['hk step "pre-push/noprint"', "warning", ["a"]],
    ])
    await expect(calls(root)).rejects.toThrow()
  })

  test("doctor's check: a hook hk.pkl lacks, a plan hk can't make, a step hk never runs to check", async () => {
    const missing = await project()
    await pklHome(true)
    await stubHkError(missing, "Error: Hook 'check' not found. Defined hooks: pre-commit")
    expect(what(await doctor(missing, ["check/noprint"]))).toEqual([
      ["hk", "ok", []],
      ['hk hook "check"', "error", ["a"]],
    ])
    const broken = await project()
    await stubHkError(
      broken,
      "Error: Failed to load configuration\n\nCaused by:\n    Failed to evaluate Pkl config\n\n    hk.pkl:2:62: Missing `}` delimiter.\n       |\n     2 | hooks {\n       |       ^",
    )
    const results = await doctor(broken, ["pre-commit/noprint"])
    expect(results[1]).toMatchObject({
      what: 'hk hook "pre-commit"',
      level: "error",
      detail: "hk could not plan it: hk.pkl:2:62: Missing `}` delimiter.",
    })
    const fixOnly = await project()
    await stubHk(fixOnly, "hk-plan-fix-only.json", 0)
    expect((await doctor(fixOnly, ["pre-commit/noprint"]))[1]).toMatchObject({
      what: 'hk step "pre-commit/noprint"',
      level: "error",
      detail: "hk never runs it to check: no command defined for run type: check",
    })
  })

  test("a commit-msg step can't be a hook rule: it checks the message, not files", () => {
    const parsed = hookDetector.schema.safeParse({ hk: "commit-msg/conventional" })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(HK_COMMIT_MSG)
  })

  test("names exactly one hook manager", () => {
    expect(hookDetector.schema.safeParse({ hk: "pre-commit/noprint", lefthook: "pre-commit/x" }).success).toBe(false)
    expect(hookDetector.schema.safeParse({ hk: "noprint" }).success).toBe(false)
  })
})

describe("hkNeedsNetwork: hk is asked only when its Pkl packages are in pklr's cache (#87)", () => {
  beforeEach(() => () => vi.unstubAllEnvs())

  test("a package in the cache, or none at all, needs no network", async () => {
    await pklHome(true)
    expect(await hkNeedsNetwork(await project(), process.env)).toBeNull()
    expect(await hkNeedsNetwork(await createRepo({ "hk.pkl": "hooks {}\n" }), process.env)).toBeNull()
  })

  test("a package not in the cache, through the local config that amends hk.pkl, would be downloaded", async () => {
    await pklHome(false)
    const root = await createRepo({ "hk.pkl": HK_PKL, "hk.local.pkl": 'amends "hk.pkl"\n' })
    expect(await hkNeedsNetwork(root, process.env)).toBe(
      `hk's Pkl package ${HK_ZIP} is not in hk's cache, and reading hk.pkl would download it`,
    )
  })

  test("HK_PKL_CACHE_DIR, when set, is where hk keeps its Pkl packages", async () => {
    const home = await pklHome(true)
    const elsewhere = path.join(home, "pkl-cache")
    vi.stubEnv("HK_PKL_CACHE_DIR", elsewhere)
    expect(await hkNeedsNetwork(await project(), process.env)).toBe(
      `hk's Pkl package ${HK_ZIP} is not in hk's cache, and reading hk.pkl would download it`,
    )
    await pklHome(false)
    vi.stubEnv("HK_PKL_CACHE_DIR", elsewhere)
    await mkdir(path.join(elsewhere, "packages"), { recursive: true })
    await writeFile(path.join(elsewhere, "packages", "417dbb373e7e979d.url"), `${HK_ZIP}\n`)
    expect(await hkNeedsNetwork(await project(), process.env)).toBeNull()
  })

  test("a config that reads an http module would download it", async () => {
    await pklHome(true)
    const root = await createRepo({ "hk.pkl": 'import "https://example.com/steps.pkl"\nhooks {}\n' })
    expect(await hkNeedsNetwork(root, process.env)).toBe(
      "hk.pkl reads https://example.com/steps.pkl, which hk would download",
    )
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
  // A hook rule never downloads hk's Pkl package itself: fetch it here, visibly, as the rule's error says to.
  beforeAll(async () => {
    execFileSync(hk!, ["validate"], { cwd: await project(), stdio: "ignore" })
  })

  test("hk's plan: a hook's steps, commit-msg's without a message, and a hook hk.pkl lacks", async () => {
    const commitMsg = '  ["commit-msg"] {\n    steps { ["msg"] { check = "true" } }\n  }\n'
    const root = await createRepo({ "hk.pkl": HK_PKL.replace("hooks {\n", `hooks {\n${commitMsg}`), "a.py": "x = 1\n" })
    const signal = AbortSignal.timeout(30_000)
    const names = (plan: HkPlan) => ("steps" in plan ? plan.steps.map((step) => step.name) : plan)
    expect(names(await hkPlan(hk!, root, "pre-commit", signal))).toEqual(["noprint"])
    expect(names(await hkPlan(hk!, root, "commit-msg", signal))).toEqual(["msg"])
    expect(await hkPlan(hk!, root, "check", signal)).toEqual({ missing: true })
  })

  test("a pre-push step runs on the rule's files and never asks the git remote", async () => {
    const root = await createRepo({
      "hk.pkl": HK_PKL.replace('["pre-commit"]', '["pre-push"]'),
      "a.py": "print(1)\nx = 1\n",
      "b.py": "y = 2\n",
    })
    await git(root, "remote", "add", "origin", "https://example.invalid/repo.git")
    // a.py is committed and unchanged since: only the files given decide what is checked.
    const trace = path.join(root, ".git", "trace.log")
    vi.stubEnv("GIT_TRACE", trace)
    try {
      const result = await run(root, [ruleFor("r", { hk: "pre-push/noprint" }, ["a.py", "b.py"])])
      expect(result.errors).toEqual([])
      expect(result.findings.map((finding) => [finding.match.file, finding.match.line])).toEqual([["a.py", 1]])
    } finally {
      vi.unstubAllEnvs()
    }
    const traced = await readFile(trace, "utf8")
    expect(traced).toContain("git status")
    expect(traced).not.toMatch(/ls-remote|remote-https|fetch/)
  })

  test("a step's findings, and the files left as they were", async () => {
    const root = await project()
    const result = await run(root, [ruleFor("r", { hk: "pre-commit/noprint" }, ["a.py", "b.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => [finding.match.file, finding.match.line])).toEqual([["a.py", 1]])
    expect(await readFile(path.join(root, "a.py"), "utf8")).toBe("print(1)\nx = 1\n")
  })
})
