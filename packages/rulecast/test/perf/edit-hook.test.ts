import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { linkTool } from "../helpers/linters"
import { claudeCodePayload } from "../helpers/payloads"

const cli = path.resolve("dist/cli.js")
const FILE = "src/feature/orders.ts"
const REGEX_RULES = 12
const PATH_RULES = 5
const AST_RULES = 8
const LINTER_RULES = 4

/** Spec §13: 30 rules across ast-grep, regex, path, a linter and command. */
function perfProject(): Record<string, string> {
  const topics = Array.from({ length: REGEX_RULES }, (_, i) => `## Topic ${i}\n\nGuidance for topic ${i}.\n`)
  const rules: Record<string, unknown>[] = []
  for (let i = 0; i < REGEX_RULES; i++) {
    rules.push({
      id: `perf/regex-${i}`,
      name: `Regex ${i}`,
      files: "^src/.*\\.ts$",
      detect: { regex: { pattern: `forbidden${i}\\((?<arg>[^)]*)\\)` } },
      message: `{{file}}:{{line}} calls forbidden${i}({{arg}}).`,
      context: [`@conventions/code.md#topic-${i}`],
    })
  }
  for (let i = 0; i < PATH_RULES; i++) {
    rules.push({
      id: `perf/path-${i}`,
      name: `Path ${i}`,
      files: "^generated/",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
    })
  }
  for (let i = 0; i < AST_RULES; i++) {
    rules.push({
      id: `perf/ast-${i}`,
      name: `Structure ${i}`,
      files: "^src/.*\\.ts$",
      severity: "warning",
      detect: { "ast-grep": { language: "typescript", rule: { pattern: `banned${i}($$$ARGS)` } } },
      message: `{{file}}:{{line}} calls banned${i}({{ARGS}}).`,
    })
  }
  for (let i = 0; i < LINTER_RULES; i++) {
    rules.push({
      id: `perf/lint-${i}`,
      name: `Lint ${i}`,
      files: "^src/.*\\.ts$",
      severity: "warning",
      detect: { linter: { tool: "oxlint" } },
      message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
    })
  }
  rules.push({
    id: "perf/command",
    name: "Command",
    files: "^src/.*\\.ts$",
    severity: "warning",
    detect: { command: { run: ["./perf-check.sh", "{{files}}"], captures: ["layer"] } },
    message: "{{file}}:{{line}} belongs to {{layer}}.",
  })
  return {
    ".rulecast-config.yaml": localConfig(rules),
    "conventions/code.md": ["# Code", "", ...topics].join("\n"),
    [FILE]: `${Array.from({ length: 300 }, (_, i) => `export const value${i} = compute(${i})`).join("\n")}\n`,
    "generated/client.ts": "export const client = 1\n",
    "perf-check.sh": '#!/bin/sh\necho \'[{"file":"src/feature/orders.ts","line":1,"layer":"feature"}]\'\n',
  }
}

/** Wall time from process start to exit, as Claude Code experiences it. */
function runHook(root: string, payload: unknown): { ms: number; stdout: string } {
  const started = performance.now()
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env: { ...process.env, RULECAST_HOME: TEST_HOME },
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  const ms = performance.now() - started
  if (result.status !== 0) throw new Error(`hook exited ${result.status}: ${result.stderr}`)
  return { ms, stdout: result.stdout }
}

describe.runIf(process.env.RULECAST_PERF === "1")("edit hook performance", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["build"])
  }, 60_000)

  test("p95 of 50 edit events stays under 500 ms", async () => {
    const root = await createRepo(perfProject())
    await chmod(path.join(root, "perf-check.sh"), 0o755)
    await linkTool(root, "oxlint")
    const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId: "perf" })
    runHook(root, payload("post-tool-use.read.complete"))
    for (let i = 0; i < 3; i++) runHook(root, payload("post-tool-use.edit"))

    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      appendFileSync(path.join(root, FILE), `export const added${i} = forbidden${i % REGEX_RULES}(${i})\n`)
      const { ms, stdout } = runHook(root, payload("post-tool-use.edit"))
      expect(stdout).toContain(`forbidden${i % REGEX_RULES}(${i})`)
      times.push(ms)
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.ceil(times.length * 0.5) - 1]!
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!
    console.log(`edit hook: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`)
    // RULECAST_PERF_GATE=0 measures and prints without asserting. A shared CI runner spawning one
    // subprocess per external tool per event is several times slower than the hardware the 500 ms
    // promise is made about, and a build that goes red because a runner was busy teaches people to
    // ignore CI. The gate stays a local check on real hardware (spec §13).
    if (process.env.RULECAST_PERF_GATE !== "0") expect(p95).toBeLessThan(500)
  }, 120_000)
})
