import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { localConfig } from "../test/helpers/config"
import { createRepo } from "../test/helpers/git"
import { linkTool } from "../test/helpers/linters"
import { claudeCodePayload } from "../test/helpers/payloads"
import { buildBinary, hostTarget } from "./build-binary"

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const cli = path.join(packageDir, "dist/cli.js")

/** The standalone binary to measure instead of node and dist/cli.js, or null. */
function binaryUnderTest(): string | null {
  if (process.env.RULECAST_PERF_BINARY) return path.resolve(process.env.RULECAST_PERF_BINARY)
  if (process.argv.includes("--binary")) return path.join(packageDir, "binaries", `rulecast-${hostTarget()}`)
  return null
}

export const PERF_BINARY = binaryUnderTest()

/** The command every measured hook runs: node and the built CLI, or the standalone binary alone. */
export function hookCommand(): [string, ...string[]] {
  return PERF_BINARY === null ? [process.execPath, cli] : [PERF_BINARY]
}

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

interface RuleCounts {
  regex: number
  path: number
  ast: number
  linter: number
  command: number
}

const COUNTS: RuleCounts = { regex: REGEX_RULES, path: PATH_RULES, ast: AST_RULES, linter: LINTER_RULES, command: 1 }

/**
 * The perf rules, `counts` of each kind. `id` prefixes the rule ids, `word` the regex rules' call
 * (`<word><i>(…)`), and `files` is the pattern of the files they check, relative to the config.
 */
function perfRules(
  counts: RuleCounts,
  options: { id: string; word: string; files: string },
): Record<string, unknown>[] {
  const { id, word, files } = options
  const rules: Record<string, unknown>[] = []
  for (let i = 0; i < counts.regex; i++) {
    rules.push({
      id: `${id}/regex-${i}`,
      name: `Regex ${i}`,
      files,
      detect: { regex: { pattern: `${word}${i}\\((?<arg>[^)]*)\\)` } },
      message: `{{file}}:{{line}} calls ${word}${i}({{arg}}).`,
      context: [`@conventions/code.md#topic-${i}`],
    })
  }
  for (let i = 0; i < counts.path; i++) {
    rules.push({
      id: `${id}/path-${i}`,
      name: `Path ${i}`,
      files: "^generated/",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
    })
  }
  for (let i = 0; i < counts.ast; i++) {
    rules.push({
      id: `${id}/ast-${i}`,
      name: `Structure ${i}`,
      files,
      severity: "warning",
      detect: { "ast-grep": { language: "typescript", rule: { pattern: `banned${i}($$$ARGS)` } } },
      message: `{{file}}:{{line}} calls banned${i}({{ARGS}}).`,
    })
  }
  for (let i = 0; i < counts.linter; i++) {
    rules.push({
      id: `${id}/lint-${i}`,
      name: `Lint ${i}`,
      files,
      severity: "warning",
      detect: { linter: { tool: "oxlint" } },
      message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
    })
  }
  for (let i = 0; i < counts.command; i++) {
    rules.push({
      id: `${id}/command`,
      name: "Command",
      files,
      severity: "warning",
      detect: { command: { run: ["./perf-check.sh", "{{files}}"], captures: ["layer"] } },
      message: "{{file}}:{{line}} belongs to {{layer}}.",
    })
  }
  return rules
}

const conventions = (topics: number) =>
  ["# Code", "", ...Array.from({ length: topics }, (_, i) => `## Topic ${i}\n\nGuidance for topic ${i}.\n`)].join("\n")

const source = () => `${Array.from({ length: 300 }, (_, i) => `export const value${i} = compute(${i})`).join("\n")}\n`

