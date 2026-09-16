# rulecast Plan 2b — `rulecast hook`, `warm`, `init` and the perf test Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the commands that connect rulecast to Claude Code: `rulecast hook claude-code`, `rulecast warm` with detached background warm-up, `rulecast init` with a non-destructive settings merge, and the edit-hook performance test.

**Architecture:** `rulecast hook <adapter>` reads a payload from stdin, lets the adapter turn it into an event, runs the pipeline in the project found from the agent's directory, and writes the adapter's output. It always exits 0. Detectors gain an optional `warm` method; `rulecast warm` runs it per detector kind under a lock, and hooks start it detached on session start and after an edit deadline. `rulecast init` scaffolds a project and merges rulecast's hooks into `.claude/settings.json` without touching existing entries. Spec: `docs/specs/2026-09-15-rulecast-design.md` §12, §13, §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, zod 3, vitest, tsup, `node:child_process`.

Prerequisite: `2026-09-16-rulecast-02a-adapter.md` is done. This completes plan 2.

---

## Conventions

- Run a single test file with `pnpm vitest run <path>`. Run everything with `pnpm test`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`.

## File structure

| File | Responsibility |
|---|---|
| `src/commands/spawn.ts` | Start a detached process |
| `src/commands/main.ts` | `CliIo` gains `readStdin` and `startWarm`; dispatch for `hook`, `warm`, `init` |
| `src/cli.ts` | Real stdin and detached `rulecast warm` |
| `test/helpers/cli.ts` | In-process CLI runs with captured output |
| `src/core/types.ts` | `DetectorWarm`, optional `Detector.warm` |
| `src/core/detection/warm.ts` | `warmableKinds`, `warmDetectors` (per-kind lock) |
| `src/commands/warm.ts` | `rulecast warm [--detector <kind>]...` |
| `src/commands/hook.ts` | `rulecast hook <adapter>` |
| `src/adapters/claude-code/settings.ts` | Merge rulecast's hooks into Claude Code settings |
| `src/commands/init.ts` | `rulecast init` |
| `test/perf/edit-hook.test.ts` | Edit hook p95 < 500 ms (`pnpm test:perf`) |

## Not in this plan

- **Store corruption fallback (§14 "Store unreadable").** The pipeline still throws `CorruptStoreError`; the hook catches it, logs it and prints nothing. Plan 1's partial-record repair makes this rare. Implement the spec's fallback (run without session state, with a warning) separately.
- **Perf fixture detectors.** §13 names ast-grep, ruff and command rules; only `regex` and `path` exist yet. Plan 3 adds those rules to `test/perf/edit-hook.test.ts`.

---

### Task 8: CLI I/O for hooks

**Files:**
- Create: `src/commands/spawn.ts`, `test/helpers/cli.ts`
- Modify: `src/commands/main.ts` (`CliIo`), `src/cli.ts`, `test/commands/main.test.ts` (`run` helper)
- Test: `test/commands/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/spawn.test.ts`:
```ts
import { existsSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

import { spawnDetached } from "../../src/commands/spawn"
import { createProject } from "../helpers/project"

test("a detached process keeps running after spawnDetached returns", async () => {
  const dir = await createProject({})
  const marker = path.join(dir, "done")
  const script = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"), 50)`
  spawnDetached(process.execPath, ["-e", script], dir)
  expect(existsSync(marker)).toBe(false)
  await expect.poll(() => existsSync(marker), { timeout: 5000 }).toBe(true)
})

test("a command that cannot start does not throw", async () => {
  const dir = await createProject({})
  expect(() => spawnDetached(path.join(dir, "no-such-binary"), [], dir)).not.toThrow()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/spawn.test.ts`
Expected: FAIL: cannot find module `../../src/commands/spawn`.

- [ ] **Step 3: Implement `spawnDetached`**

`src/commands/spawn.ts`:
```ts
import { spawn } from "node:child_process"

/** Starts a process that outlives this one: own process group, no stdio, never awaited. */
export function spawnDetached(command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" })
  // A failure to start is reported asynchronously; nobody is waiting for it.
  child.on("error", () => {})
  child.unref()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/commands/spawn.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `CliIo`**

In `src/commands/main.ts`, replace:
```ts
export interface CliIo {
  cwd: string
  stdout(text: string): void
  stderr(text: string): void
}
```
with:
```ts
export interface CliIo {
  cwd: string
  stdout(text: string): void
  stderr(text: string): void
  /** All of stdin. */
  readStdin(): Promise<string>
  /** Starts `rulecast warm --detector <kind>...` in root, detached. */
  startWarm(root: string, kinds: string[]): void
}
```

Replace `src/cli.ts` with:
```ts
#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers"

import { main } from "./commands/main"
import { spawnDetached } from "./commands/spawn"

const script = process.argv[1]!

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  startWarm: (root, kinds) =>
    spawnDetached(process.execPath, [script, "warm", ...kinds.flatMap((kind) => ["--detector", kind])], root),
})
```

- [ ] **Step 6: Add the CLI test helper and use it**

`test/helpers/cli.ts`:
```ts
import { type CliIo, main } from "../../src/commands/main"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
}

export function captureIo(cwd: string, stdin = ""): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [] }
  const io: CliIo = {
    cwd,
    stdout: (text) => {
      output.stdout += text
    },
    stderr: (text) => {
      output.stderr += text
    },
    readStdin: async () => stdin,
    startWarm: (root, kinds) => {
      output.warmed.push({ root, kinds })
    },
  }
  return { io, output }
}

export async function runCli(cwd: string, argv: string[], stdin = ""): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin)
  const code = await main(argv, io)
  return { code, ...output }
}
```

In `test/commands/main.test.ts`, replace the import `import { main } from "../../src/commands/main"` with `import { runCli } from "../helpers/cli"`, and replace the `run` function with:
```ts
async function run(cwd: string, ...argv: string[]) {
  const { code, stdout, stderr } = await runCli(cwd, argv)
  return { code, stdout, stderr }
}
```

- [ ] **Step 7: Run the tests to verify everything passes**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (including `test/build.test.ts`), no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/commands/spawn.ts src/commands/main.ts src/cli.ts test/helpers/cli.ts test/commands/spawn.test.ts test/commands/main.test.ts
git commit -m "feat: give commands stdin and detached warm-up

Claude goes brr.. via Dash"
```

---

### Task 9: Detector warm-up and `rulecast warm`

**Files:**
- Modify: `src/core/types.ts` (`Detector`), `src/commands/main.ts` (dispatch, usage)
- Create: `src/core/detection/warm.ts`, `src/commands/warm.ts`
- Test: `test/core/detection/warm.test.ts`, `test/commands/warm.test.ts`

- [ ] **Step 1: Write the failing core test**

`test/core/detection/warm.test.ts`:
```ts
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/compile"
import { createRegistry } from "../../../src/core/detection/registry"
import { warmableKinds, warmDetectors } from "../../../src/core/detection/warm"
import type { Detector, DetectorWarm } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { createProject } from "../../helpers/project"

const schema = z.object({ size: z.number() }).strict()
type Config = z.infer<typeof schema>

function warmy(calls: DetectorWarm<Config>[], fail: boolean): Detector<Config> {
  return {
    kind: "warmy",
    schema,
    captures: () => [],
    events: () => ["verify"],
    run: async () => ({ findings: [], errors: [] }),
    warm: async (input) => {
      calls.push(input)
      if (fail) throw new Error("model build failed")
    },
  }
}

async function setup(fail = false) {
  const calls: DetectorWarm<Config>[] = []
  const registry = createRegistry([...builtinDetectors, warmy(calls, fail)])
  const root = await createProject({
    ".rulecast/rules/warm.yml": "id: warm/a\nfiles: '**/*.ts'\ndetect: { warmy: { size: 2 } }\nmessage: m\n",
    ".rulecast/rules/plain.yml": "id: plain/b\nfiles: '**/*.ts'\ndetect: { regex: { pattern: x } }\nmessage: m\n",
  })
  const project = await compile(root, registry)
  expect(project.diagnostics).toEqual([])
  const warm = (kinds: string[] | null = null) => warmDetectors({ root, project, registry, kinds, timeoutMs: 5000 })
  return { root, project, registry, calls, warm }
}

describe("detector warm-up", () => {
  test("warmable kinds are the project's detector kinds that have warm-up work", async () => {
    const { project, registry } = await setup()
    expect(warmableKinds(project, registry)).toEqual(["warmy"])
  })

  test("warms each kind once with all of its rules", async () => {
    const { root, calls, warm } = await setup()
    expect(await warm()).toEqual({ warmed: ["warmy"], skipped: [], errors: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules).toEqual([{ id: "warm/a", config: { size: 2 } }])
    expect(calls[0]!.cwd).toBe(root)
  })

  test("only the requested kinds are warmed", async () => {
    const { calls, warm } = await setup()
    expect(await warm(["regex"])).toEqual({ warmed: [], skipped: [], errors: [] })
    expect(calls).toEqual([])
  })

  test("a kind already warming elsewhere is skipped", async () => {
    const { root, calls, warm } = await setup()
    await mkdir(path.join(root, ".rulecast/.state/warm/warmy/.lock"), { recursive: true })
    expect(await warm()).toEqual({ warmed: [], skipped: ["warmy"], errors: [] })
    expect(calls).toEqual([])
  })

  test("a failing warm-up is reported and releases its lock", async () => {
    const { root, warm } = await setup(true)
    expect(await warm()).toEqual({
      warmed: [],
      skipped: [],
      errors: [{ kind: "warmy", message: "model build failed" }],
    })
    expect(existsSync(path.join(root, ".rulecast/.state/warm/warmy/.lock"))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/detection/warm.test.ts`
Expected: FAIL: cannot find module `../../../src/core/detection/warm`.

- [ ] **Step 3: Add `warm` to the detector contract**

In `src/core/types.ts`, before `export interface Detector<Config>` add:
```ts
export interface DetectorWarm<Config> {
  /** Every rule of this detector kind in the project. */
  rules: { id: string; config: Config }[]
  cache: Cache
  cwd: string
  signal: AbortSignal
}
```
and inside `Detector<Config>`, after `run(...)`, add:
```ts
  /** Optional: build expensive caches ahead of events (rulecast warm, §13). */
  warm?(input: DetectorWarm<Config>): Promise<void>
```

- [ ] **Step 4: Implement the warm-up runner**

`src/core/detection/warm.ts`:
```ts
import path from "node:path"

import type { CompiledProject } from "../compile/compile"
import { errorMessage } from "../errors"
import { LockTimeoutError, withLock } from "../session/lock"
import { detectorCacheDir, diskCache } from "./cache"
import type { DetectorRegistry } from "./registry"

export interface WarmOptions {
  root: string
  project: CompiledProject
  registry: DetectorRegistry
  /** null = every kind with warm-up work. */
  kinds: readonly string[] | null
  timeoutMs: number
}

export interface WarmResult {
  warmed: string[]
  /** Another warm-up of the kind holds its lock. */
  skipped: string[]
  errors: { kind: string; message: string }[]
}

/** Never wait for another warm-up; a lock is abandoned only after a warm-up could have finished. */
const WARM_LOCK = { waitMs: 0, staleMs: 10 * 60_000, retryMs: 20 }

/** Detector kinds used by the project's rules whose detector has warm-up work. */
export function warmableKinds(project: CompiledProject, registry: DetectorRegistry): string[] {
  const kinds = new Set<string>()
  for (const rule of project.rules) {
    const kind = rule.detector?.kind
    if (kind !== undefined && registry.get(kind)?.warm !== undefined) kinds.add(kind)
  }
  return [...kinds]
}

export async function warmDetectors(options: WarmOptions): Promise<WarmResult> {
  const { root, project, registry } = options
  const result: WarmResult = { warmed: [], skipped: [], errors: [] }
  const kinds = warmableKinds(project, registry).filter((kind) => options.kinds?.includes(kind) ?? true)
  const signal = AbortSignal.timeout(options.timeoutMs)
  await Promise.all(
    kinds.map(async (kind) => {
      const detector = registry.get(kind)!
      const rules = project.rules
        .filter((rule) => rule.detector?.kind === kind)
        .map((rule) => ({ id: rule.id, config: rule.detector!.config }))
      try {
        await withLock(
          path.join(root, ".rulecast", ".state", "warm", kind),
          () => detector.warm!({ rules, cache: diskCache(detectorCacheDir(root, kind)), cwd: root, signal }),
          WARM_LOCK,
        )
        result.warmed.push(kind)
      } catch (error) {
        if (error instanceof LockTimeoutError) result.skipped.push(kind)
        else result.errors.push({ kind, message: errorMessage(error) })
      }
    }),
  )
  return result
}
```

- [ ] **Step 5: Run the core test to verify it passes**

Run: `pnpm vitest run test/core/detection/warm.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing command test**

`test/commands/warm.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"

describe("rulecast warm", () => {
  test("with no detector warm-up work there is nothing to warm", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["warm"])).toMatchObject({ code: 0, stdout: "rulecast: nothing to warm\n" })
  })

  test("outside a rulecast project it fails", async () => {
    const result = await runCli(await createProject({}), ["warm"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast directory")
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run test/commands/warm.test.ts`
Expected: FAIL: exit code 2 with `unknown command "warm"`.

- [ ] **Step 8: Implement the command**

`src/commands/warm.ts`:
```ts
import { parseArgs } from "node:util"

import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmDetectors } from "../core/detection/warm"
import { debugLogger, ensureStateDir } from "../core/state-dir"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/** Warm-ups run detached and nobody waits for them; this only bounds a stuck one. */
const WARM_TIMEOUT_MS = 5 * 60_000

export async function warmCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({ args, options: { detector: { type: "string", multiple: true } } })
  if (!hasProject(root)) throw new Error(`no .rulecast directory in ${root} or its parents (run rulecast init)`)
  ensureStateDir(root)
  const log = debugLogger(root)
  const result = await warmDetectors({
    root,
    project: await compile(root, registry),
    registry,
    kinds: values.detector ?? null,
    timeoutMs: WARM_TIMEOUT_MS,
  })
  if (result.warmed.length > 0) io.stdout(`rulecast: warmed ${result.warmed.join(", ")}\n`)
  if (result.skipped.length > 0) io.stdout(`rulecast: already warming ${result.skipped.join(", ")}\n`)
  for (const error of result.errors) {
    log(`warm ${error.kind} failed: ${error.message}`)
    io.stderr(`rulecast: warm ${error.kind} failed: ${error.message}\n`)
  }
  if (result.warmed.length + result.skipped.length + result.errors.length === 0) {
    io.stdout("rulecast: nothing to warm\n")
  }
  return result.errors.length > 0 ? 2 : 0
}
```

In `src/commands/main.ts`, add `import { warmCommand } from "./warm"`, replace `USAGE` with:
```ts
const USAGE = `usage:
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
  rulecast warm [--detector <kind>]...
`
```
and add a case after `case "validate": ...`:
```ts
      case "warm":
        return await warmCommand(root, args, registry, io)
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run test/commands test/core/detection && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/core/types.ts src/core/detection/warm.ts src/commands/warm.ts src/commands/main.ts test/core/detection/warm.test.ts test/commands/warm.test.ts
git commit -m "feat: add detector warm-up and rulecast warm

Claude goes brr.. via Dash"
```

---

### Task 10: `rulecast hook`

**Files:**
- Create: `src/commands/hook.ts`
- Modify: `src/commands/main.ts` (dispatch, usage)
- Test: `test/commands/hook.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/hook.test.ts`:
```ts
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { hookCommand } from "../../src/commands/hook"
import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { captureIo, runCli } from "../helpers/cli"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { claudeCodePayload } from "../helpers/payloads"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const additionalContext = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext

describe("rulecast hook claude-code", () => {
  test("a read delivers the conventions for the file", async () => {
    const root = await createFixture()
    const result = await hook(root, "post-tool-use.read.complete", USERS)
    expect(result.code).toBe(0)
    expect(additionalContext(result.stdout)).toContain("--- conventions/backend.md#services ---")
    expect(readFileSync(path.join(root, ".rulecast/.state/.gitignore"), "utf8")).toBe("*\n")
  })

  test("an edit reports the new violation and Stop blocks on it", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    await writeFile(path.join(root, USERS), VIOLATION)
    expect(additionalContext((await hook(root, "post-tool-use.edit", USERS)).stdout)).toContain(
      "raises HTTPException(500)",
    )
    const stop = JSON.parse((await hook(root, "stop")).stdout)
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain("raises HTTPException(500)")
  })

  test("the compaction summariser's SubagentStop is not verified", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), VIOLATION)
    await hook(root, "post-tool-use.edit", USERS)
    expect(await hook(root, "subagent-stop.compaction")).toMatchObject({ code: 0, stdout: "" })
  })

  test("outside a rulecast project the hook does nothing and creates no state", async () => {
    const root = await createProject({ [USERS]: VIOLATION })
    expect(await hook(root, "post-tool-use.edit", USERS)).toMatchObject({ code: 0, stdout: "", stderr: "" })
    expect(existsSync(path.join(root, ".rulecast"))).toBe(false)
  })

  test("files outside the project are ignored", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("post-tool-use.edit", { root, sessionId: "s1" })
    payload.tool_input = { file_path: "/elsewhere/app/services/users.py" }
    expect(await runCli(root, ["hook", "claude-code"], JSON.stringify(payload))).toMatchObject({ code: 0, stdout: "" })
  })

  test("bad input and unknown adapters fail open", async () => {
    const root = await createFixture()
    const garbage = await runCli(root, ["hook", "claude-code"], "not json")
    expect(garbage.code).toBe(0)
    expect(garbage.stderr).toContain("could not read hook input")
    const unknown = await runCli(root, ["hook", "cursor"], "{}")
    expect(unknown.code).toBe(0)
    expect(unknown.stderr).toContain('unknown hook adapter "cursor"')
  })
})

describe("rulecast hook warm-up", () => {
  const schema = z.object({}).strict()
  /** Never finishes a run, and has warm-up work. */
  const slow: Detector<z.infer<typeof schema>> = {
    kind: "slow",
    schema,
    captures: () => [],
    events: () => ["edit", "verify"],
    run: () => new Promise(() => {}),
    warm: async () => {},
  }
  const registry = createRegistry([...builtinDetectors, slow])
  const slowProject = () =>
    createRepo({
      ...fixtureFiles,
      ".rulecast/config.yml": "timeouts:\n  editDeadlineMs: 20\n",
      ".rulecast/rules/slow.yml": "id: slow/rule\nfiles: app/**/*.py\ndetect: { slow: {} }\nmessage: m\n",
    })

  async function run(root: string, name: string, withRegistry = registry, file?: string) {
    const { io, output } = captureIo(root, JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })))
    expect(await hookCommand(["claude-code"], withRegistry, io)).toBe(0)
    return output
  }

  test("session start warms detectors that have warm-up work", async () => {
    const root = await slowProject()
    expect((await run(root, "session-start.startup")).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("a detector that missed the edit deadline is warmed in the background", async () => {
    const root = await slowProject()
    expect((await run(root, "post-tool-use.edit", registry, USERS)).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("without warm-up work nothing is started", async () => {
    const root = await createFixture()
    expect((await run(root, "session-start.startup", createRegistry([...builtinDetectors]))).warmed).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/hook.test.ts`
Expected: FAIL: cannot find module `../../src/commands/hook`.

- [ ] **Step 3: Implement the command**

`src/commands/hook.ts`:
```ts
import { claudeCodeAdapter } from "../adapters/claude-code/adapter"
import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmableKinds } from "../core/detection/warm"
import { errorMessage } from "../core/errors"
import { runPipeline } from "../core/pipeline"
import { debugLogger, ensureStateDir } from "../core/state-dir"
import type { Adapter, Event } from "../core/types"
import type { CliIo } from "./main"
import { findRoot, hasProject, toProjectPath } from "./project"

const ADAPTERS: Readonly<Record<string, Adapter>> = { "claude-code": claudeCodeAdapter }

/** Hooks fail open (§14): every path exits 0; problems go to stderr and the debug log. */
export async function hookCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const name = args[0] ?? ""
  const adapter = ADAPTERS[name]
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${Object.keys(ADAPTERS).join(", ")})\n`)
    return 0
  }
  let input: unknown
  try {
    input = JSON.parse(await io.readStdin())
  } catch (error) {
    io.stderr(`rulecast: could not read hook input: ${errorMessage(error)}\n`)
    return 0
  }
  const parsed = adapter.parse(input)
  if (!parsed || (!parsed.event && !parsed.warmup)) return 0
  const root = findRoot(parsed.cwd)
  if (!hasProject(root)) return 0
  ensureStateDir(root)
  const log = debugLogger(root)
  try {
    if (parsed.warmup) {
      const kinds = warmableKinds(await compile(root, registry), registry)
      if (kinds.length > 0) io.startWarm(root, kinds)
    }
    if (parsed.event) await handleEvent({ root, cwd: parsed.cwd, event: parsed.event, adapter, registry, io, log })
  } catch (error) {
    log(`hook ${adapter.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
  }
  return 0
}

interface EventContext {
  root: string
  cwd: string
  event: Event
  adapter: Adapter
  registry: DetectorRegistry
  io: CliIo
  log: (line: string) => void
}

async function handleEvent({ root, cwd, event, adapter, registry, io, log }: EventContext): Promise<void> {
  const files = event.files
    .map((file) => toProjectPath(root, cwd, file))
    .filter((file): file is string => file !== null)
  if ((event.kind === "touch" || event.kind === "edit") && files.length === 0) return
  const projectEvent: Event = { ...event, files, cwd: root }
  const result = await runPipeline({
    root,
    event: projectEvent,
    registry,
    maxContextChars: adapter.maxContextChars,
    log,
  })
  const output = adapter.format(result.delivery, projectEvent, {
    maxMatchesPerRule: result.project.config.maxMatchesPerRule,
  })
  if (output.stdout !== "") io.stdout(output.stdout)
  const missed = result.deadlineMissed.filter((kind) => registry.get(kind)?.warm !== undefined)
  if (missed.length > 0) io.startWarm(root, missed)
}
```

In `src/commands/main.ts`, add `import { hookCommand } from "./hook"`, replace `USAGE` with:
```ts
const USAGE = `usage:
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
  rulecast hook <adapter>
  rulecast warm [--detector <kind>]...
`
```
and add a case after `case "validate": ...`:
```ts
      case "hook":
        return await hookCommand(args, registry, io)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/commands && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/hook.ts src/commands/main.ts test/commands/hook.test.ts
git commit -m "feat: add rulecast hook

Claude goes brr.. via Dash"
```

---

### Task 11: Merge rulecast's hooks into Claude Code settings

**Files:**
- Create: `src/adapters/claude-code/settings.ts`
- Test: `test/adapters/claude-code/settings.test.ts`

- [ ] **Step 1: Write the failing test**

`test/adapters/claude-code/settings.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { mergeHooks, SettingsError } from "../../../src/adapters/claude-code/settings"

const COMMAND = "rulecast hook claude-code"
const hook = (timeout: number) => ({ type: "command", command: COMMAND, timeout })

describe("Claude Code settings: mergeHooks", () => {
  test("installs every rulecast hook into empty settings", () => {
    expect(mergeHooks({}, COMMAND, 60_000)).toEqual({
      settings: {
        hooks: {
          PostToolUse: [
            { matcher: "Read", hooks: [hook(5)] },
            { matcher: "Edit|Write", hooks: [hook(5)] },
          ],
          Stop: [{ hooks: [hook(70)] }],
          SubagentStop: [{ hooks: [hook(70)] }],
          UserPromptSubmit: [{ hooks: [hook(5)] }],
          SessionStart: [{ matcher: "startup|resume|compact", hooks: [hook(5)] }],
        },
      },
      added: [
        "PostToolUse (Read)",
        "PostToolUse (Edit|Write)",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
      ],
    })
  })

  test("keeps existing settings and hooks exactly as they are, and does not mutate its input", () => {
    const existing = {
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: {
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "dash-hook post" }] }],
        Stop: [{ hooks: [{ type: "command", command: "dash-hook stop" }] }],
      },
    }
    const input = structuredClone(existing)
    const { settings } = mergeHooks(input, COMMAND, 20_000)
    expect(input).toEqual(existing)
    expect(settings.permissions).toEqual(existing.permissions)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(hooks.PostToolUse).toEqual([
      existing.hooks.PostToolUse[0],
      { matcher: "Read", hooks: [hook(5)] },
      { matcher: "Edit|Write", hooks: [hook(5)] },
    ])
    expect(hooks.Stop).toEqual([existing.hooks.Stop[0], { hooks: [hook(30)] }])
  })

  test("is idempotent, and any command running rulecast hook claude-code counts as installed", () => {
    const once = mergeHooks({}, COMMAND, 60_000).settings
    expect(mergeHooks(once, COMMAND, 60_000)).toEqual({ settings: once, added: [] })
    const local = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    expect(mergeHooks(once, local, 60_000).added).toEqual([])
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => mergeHooks(bad, COMMAND, 60_000)).toThrow(SettingsError)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/adapters/claude-code/settings.test.ts`
Expected: FAIL: cannot find module `../../../src/adapters/claude-code/settings`.

- [ ] **Step 3: Implement**

`src/adapters/claude-code/settings.ts`:
```ts
type JsonObject = Record<string, unknown>

export class SettingsError extends Error {}

const RULECAST_HOOK = /\brulecast\b.*\bhook claude-code\b/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The hook groups rulecast needs (spec §12). Timeouts are in seconds. */
function hookGroups(verifyMs: number): { event: string; matcher?: string; timeout: number }[] {
  const verifyTimeout = Math.ceil(verifyMs / 1000) + 10
  return [
    { event: "PostToolUse", matcher: "Read", timeout: 5 },
    { event: "PostToolUse", matcher: "Edit|Write", timeout: 5 },
    { event: "Stop", timeout: verifyTimeout },
    { event: "SubagentStop", timeout: verifyTimeout },
    { event: "UserPromptSubmit", timeout: 5 },
    { event: "SessionStart", matcher: "startup|resume|compact", timeout: 5 },
  ]
}

function installed(groups: unknown[], matcher: string | undefined): boolean {
  return groups.some(
    (group) =>
      isObject(group) &&
      group.matcher === matcher &&
      Array.isArray(group.hooks) &&
      group.hooks.some((hook) => isObject(hook) && typeof hook.command === "string" && RULECAST_HOOK.test(hook.command)),
  )
}

/** Adds rulecast's hooks to Claude Code settings. Existing entries are never modified or removed. */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
): { settings: JsonObject; added: string[] } {
  if (!isObject(settings)) throw new SettingsError("settings must be a JSON object")
  const hooks = settings.hooks ?? {}
  if (!isObject(hooks)) throw new SettingsError('"hooks" must be an object')
  const merged: JsonObject = { ...hooks }
  const added: string[] = []
  for (const { event, matcher, timeout } of hookGroups(verifyMs)) {
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (installed(groups, matcher)) continue
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(matcher === undefined ? event : `${event} (${matcher})`)
  }
  return { settings: { ...settings, hooks: merged }, added }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/adapters/claude-code/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude-code/settings.ts test/adapters/claude-code/settings.test.ts
git commit -m "feat: merge rulecast hooks into Claude Code settings

Claude goes brr.. via Dash"
```

---

### Task 12: `rulecast init`

**Files:**
- Create: `src/commands/init.ts`
- Modify: `src/commands/main.ts` (dispatch, usage)
- Test: `test/commands/init.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/init.test.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

describe("rulecast init", () => {
  test("scaffolds a valid project and installs the hooks", async () => {
    const root = await createProject({})
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("created  .rulecast/config.yml")
    expect(result.stdout).toContain("created  .rulecast/rules/example.yml")
    expect(result.stdout).toContain("created  conventions/example.md")
    expect(result.stdout).toContain("installed Claude Code hooks in .claude/settings.json")
    expect(await runCli(root, ["validate"])).toMatchObject({ code: 0, stdout: "rulecast: 1 rule valid\n" })
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
    ])
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "rulecast hook claude-code",
      timeout: 70,
    })
    expect(await read(root, ".rulecast/.state/.gitignore")).toBe("*\n")
  })

  test("keeps existing files and settings, and a second run changes nothing", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const root = await createProject({
      ".rulecast/config.yml": "timeouts:\n  verifyMs: 20000\n",
      ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [dash] }] } }),
    })
    const first = await runCli(root, ["init"])
    expect(first.stdout).toContain("exists   .rulecast/config.yml")
    expect(await read(root, ".rulecast/config.yml")).toBe("timeouts:\n  verifyMs: 20000\n")
    const installed = await read(root, ".claude/settings.json")
    expect(JSON.parse(installed).hooks.Stop).toEqual([
      { hooks: [dash] },
      { hooks: [{ type: "command", command: "rulecast hook claude-code", timeout: 30 }] },
    ])

    const second = await runCli(root, ["init"])
    expect(second.stdout).toContain("Claude Code hooks already installed in .claude/settings.json")
    expect(await read(root, ".claude/settings.json")).toBe(installed)
  })

  test("uses the project's own rulecast when it is installed", async () => {
    const root = await createProject({ "node_modules/.bin/rulecast": "" })
    await runCli(root, ["init"])
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
  })

  test("leaves unparseable settings alone", async () => {
    const root = await createProject({ ".claude/settings.json": "{ nope" })
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".claude/settings.json:")
    expect(await read(root, ".claude/settings.json")).toBe("{ nope")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/init.test.ts`
Expected: FAIL: exit code 2 with `unknown command "init"`.

- [ ] **Step 3: Implement the command**

`src/commands/init.ts`:
```ts
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { mergeHooks } from "../adapters/claude-code/settings"
import { loadConfig } from "../core/compile/config"
import { errorMessage, isNotFound } from "../core/errors"
import { ensureStateDir } from "../core/state-dir"
import type { CliIo } from "./main"

const SETTINGS = ".claude/settings.json"

const SCAFFOLD: Readonly<Record<string, string>> = {
  ".rulecast/config.yml": [
    "# rulecast project config. Every key is optional; these are the defaults.",
    "rules: .rulecast/rules/**/*.yml",
    "context:",
    "  mode: inject",
    "  maxBytes: 32768",
    "maxMatchesPerRule: 10",
    "timeouts:",
    "  editDeadlineMs: 350",
    "  verifyMs: 60000",
    "stopGate:",
    "  maxBlocks: 3",
    "",
  ].join("\n"),
  ".rulecast/rules/example.yml": [
    "# An example rule: copy it for your own conventions, then delete this file.",
    "id: example/no-console-log",
    'files: "src/**/*.{ts,tsx,js,jsx}"',
    "severity: warning",
    "detect:",
    "  regex: { pattern: 'console\\.log\\(' }",
    "message: '{{file}}:{{line}} calls console.log. Use the project logger instead.'",
    "context: ['@conventions/example.md#logging']",
    "",
  ].join("\n"),
  "conventions/example.md": [
    "# Example conventions",
    "",
    "Rules point at sections of documents like this one.",
    "",
    "## Logging",
    "",
    "Use the project logger instead of `console.log`, so log levels and structured fields stay consistent.",
    "",
  ].join("\n"),
}

export async function initCommand(root: string, io: CliIo): Promise<number> {
  for (const [file, content] of Object.entries(SCAFFOLD)) {
    const full = path.join(root, file)
    if (existsSync(full)) {
      io.stdout(`exists   ${file}\n`)
      continue
    }
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
    io.stdout(`created  ${file}\n`)
  }
  ensureStateDir(root)

  const config = await loadConfig(root)
  if (!config.ok) throw new Error(`${config.message} (fix it, then run rulecast init again)`)

  const settingsFile = path.join(root, SETTINGS)
  let current: unknown = {}
  try {
    current = JSON.parse(await readFile(settingsFile, "utf8"))
  } catch (error) {
    if (!isNotFound(error)) throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  const command = existsSync(path.join(root, "node_modules", ".bin", "rulecast"))
    ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    : "rulecast hook claude-code"
  let merged: ReturnType<typeof mergeHooks>
  try {
    merged = mergeHooks(current, command, config.config.timeouts.verifyMs)
  } catch (error) {
    throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  if (merged.added.length === 0) {
    io.stdout(`Claude Code hooks already installed in ${SETTINGS}\n`)
  } else {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, `${JSON.stringify(merged.settings, null, 2)}\n`)
    io.stdout(`installed Claude Code hooks in ${SETTINGS}: ${merged.added.join(", ")}\n`)
  }
  io.stdout("\nnext: write rules in .rulecast/rules, then run rulecast validate\n")
  return 0
}
```

In `src/commands/main.ts`, add `import { initCommand } from "./init"`, replace `USAGE` with:
```ts
const USAGE = `usage:
  rulecast init
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
  rulecast hook <adapter>
  rulecast warm [--detector <kind>]...
`
```
and add a case before `case "check": ...`:
```ts
      case "init":
        return await initCommand(root, io)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/commands && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts src/commands/main.ts test/commands/init.test.ts
git commit -m "feat: add rulecast init

Claude goes brr.. via Dash"
```

---

### Task 13: Built CLI, perf test and exports

**Files:**
- Modify: `test/build.test.ts`, `src/index.ts`, `test/smoke.test.ts`, `package.json` (`test:perf` script), `docs/plans/2026-09-15-rulecast-00-index.md`
- Create: `test/perf/edit-hook.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/smoke.test.ts`, add:
```ts
test("package entry exports the Claude Code adapter", () => {
  expect(rulecast.claudeCodeAdapter.name).toBe("claude-code")
})
```

In `test/build.test.ts`, add the imports:
```ts
import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"

import { claudeCodePayload } from "./helpers/payloads"
```
and the test:
```ts
test("built CLI answers a Claude Code edit hook", async () => {
  const root = await createFixture()
  await writeFile(
    path.join(root, "app/services/users.py"),
    "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n",
  )
  const payload = claudeCodePayload("post-tool-use.edit", { root, file: "app/services/users.py", sessionId: "s1" })
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain("raises HTTPException(500)")
}, 30_000)
```

- [ ] **Step 2: Run them to verify the smoke test fails**

Run: `pnpm vitest run test/smoke.test.ts test/build.test.ts`
Expected: FAIL in `package entry exports the Claude Code adapter` (`rulecast.claudeCodeAdapter` is undefined). The build test passes already: it checks the command built in Task 10 through the bundle.

- [ ] **Step 3: Export the adapter**

In `src/index.ts`, add:
```ts
export { claudeCodeAdapter } from "./adapters/claude-code/adapter"
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run test/smoke.test.ts test/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the perf test**

`test/perf/edit-hook.test.ts`:
```ts
import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { createRepo } from "../helpers/git"
import { claudeCodePayload } from "../helpers/payloads"

const cli = path.resolve("dist/cli.js")
const FILE = "src/feature/orders.ts"
const RULES = 25

/** 25 regex rules and 5 path rules. Plan 3 adds ast-grep, ruff and command rules (spec §13). */
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
```

In `package.json`, add to `scripts` after `"test"`:
```json
    "test:perf": "RULECAST_PERF=1 vitest run test/perf",
```

- [ ] **Step 6: Run the perf test**

Run: `pnpm test:perf`
Expected: PASS, printing `edit hook: p50 … ms, p95 … ms`. If p95 is 500 ms or more, stop and use the systematic-debugging skill: time process start (`node dist/cli.js help`), compile, and detection separately before changing anything.

Run: `pnpm test`
Expected: PASS, with the perf suite skipped.

- [ ] **Step 7: Mark plan 2 done**

In `docs/plans/2026-09-15-rulecast-00-index.md`, replace the plan 2 status cell ``Written, in two parts executed in order: `2026-09-16-rulecast-02a-adapter.md` (tasks 1–7), `02b-hook-init-warm.md` (tasks 8–13)`` with ``Done, in two parts executed in order: `2026-09-16-rulecast-02a-adapter.md` (tasks 1–7), `02b-hook-init-warm.md` (tasks 8–13)``. Add the measured p50 and p95 to the end of that cell, e.g. `; edit hook p95 212 ms on <machine>`.

- [ ] **Step 8: Commit and push**

```bash
git add src/index.ts test/smoke.test.ts test/build.test.ts test/perf/edit-hook.test.ts package.json docs/plans/2026-09-15-rulecast-00-index.md
git commit -m "test: add the built hook check and the edit hook perf test

Claude goes brr.. via Dash"
git push origin main
```

Plan 2 is done. Before plan 3, dogfood by hand: run `rulecast init` in a scratch project, start `claude` there, and confirm a Read, an Edit with a violation, and a blocked Stop behave as the tests describe.
