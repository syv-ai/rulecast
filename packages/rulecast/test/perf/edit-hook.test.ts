import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { createRepo } from "../helpers/git"
import { claudeCodePayload } from "../helpers/payloads"

const cli = path.resolve("dist/cli.js")
const FILE = "src/feature/orders.ts"
const RULES = 25

/** 25 regex rules and 5 path rules. Plan 5 adds ast-grep, ruff and command rules (spec §13). */
function perfProject(): Record<string, string> {
  const topics = Array.from({ length: RULES }, (_, i) => `## Topic ${i}\n\nGuidance for topic ${i}.\n`)
  const files: Record<string, string> = {
    "conventions/code.md": ["# Code", "", ...topics].join("\n"),
    [FILE]: `${Array.from({ length: 300 }, (_, i) => `export const value${i} = compute(${i})`).join("\n")}\n`,
    "generated/client.ts": "export const client = 1\n",
  }
  for (let i = 0; i < RULES; i++) {
    files[`.rulecast/rules/regex-${i}.yml`] = [
      `id: perf/regex-${i}`,
      "files: src/**/*.ts",
      "detect:",
      `  regex: { pattern: 'forbidden${i}\\((?<arg>[^)]*)\\)' }`,
      `message: '{{file}}:{{line}} calls forbidden${i}({{arg}}).'`,
      `context: ['@conventions/code.md#topic-${i}']`,
      "",
    ].join("\n")
  }
  for (let i = 0; i < 5; i++) {
    files[`.rulecast/rules/path-${i}.yml`] = [
      `id: perf/path-${i}`,
      "files: generated/**",
      "severity: warning",
      "detect: { path: {} }",
      "message: '{{file}} is generated.'",
      "",
    ].join("\n")
  }
  return files
}

/** Wall time from process start to exit, as Claude Code experiences it. */
function runHook(root: string, payload: unknown): { ms: number; stdout: string } {
  const started = performance.now()
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
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
    const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId: "perf" })
    runHook(root, payload("post-tool-use.read.complete"))
    for (let i = 0; i < 3; i++) runHook(root, payload("post-tool-use.edit"))

    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      appendFileSync(path.join(root, FILE), `export const added${i} = forbidden${i % RULES}(${i})\n`)
      const { ms, stdout } = runHook(root, payload("post-tool-use.edit"))
      expect(stdout).toContain(`forbidden${i % RULES}(${i})`)
      times.push(ms)
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.ceil(times.length * 0.5) - 1]!
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!
    console.log(`edit hook: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`)
    expect(p95).toBeLessThan(500)
  }, 120_000)
})
