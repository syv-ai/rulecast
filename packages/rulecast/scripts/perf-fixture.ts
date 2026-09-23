import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync } from "node:fs"
import { chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { localConfig } from "../test/helpers/config"
import { createRepo } from "../test/helpers/git"
import { linkTool } from "../test/helpers/linters"
import { claudeCodePayload } from "../test/helpers/payloads"

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const cli = path.join(packageDir, "dist/cli.js")

/** Its own cache home, so a measurement never depends on, or disturbs, a real one. */
const HOME = mkdtempSync(path.join(tmpdir(), "rulecast-perf-"))

const FILE = "src/feature/orders.ts"
const REGEX_RULES = 12
const PATH_RULES = 5
const AST_RULES = 8
const LINTER_RULES = 4
const EVENTS = 50

/** Spec §13's requirement: the edit hook under this at p95, with warm caches. */
export const BUDGET_MS = 500

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
    env: { ...process.env, RULECAST_HOME: HOME },
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  const ms = performance.now() - started
  if (result.status !== 0) throw new Error(`hook exited ${result.status}: ${result.stderr}`)
  return { ms, stdout: result.stdout }
}

export interface Measurement {
  p50: number
  p95: number
  max: number
  events: number
  rules: number
}

/**
 * Replays EVENTS edit hooks over the fixture and returns the percentiles.
 *
 * Every event is checked to have produced its expected finding: a measurement of a hook that
 * quietly did nothing would be worse than no measurement.
 */
export async function measureEditHook(): Promise<Measurement> {
  execFileSync("pnpm", ["build"], { cwd: packageDir, stdio: "ignore" })
  const project = perfProject()
  const root = await createRepo(project)
  await chmod(path.join(root, "perf-check.sh"), 0o755)
  await linkTool(root, "oxlint")
  const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId: "perf" })

  // Warm the caches: the requirement is about a warm hook, not a cold one.
  runHook(root, payload("post-tool-use.read.complete"))
  for (let i = 0; i < 3; i++) runHook(root, payload("post-tool-use.edit"))

  const times: number[] = []
  for (let i = 0; i < EVENTS; i++) {
    appendFileSync(path.join(root, FILE), `export const added${i} = forbidden${i % REGEX_RULES}(${i})\n`)
    const { ms, stdout } = runHook(root, payload("post-tool-use.edit"))
    const expected = `forbidden${i % REGEX_RULES}(${i})`
    if (!stdout.includes(expected)) throw new Error(`event ${i} delivered no finding for ${expected}`)
    times.push(ms)
  }

  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.ceil(times.length * q) - 1]!
  const rules = REGEX_RULES + PATH_RULES + AST_RULES + LINTER_RULES + 1
  return { p50: at(0.5), p95: at(0.95), max: times.at(-1)!, events: EVENTS, rules }
}
