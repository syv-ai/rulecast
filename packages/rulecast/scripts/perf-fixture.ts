import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

/**
 * Plan 11, Decision 9: what the hook before every shell command may add over a hook that does
 * nothing (a prompt event: read stdin, compile the config, exit), at p95.
 */
export const SHELL_BEFORE_ADDED_MS = 150

/** Files the user had changed before the session: what every tree state lists and `lstat`s. */
const DIRTY = 20

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
function runHook(
  root: string,
  payload: unknown,
  home = HOME,
  env: NodeJS.ProcessEnv = process.env,
): { ms: number; stdout: string } {
  const started = performance.now()
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env: { ...env, RULECAST_HOME: home },
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

const RULES = REGEX_RULES + PATH_RULES + AST_RULES + LINTER_RULES + 1

function percentiles(times: number[]): Measurement {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.ceil(sorted.length * q) - 1]!
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1)!, events: sorted.length, rules: RULES }
}

/** The fixture as a committed repository, built and ready for hooks. `dirty` files are left changed. */
let built = false

async function preparedProject(dirty = 0): Promise<string> {
  if (!built) execFileSync("pnpm", ["build"], { cwd: packageDir, stdio: "ignore" })
  built = true
  const project = perfProject()
  for (let i = 0; i < dirty; i++) project[`src/dirty/file${i}.ts`] = `export const dirty${i} = ${i}\n`
  const root = await createRepo(project)
  await chmod(path.join(root, "perf-check.sh"), 0o755)
  await linkTool(root, "oxlint")
  for (let i = 0; i < dirty; i++) {
    writeFileSync(path.join(root, `src/dirty/file${i}.ts`), `export const dirty${i} = ${i + 1}\n`)
  }
  return root
}

/**
 * Replays EVENTS edit hooks over the fixture and returns the percentiles.
 *
 * Every event is checked to have produced its expected finding: a measurement of a hook that
 * quietly did nothing would be worse than no measurement.
 */
export async function measureEditHook(): Promise<Measurement> {
  const root = await preparedProject()
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
  return percentiles(times)
}

export interface ShellMeasurement {
  /** PreToolUse Bash: records the tree state. Held to SHELL_BEFORE_ADDED_MS over `floor`. */
  before: Measurement
  /** PostToolUse Bash after a command that changed one file: an edit event for it. Held to BUDGET_MS. */
  after: Measurement
  /** A prompt event: the cost of a hook process that does nothing. */
  floor: Measurement
  dirty: number
}

/**
 * Replays EVENTS Bash calls over the fixture with DIRTY files changed before the session: each a
 * before hook, a one-line append that breaks a rule, and an after hook that must report it. The
 * floor is EVENTS prompt events in the same project.
 */
export async function measureShellHooks(): Promise<ShellMeasurement> {
  const root = await preparedProject(DIRTY)
  const payload = (name: string, toolUseId?: string) => {
    const value = claudeCodePayload(name, { root, sessionId: "perf-shell" })
    if (toolUseId !== undefined) value.tool_use_id = toolUseId
    return value
  }
  runHook(root, payload("session-start.startup"))
  // Warm, as the edit hook is measured warm.
  for (let i = 0; i < 3; i++) {
    runHook(root, payload("pre-tool-use.bash", `toolu_warm${i}`))
    runHook(root, payload("post-tool-use.bash", `toolu_warm${i}`))
  }

  const before: number[] = []
  const after: number[] = []
  const floor: number[] = []
  for (let i = 0; i < EVENTS; i++) {
    const id = `toolu_perf${i}`
    before.push(runHook(root, payload("pre-tool-use.bash", id)).ms)
    appendFileSync(path.join(root, FILE), `export const shell${i} = forbidden${i % REGEX_RULES}(${1000 + i})\n`)
    const { ms, stdout } = runHook(root, payload("post-tool-use.bash", id))
    const expected = `forbidden${i % REGEX_RULES}(${1000 + i})`
    if (!stdout.includes(expected)) throw new Error(`shell call ${i} delivered no finding for ${expected}`)
    after.push(ms)
    floor.push(runHook(root, payload("user-prompt-submit")).ms)
  }
  return { before: percentiles(before), after: percentiles(after), floor: percentiles(floor), dirty: DIRTY }
}