/** Spec §13: 30 rules across ast-grep, regex, path, a linter and command. */
function perfProject(): Record<string, string> {
  return {
    ".rulecast-config.yaml": localConfig(perfRules(COUNTS, { id: "perf", word: "forbidden", files: "^src/.*\\.ts$" })),
    "conventions/code.md": conventions(REGEX_RULES),
    [FILE]: source(),
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
  const [command, ...args] = hookCommand()
  const started = performance.now()
  const result = spawnSync(command, [...args, "hook", "claude-code"], {
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

function percentiles(times: number[], rules = RULES): Measurement {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.ceil(sorted.length * q) - 1]!
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1)!, events: sorted.length, rules }
}

/** The fixture as a committed repository, built and ready for hooks. `dirty` files are left changed. */
let built = false

async function build(): Promise<void> {
  if (built) return
  built = true
  if (PERF_BINARY === null) execFileSync("pnpm", ["build"], { cwd: packageDir, stdio: "ignore" })
  else if (!existsSync(PERF_BINARY)) {
    if (process.env.RULECAST_PERF_BINARY)
      throw new Error(`RULECAST_PERF_BINARY is ${PERF_BINARY}, which does not exist`)
    await buildBinary(PERF_BINARY)
  }
}

async function preparedProject(dirty = 0): Promise<string> {
  await build()
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

export interface InstallMeasurement {
  /** The first edit on a fresh cache home right after `binary install`, which unpacked the native files. */
  afterInstall: Measurement
  /** The same first edit on a fresh cache home with no install before it: the edit pays the unpacking. */
  withoutInstall: Measurement
}

const INSTALLS = 5

/**
 * The binary only: `binary install` unpacks and loads ast-grep's native files, so the first edit
 * after it costs what a warm one does. Each of INSTALLS runs takes a cache home nothing has used.
 * Report only.
 */
export async function measureFirstEditAfterInstall(): Promise<InstallMeasurement> {
  if (PERF_BINARY === null) throw new Error("measureFirstEditAfterInstall measures the standalone binary")
  await build()
  const root = await preparedProject()
  const original = readFileSync(path.join(root, FILE), "utf8")
  const homes: string[] = []
  const firstEdit = (home: string, sessionId: string) => {
    writeFileSync(path.join(root, FILE), original)
    const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId })
    runHook(root, payload("post-tool-use.read.complete"), home)
    appendFileSync(path.join(root, FILE), "export const first = forbidden0(42)\n")
    const edit = runHook(root, payload("post-tool-use.edit"), home)
    if (!edit.stdout.includes("forbidden0(42)")) throw new Error("the first edit delivered no finding")
    return edit.ms
  }
  const after: number[] = []
  const without: number[] = []
  try {
    for (let i = 0; i < INSTALLS; i++) {
      const installed = mkdtempSync(path.join(tmpdir(), "rulecast-perf-install-"))
      const fresh = mkdtempSync(path.join(tmpdir(), "rulecast-perf-install-"))
      homes.push(installed, fresh)
      execFileSync(PERF_BINARY, ["binary", "install"], { env: { ...process.env, RULECAST_HOME: installed } })
      after.push(firstEdit(installed, `perf-install-${i}`))
      without.push(firstEdit(fresh, `perf-fresh-${i}`))
    }
    return { afterInstall: percentiles(after), withoutInstall: percentiles(without) }
  } finally {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  }
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

/** The nested fixture's package, and the file under both configs, relative to the top. */
const PACKAGE = "backend"
const NESTED_FILE = `${PACKAGE}/${FILE}`

/** The top config's share of the perf rules: repository-wide checks on every TypeScript file. */
const TOP_COUNTS: RuleCounts = { regex: 6, path: 2, ast: 2, linter: 0, command: 0 }
/** The package's share: its own regex and structure rules, and the tools that run in it. */
const PACKAGE_COUNTS: RuleCounts = { regex: 6, path: 3, ast: 6, linter: LINTER_RULES, command: 1 }

const count = (counts: RuleCounts) => counts.regex + counts.path + counts.ast + counts.linter + counts.command
const NESTED_RULES = count(TOP_COUNTS) + count(PACKAGE_COUNTS)

/**
 * Plan 19: a repository with a top config and a package config, the same 30 rules split between
 * them. The top's regex rules call `shared<i>(…)`, the package's `forbidden<i>(…)`, so one line can
 * break a rule of each and the delivery must carry both.
 */
function nestedProject(dirty: number): Record<string, string> {
  const project: Record<string, string> = {
    ".rulecast-config.yaml": localConfig(perfRules(TOP_COUNTS, { id: "top", word: "shared", files: "\\.ts$" })),
    "conventions/code.md": conventions(TOP_COUNTS.regex),
    "generated/client.ts": "export const client = 1\n",
    [`${PACKAGE}/.rulecast-config.yaml`]: localConfig(
      perfRules(PACKAGE_COUNTS, { id: "backend", word: "forbidden", files: "^src/.*\\.ts$" }),
    ),
    [`${PACKAGE}/conventions/code.md`]: conventions(PACKAGE_COUNTS.regex),
    [NESTED_FILE]: source(),
    [`${PACKAGE}/generated/client.ts`]: "export const client = 1\n",
    [`${PACKAGE}/perf-check.sh`]: '#!/bin/sh\necho \'[{"file":"src/feature/orders.ts","line":1,"layer":"feature"}]\'\n',
  }
  for (let i = 0; i < dirty; i++) project[`${PACKAGE}/src/dirty/file${i}.ts`] = `export const dirty${i} = ${i}\n`
  return project
}

export interface NestedMeasurement {
  /** PostToolUse Edit of a file under both configs: both projects' pipelines. Held to BUDGET_MS. */
  edit: Measurement
  /** PreToolUse Bash from the top. Held to SHELL_BEFORE_ADDED_MS over `floor`. */
  before: Measurement
  /** PostToolUse Bash after a command that changed the package's file. Held to BUDGET_MS. */
  after: Measurement
  /** A prompt event in the same session: the cost of a hook process that does nothing. */
  floor: Measurement
  /** Stop after an edit that broke a rule of each config. Held to BUDGET_MS. */
  stop: Measurement
  dirty: number
}

/**
 * Plan 19, Task 8: the hooks in a repository with a top config and a package config, the session
 * launched at the top ($CLAUDE_PROJECT_DIR) and every hook run from there. EVENTS edits of a file
 * under both configs; EVENTS Bash calls, as measureShellHooks, with DIRTY package files changed; and
 * EVENTS stops, each after an edit. Every edit, Bash call and stop must deliver a finding from each
 * config.
 */
export async function measureNestedConfigs(): Promise<NestedMeasurement> {
  await build()
  const project = nestedProject(DIRTY)
  const root = await createRepo(project)
  await chmod(path.join(root, PACKAGE, "perf-check.sh"), 0o755)
  await linkTool(root, "oxlint")
  for (let i = 0; i < DIRTY; i++) {
    writeFileSync(path.join(root, `${PACKAGE}/src/dirty/file${i}.ts`), `export const dirty${i} = ${i + 1}\n`)
  }
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root }
  const hook = (payload: unknown) => runHook(root, payload, HOME, env)
  const payload = (name: string, toolUseId?: string) => {
    const value = claudeCodePayload(name, { root, file: NESTED_FILE, sessionId: "perf-nested" })
    if (toolUseId !== undefined) value.tool_use_id = toolUseId
    return value
  }
  // Each phase starts from the committed file, so no rule's matches outgrow the per-rule cap shown.
  const restore = () => writeFileSync(path.join(root, NESTED_FILE), project[NESTED_FILE]!)
  /** A line breaking a top rule and a package rule, and the check that a hook delivered both. */
  const breakBoth = (tag: string, i: number) => {
    const top = `shared${i % TOP_COUNTS.regex}(${tag}${i})`
    const own = `forbidden${i % PACKAGE_COUNTS.regex}(${tag}${i})`
    appendFileSync(path.join(root, NESTED_FILE), `export const ${tag}${i} = [${top}, ${own}]\n`)
    return (what: string, stdout: string) => {
      for (const expected of [top, own]) {
        if (!stdout.includes(expected)) throw new Error(`${what} ${i} delivered no finding for ${expected}`)
      }
    }
  }

  hook(payload("session-start.startup"))
  // Warm, as the other hooks are measured warm.
  hook(payload("post-tool-use.read.complete"))
  for (let i = 0; i < 3; i++) {
    hook(payload("post-tool-use.edit"))
    hook(payload("pre-tool-use.bash", `toolu_nested_warm${i}`))
    hook(payload("post-tool-use.bash", `toolu_nested_warm${i}`))
    hook(payload("stop"))
  }

  const edit: number[] = []
  restore()
  for (let i = 0; i < EVENTS; i++) {
    const check = breakBoth("edit", i)
    const { ms, stdout } = hook(payload("post-tool-use.edit"))
    check("edit", stdout)
    edit.push(ms)
  }

  const before: number[] = []
  const after: number[] = []
  const floor: number[] = []
  restore()
  for (let i = 0; i < EVENTS; i++) {
    const id = `toolu_nested${i}`
    before.push(hook(payload("pre-tool-use.bash", id)).ms)
    const check = breakBoth("shell", i)
    const { ms, stdout } = hook(payload("post-tool-use.bash", id))
    check("shell call", stdout)
    after.push(ms)
    floor.push(hook(payload("user-prompt-submit")).ms)
  }

  const stop: number[] = []
  restore()
  for (let i = 0; i < EVENTS; i++) {
    const check = breakBoth("stop", i)
    hook(payload("post-tool-use.edit"))
    const { ms, stdout } = hook(payload("stop"))
    check("stop", stdout)
    stop.push(ms)
  }

  const measured = (times: number[]) => percentiles(times, NESTED_RULES)
  return {
    edit: measured(edit),
    before: measured(before),
    after: measured(after),
    floor: measured(floor),
    stop: measured(stop),
    dirty: DIRTY,
  }
}