export interface WorktreeMeasurement {
  /** The first edit hook in a new worktree, the rule repos and the cache home shared (one machine). */
  firstEdit: Measurement
  /** The first edit of a new session in the warm project itself: what is not the worktree's doing. */
  newSession: Measurement
  /** SessionStart in that worktree: the work done before the first edit. */
  sessionStart: Measurement
  /** The same first edit with a cache home nothing has used: its per-project detector cache only, as no rule repos are pinned. */
  coldHome: Measurement
  /** The first edit with the worktree's node_modules missing: how many rules it said did not run. */
  depsMissing: string
  worktrees: number
}

const WORKTREES = 10

/**
 * #29: what a new worktree costs before its first edit is checked. Each of WORKTREES worktrees is
 * added from a project whose hooks are warm, started (SessionStart, a Read), and given one edit
 * that breaks a rule; that edit is timed and must deliver its finding. Report only: not held to
 * BUDGET_MS, which is about a warm hook.
 */
export async function measureNewWorktree(): Promise<WorktreeMeasurement> {
  const main = await preparedProject()
  const warm = (name: string) => claudeCodePayload(name, { root: main, file: FILE, sessionId: "perf-main" })
  runHook(main, warm("post-tool-use.read.complete"))
  for (let i = 0; i < 3; i++) runHook(main, warm("post-tool-use.edit"))

  const parent = mkdtempSync(path.join(tmpdir(), "rulecast-perf-wt-"))
  const created: string[] = []
  const homes: string[] = []
  const worktree = async (name: string, deps: boolean): Promise<string> => {
    const root = path.join(parent, name)
    execFileSync("git", ["-C", main, "worktree", "add", "-q", "--detach", root], { stdio: "ignore" })
    created.push(root)
    // Neither is in the commit: the mode was set after it, and node_modules is never committed.
    await chmod(path.join(root, "perf-check.sh"), 0o755)
    if (deps) await linkTool(root, "oxlint")
    return root
  }
  const firstEdit = (root: string, sessionId: string, home: string) => {
    const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId })
    const start = runHook(root, payload("session-start.startup"), home).ms
    runHook(root, payload("post-tool-use.read.complete"), home)
    appendFileSync(path.join(root, FILE), "export const first = forbidden0(42)\n")
    const edit = runHook(root, payload("post-tool-use.edit"), home)
    if (!edit.stdout.includes("forbidden0(42)")) throw new Error(`${root}: the first edit delivered no finding`)
    return { start, edit }
  }

  const edits: number[] = []
  const starts: number[] = []
  const cold: number[] = []
  const sessions: number[] = []
  // Each new session edits the file as it was committed, not the last session's edit plus one more.
  const original = readFileSync(path.join(main, FILE), "utf8")
  try {
    for (let i = 0; i < WORKTREES; i++) {
      sessions.push(firstEdit(main, `perf-main-${i}`, HOME).edit.ms)
      writeFileSync(path.join(main, FILE), original)
      const shared = firstEdit(await worktree(`wt-${i}`, true), `perf-wt-${i}`, HOME)
      edits.push(shared.edit.ms)
      starts.push(shared.start)
      const home = mkdtempSync(path.join(tmpdir(), "rulecast-perf-home-"))
      homes.push(home)
      cold.push(firstEdit(await worktree(`cold-${i}`, true), `perf-cold-${i}`, home).edit.ms)
    }

    const bare = await worktree("no-deps", false)
    const payload = (name: string) => claudeCodePayload(name, { root: bare, file: FILE, sessionId: "perf-no-deps" })
    runHook(bare, payload("session-start.startup"))
    appendFileSync(path.join(bare, FILE), "export const first = forbidden0(42)\n")
    // pnpm puts the workspace's node_modules/.bin on the PATH, where the linter would be found.
    const PATH = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => !dir.includes("node_modules"))
    const noDeps = { ...process.env, PATH: PATH.join(path.delimiter) }
    const edited = runHook(bare, payload("post-tool-use.edit"), HOME, noDeps).stdout
    const said = JSON.parse(edited || "{}") as { systemMessage?: string }
    const depsMissing = (said.systemMessage ?? "").split("\n").find((text) => text.includes("oxlint")) ?? "nothing said"

    return {
      firstEdit: percentiles(edits),
      newSession: percentiles(sessions),
      sessionStart: percentiles(starts),
      coldHome: percentiles(cold),
      depsMissing: depsMissing.trim(),
      worktrees: WORKTREES,
    }
  } finally {
    for (const root of created) {
      execFileSync("git", ["-C", main, "worktree", "remove", "--force", root], { stdio: "ignore" })
    }
    for (const dir of [parent, ...homes]) rmSync(dir, { recursive: true, force: true })
  }
}
