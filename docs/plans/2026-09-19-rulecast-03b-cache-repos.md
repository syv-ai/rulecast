# rulecast Plan 3b — Cache home, rule repo fetching and tags Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move everything rulecast stores out of the project into one cache directory, and add the rule repo plumbing that compile, `install`, `autoupdate` and `try-repo` build on: cache layout, fetching a repo at a rev, and listing a repo's tags.

**Architecture:** `core/home.ts` finds the cache home (`$RULECAST_HOME`, `$XDG_CACHE_HOME/rulecast`, `~/.cache/rulecast`) and a per-project state directory keyed by the project's real path. Sessions, detector caches, warm locks and the debug log move there; the pipeline, warm-up and session take that directory instead of computing `.rulecast/.state` from the root, and `CliIo` carries the environment so tests point `RULECAST_HOME` at a temp directory. `core/repos/` adds the repo cache layout (`repos/<slug>/<rev>/`), a shallow fetch into a temp directory that is renamed into place under a per-repo lock, and `git ls-remote --tags` with the latest version tag. Nothing here reads a config yet; plan 3c's compile does. Spec: `docs/specs/2026-09-15-rulecast-design.md` §4 (Rule repos, Fetching), §12 (Cache and state), §15 (Rule repos, Commands: cache home).

**Tech Stack:** Node ≥ 20, TypeScript 5, vitest, `git` (shallow fetch, `ls-remote`), `node:crypto`.

Prerequisite: `2026-09-19-rulecast-03a-monorepo-config.md` is done (the package lives in `packages/rulecast/`, `src/core/git.ts` exists, `src/core/version.ts` exists). Continue with `2026-09-19-rulecast-03c-compile.md` afterwards.

---

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME` (from Task 6 on).
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths are under `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/home.ts` | Cache home, per-project state directory, debug log (replaces `src/core/state-dir.ts`) |
| `src/core/session/session.ts` | `sessionDir(stateDir, id)` |
| `src/core/detection/cache.ts` | `detectorCacheDir(stateDir, kind)` |
| `src/core/detection/warm.ts` | `WarmOptions.stateDir`; warm lock under the state directory |
| `src/core/pipeline.ts` | `PipelineOptions.stateDir` |
| `src/commands/main.ts`, `src/cli.ts` | `CliIo.env` |
| `src/commands/{hook,warm,check,init}.ts` | State in the cache home; nothing written in the project |
| `src/core/repos/layout.ts` | Repo names, cache directories and labels |
| `src/core/repos/fetch.ts` | Shallow fetch of one rev; the cached, locked, atomic `ensureRepo` |
| `src/core/repos/tags.ts` | Remote tags and the latest version tag |
| `test/helpers/home.ts` | One temp `RULECAST_HOME` per test file |
| `test/helpers/cli.ts` | `captureIo`/`runCli` pass `testEnv` |
| `test/helpers/rule-repo.ts` | A local bare git repository with tagged versions, used as a rule repo URL |

## Not in this plan

- **Reading configs and manifests from fetched repos.** `RepoProvider` and compile come in plan 3c (Task 9); `install`, `autoupdate` and `try-repo` in plan 3d.
- **Relative repo paths in a config.** `fetchCheckout` runs git inside the temp directory, so a `repo:` value must be a URL or an absolute path. Tests always pass absolute paths.
- **Cache cleanup.** Leftover `.tmp-*` directories from a fetch killed mid-way are never read; `rulecast clean` (plan 3d, Task 16) removes them with the rest of the cache.

---

### Task 6: Keep state in the cache home

**Files:**
- Create: `src/core/home.ts`, `test/core/home.test.ts`, `test/helpers/home.ts`
- Modify: `src/core/session/session.ts` (`sessionDir`), `src/core/detection/cache.ts` (`detectorCacheDir`), `src/core/detection/warm.ts`, `src/core/pipeline.ts`, `src/commands/main.ts` (`CliIo`), `src/cli.ts`, `src/commands/hook.ts`, `src/commands/warm.ts`, `src/commands/check.ts`, `src/commands/init.ts`, `test/helpers/cli.ts`, `.gitignore` (repository root)
- Modify tests: `test/core/session/session.test.ts`, `test/core/detection/warm.test.ts`, `test/core/pipeline-cli.test.ts`, `test/core/pipeline-session.test.ts`, `test/core/pipeline-deadline.test.ts`, `test/commands/hook.test.ts`, `test/commands/init.test.ts`, `test/build.test.ts`, `test/perf/edit-hook.test.ts`
- Delete: `src/core/state-dir.ts`, `test/core/state-dir.test.ts`

The project is still found by its `.rulecast/` directory in this task; plan 3c switches `findRoot` to `.rulecast-config.yaml`.

- [ ] **Step 1: Write the failing test for the cache home**

`test/core/home.test.ts`:
```ts
import { mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { cacheHome, debugLogger, ensureProjectState, projectStateDir } from "../../src/core/home"
import { createProject } from "../helpers/project"

const tempDir = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix))

describe("cache home", () => {
  test("RULECAST_HOME wins, then XDG_CACHE_HOME, then ~/.cache", () => {
    expect(cacheHome({ RULECAST_HOME: "/r", XDG_CACHE_HOME: "/x" })).toBe("/r")
    expect(cacheHome({ XDG_CACHE_HOME: "/x" })).toBe("/x/rulecast")
    expect(cacheHome({})).toBe(path.join(homedir(), ".cache", "rulecast"))
  })

  test("empty values count as unset", () => {
    expect(cacheHome({ RULECAST_HOME: "", XDG_CACHE_HOME: "/x" })).toBe("/x/rulecast")
    expect(cacheHome({ RULECAST_HOME: "", XDG_CACHE_HOME: "" })).toBe(path.join(homedir(), ".cache", "rulecast"))
  })
})

describe("project state", () => {
  test("a project's directory is keyed by its real path", async () => {
    const root = await createProject({})
    const link = path.join(tempDir("rulecast-link-"), "project")
    symlinkSync(root, link)
    const dir = projectStateDir("/home", root)
    expect(dir).toMatch(/^\/home\/projects\/[0-9a-f]{16}$/)
    expect(projectStateDir("/home", link)).toBe(dir)
    expect(projectStateDir("/home", await createProject({}))).not.toBe(dir)
  })

  test("ensureProjectState creates the directory and records the project path once", async () => {
    const home = tempDir("rulecast-home-")
    const root = await createProject({})
    const dir = ensureProjectState(home, root)
    expect(dir).toBe(projectStateDir(home, root))
    expect(readFileSync(path.join(dir, "root"), "utf8")).toBe(`${realpathSync(root)}\n`)

    writeFileSync(path.join(dir, "root"), "custom\n")
    expect(ensureProjectState(home, root)).toBe(dir)
    expect(readFileSync(path.join(dir, "root"), "utf8")).toBe("custom\n")
  })

  test("nothing is written inside the project", async () => {
    const root = await createProject({})
    ensureProjectState(tempDir("rulecast-home-"), root)
    expect(readdirSync(root)).toEqual([])
  })
})

describe("debug log", () => {
  test("appends timestamped lines to the state directory's debug.log", async () => {
    const dir = ensureProjectState(tempDir("rulecast-home-"), await createProject({}))
    const log = debugLogger(dir, () => new Date("2026-09-16T12:00:00.000Z"))
    log("first")
    log("second")
    expect(readFileSync(path.join(dir, "debug.log"), "utf8")).toBe(
      "2026-09-16T12:00:00.000Z first\n2026-09-16T12:00:00.000Z second\n",
    )
  })

  test("never throws", () => {
    expect(() => debugLogger("/nonexistent/rulecast-state")("line")).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/home.test.ts`
Expected: FAIL: cannot find module `../../src/core/home`.

- [ ] **Step 3: Implement `src/core/home.ts`**

```ts
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export type Env = Readonly<Record<string, string | undefined>>

/** $RULECAST_HOME, else $XDG_CACHE_HOME/rulecast, else ~/.cache/rulecast. Empty values count as unset. */
export function cacheHome(env: Env): string {
  if (env.RULECAST_HOME) return path.resolve(env.RULECAST_HOME)
  if (env.XDG_CACHE_HOME) return path.join(path.resolve(env.XDG_CACHE_HOME), "rulecast")
  return path.join(homedir(), ".cache", "rulecast")
}

/**
 * <home>/projects/<first 16 hex of sha256(realpath(root))>. Keyed by the real path, so separate checkouts and
 * worktrees of one repository get separate directories and a symlinked path shares its target's.
 */
export function projectStateDir(home: string, root: string): string {
  const hash = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16)
  return path.join(home, "projects", hash)
}

/** Creates the project's state directory and its "root" file (the project path, for doctor and clean). */
export function ensureProjectState(home: string, root: string): string {
  const dir = projectStateDir(home, root)
  const file = path.join(dir, "root")
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `${realpathSync(root)}\n`)
  }
  return dir
}

/** Appends timestamped lines to <stateDir>/debug.log. Best effort: never throws. */
export function debugLogger(stateDir: string, now: () => Date = () => new Date()): (line: string) => void {
  const file = path.join(stateDir, "debug.log")
  return (line) => {
    try {
      appendFileSync(file, `${now().toISOString()} ${line}\n`)
    } catch {
      // A hook must not fail because its log could not be written.
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/home.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the test helper for a per-file cache home**

`test/helpers/home.ts`:
```ts
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { type Env, projectStateDir } from "../../src/core/home"

/** One cache home per test file (vitest isolates modules per file), so tests never touch ~/.cache/rulecast. */
export const TEST_HOME: string = mkdtempSync(path.join(tmpdir(), "rulecast-home-"))

export const testEnv: Env = { RULECAST_HOME: TEST_HOME }

/** The state directory rulecast uses for a test project. */
export function stateDirFor(root: string): string {
  return projectStateDir(TEST_HOME, root)
}
```

- [ ] **Step 6: Write the failing tests for state outside the project**

In `test/core/session/session.test.ts`, replace:
```ts
  test("session directories sanitise ids", async () => {
    expect(sessionDir("/repo", "abc-123_x.y")).toBe("/repo/.rulecast/.state/sessions/abc-123_x.y")
    expect(sessionDir("/repo", "../evil/id")).toBe("/repo/.rulecast/.state/sessions/.._evil_id")
  })

  test.each([".", "..", ""])("session id %j stays inside the sessions directory", (id) => {
    const sessions = "/repo/.rulecast/.state/sessions"
    expect(path.dirname(sessionDir("/repo", id))).toBe(sessions)
  })
```
with:
```ts
  test("session directories live in the state directory and sanitise ids", async () => {
    expect(sessionDir("/state", "abc-123_x.y")).toBe("/state/sessions/abc-123_x.y")
    expect(sessionDir("/state", "../evil/id")).toBe("/state/sessions/.._evil_id")
  })

  test.each([".", "..", ""])("session id %j stays inside the sessions directory", (id) => {
    expect(path.dirname(sessionDir("/state", id))).toBe("/state/sessions")
  })
```

In `test/commands/hook.test.ts`:

Replace the import line:
```ts
import { existsSync, readFileSync } from "node:fs"
```
with:
```ts
import { existsSync, readFileSync, realpathSync } from "node:fs"
```

After the line `import { createRepo } from "../helpers/git"`, add:
```ts
import { stateDirFor } from "../helpers/home"
```

Replace:
```ts
    expect(additionalContext(result.stdout)).toContain("--- conventions/backend.md#services ---")
    expect(readFileSync(path.join(root, ".rulecast/.state/.gitignore"), "utf8")).toBe("*\n")
  })
```
with:
```ts
    expect(additionalContext(result.stdout)).toContain("--- conventions/backend.md#services ---")
  })

  test("session state lives in the cache home, not in the project", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    const state = stateDirFor(root)
    expect(readFileSync(path.join(state, "root"), "utf8")).toBe(`${realpathSync(root)}\n`)
    expect(existsSync(path.join(state, "sessions", "s1", "baseline.jsonl"))).toBe(true)
    expect(existsSync(path.join(root, ".rulecast", ".state"))).toBe(false)
  })
```

Replace:
```ts
    expect(await hook(root, "post-tool-use.edit", USERS)).toMatchObject({ code: 0, stdout: "", stderr: "" })
    expect(existsSync(path.join(root, ".rulecast"))).toBe(false)
```
with:
```ts
    expect(await hook(root, "post-tool-use.edit", USERS)).toMatchObject({ code: 0, stdout: "", stderr: "" })
    expect(existsSync(path.join(root, ".rulecast"))).toBe(false)
    expect(existsSync(stateDirFor(root))).toBe(false)
```

In `test/commands/init.test.ts`:

Replace:
```ts
import { readFile } from "node:fs/promises"
```
with:
```ts
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
```

Replace:
```ts
    expect(await read(root, ".rulecast/.state/.gitignore")).toBe("*\n")
```
with:
```ts
    expect(existsSync(path.join(root, ".rulecast", ".state"))).toBe(false)
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm vitest run test/core/session/session.test.ts test/commands/hook.test.ts test/commands/init.test.ts`
Expected: FAIL: the session directory is still `/state/.rulecast/.state/sessions/…`; the hook test finds no `root` file in the cache home (`ENOENT`) and `.rulecast/.state` exists in the project; init still creates `.rulecast/.state`.

- [ ] **Step 8: Take the state directory in the core**

In `src/core/session/session.ts`, replace:
```ts
export function sessionDir(root: string, sessionId: string): string {
  return path.join(root, ".rulecast", ".state", "sessions", safeSegment(sessionId))
}
```
with:
```ts
export function sessionDir(stateDir: string, sessionId: string): string {
  return path.join(stateDir, "sessions", safeSegment(sessionId))
}
```

In `src/core/detection/cache.ts`, replace:
```ts
/** Cache directory for a detector kind inside a project. */
export function detectorCacheDir(root: string, kind: string): string {
  return path.join(root, ".rulecast", ".state", "cache", kind)
}
```
with:
```ts
/** Cache directory for a detector kind in a project's state directory. */
export function detectorCacheDir(stateDir: string, kind: string): string {
  return path.join(stateDir, "cache", kind)
}
```

In `src/core/detection/warm.ts`, replace:
```ts
export interface WarmOptions {
  root: string
  project: CompiledProject
```
with:
```ts
export interface WarmOptions {
  root: string
  /** The project's state directory (core/home.ts): detector caches and warm locks. */
  stateDir: string
  project: CompiledProject
```

Replace:
```ts
  const { root, project, registry } = options
```
with:
```ts
  const { root, stateDir, project, registry } = options
```

Replace:
```ts
        await withLock(
          path.join(root, ".rulecast", ".state", "warm", kind),
          () => detector.warm!({ rules, cache: diskCache(detectorCacheDir(root, kind)), cwd: root, signal }),
          WARM_LOCK,
        )
```
with:
```ts
        await withLock(
          path.join(stateDir, "warm", kind),
          () => detector.warm!({ rules, cache: diskCache(detectorCacheDir(stateDir, kind)), cwd: root, signal }),
          WARM_LOCK,
        )
```

In `src/core/pipeline.ts`, replace:
```ts
export interface PipelineOptions {
  root: string
  event: Event
```
with:
```ts
export interface PipelineOptions {
  root: string
  /** The project's state directory (core/home.ts): sessions and detector caches. */
  stateDir: string
  event: Event
```

Replace:
```ts
    ? { dir: sessionDir(root, event.session.id), agent: event.session.agentId ?? "main" }
```
with:
```ts
    ? { dir: sessionDir(options.stateDir, event.session.id), agent: event.session.agentId ?? "main" }
```

Replace:
```ts
      cacheFor: (kind) => diskCache(detectorCacheDir(root, kind)),
```
with:
```ts
      cacheFor: (kind) => diskCache(detectorCacheDir(options.stateDir, kind)),
```

- [ ] **Step 9: Pass the environment through the CLI and use the cache home in commands**

In `src/commands/main.ts`, after the line `import { errorMessage } from "../core/errors"`, add:
```ts
import type { Env } from "../core/home"
```

Replace:
```ts
export interface CliIo {
  cwd: string
```
with:
```ts
export interface CliIo {
  cwd: string
  /** Environment variables; the cache home comes from RULECAST_HOME or XDG_CACHE_HOME (core/home.ts). */
  env: Env
```

In `src/cli.ts`, replace:
```ts
  cwd: process.cwd(),
```
with:
```ts
  cwd: process.cwd(),
  env: process.env,
```

In `src/commands/hook.ts`, replace:
```ts
import { debugLogger, ensureStateDir } from "../core/state-dir"
```
with:
```ts
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
```

Replace:
```ts
  ensureStateDir(root)
  const log = debugLogger(root)
```
with:
```ts
  const stateDir = ensureProjectState(cacheHome(io.env), root)
  const log = debugLogger(stateDir)
```

Replace:
```ts
    if (parsed.event) await handleEvent({ root, cwd: parsed.cwd, event: parsed.event, adapter, registry, io, log })
```
with:
```ts
    if (parsed.event) {
      await handleEvent({ root, stateDir, cwd: parsed.cwd, event: parsed.event, adapter, registry, io, log })
    }
```

Replace:
```ts
interface EventContext {
  root: string
  cwd: string
```
with:
```ts
interface EventContext {
  root: string
  stateDir: string
  cwd: string
```

Replace:
```ts
async function handleEvent({ root, cwd, event, adapter, registry, io, log }: EventContext): Promise<void> {
```
with:
```ts
async function handleEvent({ root, stateDir, cwd, event, adapter, registry, io, log }: EventContext): Promise<void> {
```

Replace:
```ts
  const result = await runPipeline({
    root,
    event: projectEvent,
```
with:
```ts
  const result = await runPipeline({
    root,
    stateDir,
    event: projectEvent,
```

Replace the whole of `src/commands/warm.ts` with:
```ts
import { parseArgs } from "node:util"

import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmDetectors } from "../core/detection/warm"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
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
  const stateDir = ensureProjectState(cacheHome(io.env), root)
  const log = debugLogger(stateDir)
  const result = await warmDetectors({
    root,
    stateDir,
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

In `src/commands/check.ts`, after the line `import type { DetectorRegistry } from "../core/detection/registry"`, add:
```ts
import { cacheHome, ensureProjectState } from "../core/home"
```

Replace:
```ts
        ignore: ["**/node_modules/**", "**/.git/**", ".rulecast/.state/**"],
```
with:
```ts
        ignore: ["**/node_modules/**", "**/.git/**"],
```

Replace:
```ts
  const result = await runPipeline({
    root,
    event: {
```
with:
```ts
  const result = await runPipeline({
    root,
    stateDir: ensureProjectState(cacheHome(io.env), root),
    event: {
```

In `src/commands/init.ts`, delete the line:
```ts
import { ensureStateDir } from "../core/state-dir"
```
and the line (inside `initCommand`, after the scaffold loop):
```ts
  ensureStateDir(root)
```

Replace the whole of `test/helpers/cli.ts` with:
```ts
import { type CliIo, main } from "../../src/commands/main"
import type { Env } from "../../src/core/home"
import { testEnv } from "./home"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
}

/** In-process CLI I/O. The environment defaults to this test file's own RULECAST_HOME. */
export function captureIo(cwd: string, stdin = "", env: Env = testEnv): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [] }
  const io: CliIo = {
    cwd,
    env,
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

export async function runCli(
  cwd: string,
  argv: string[],
  stdin = "",
  env: Env = testEnv,
): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin, env)
  const code = await main(argv, io)
  return { code, ...output }
}
```

- [ ] **Step 10: Point the remaining tests at the test cache home**

In `test/core/pipeline-cli.test.ts` and `test/core/pipeline-session.test.ts`, add after the last helper import (`import { git } from "../helpers/git"` and `import { createFixture, registry } from "../helpers/fixture"` respectively):
```ts
import { stateDirFor } from "../helpers/home"
```
In every `runPipeline({` call in both files (four in `pipeline-cli.test.ts`, one in `pipeline-session.test.ts`), replace the first property line:
```ts
      root,
```
with:
```ts
      root,
      stateDir: stateDirFor(root),
```

In `test/core/pipeline-deadline.test.ts`, after `import { createRepo } from "../helpers/git"`, add:
```ts
import { stateDirFor } from "../helpers/home"
```
and replace:
```ts
  const result = await runPipeline({
    root,
    event: { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
```
with:
```ts
  const result = await runPipeline({
    root,
    stateDir: stateDirFor(root),
    event: { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
```

In `test/core/detection/warm.test.ts`, after `import { createProject } from "../../helpers/project"`, add:
```ts
import { stateDirFor } from "../../helpers/home"
```

Replace:
```ts
  const warm = (kinds: string[] | null = null) => warmDetectors({ root, project, registry, kinds, timeoutMs: 5000 })
```
with:
```ts
  const warm = (kinds: string[] | null = null) =>
    warmDetectors({ root, stateDir: stateDirFor(root), project, registry, kinds, timeoutMs: 5000 })
```

Replace:
```ts
    await mkdir(path.join(root, ".rulecast/.state/warm/warmy/.lock"), { recursive: true })
```
with:
```ts
    await mkdir(path.join(stateDirFor(root), "warm/warmy/.lock"), { recursive: true })
```

Replace:
```ts
    expect(existsSync(path.join(root, ".rulecast/.state/warm/warmy/.lock"))).toBe(false)
```
with:
```ts
    expect(existsSync(path.join(stateDirFor(root), "warm/warmy/.lock"))).toBe(false)
```

In `test/build.test.ts`, after `import { claudeCodePayload } from "./helpers/payloads"`, add:
```ts
import { TEST_HOME } from "./helpers/home"
```
and after the line `const cli = path.resolve("dist/cli.js")`, add:
```ts
/** The built CLI reads RULECAST_HOME from its environment; keep it out of the real cache. */
const env = { ...process.env, RULECAST_HOME: TEST_HOME }
```

Replace:
```ts
  const failure = await exec("node", [cli, "check", "--format", "agent"], { cwd: root }).catch((error) => error)
```
with:
```ts
  const failure = await exec("node", [cli, "check", "--format", "agent"], { cwd: root, env }).catch((error) => error)
```

Replace:
```ts
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
```
with:
```ts
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
```

In `test/perf/edit-hook.test.ts`, after `import { claudeCodePayload } from "../helpers/payloads"`, add:
```ts
import { TEST_HOME } from "../helpers/home"
```
and replace:
```ts
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    input: JSON.stringify(payload),
```
with:
```ts
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env: { ...process.env, RULECAST_HOME: TEST_HOME },
    input: JSON.stringify(payload),
```

- [ ] **Step 11: Delete the in-project state directory**

```bash
git rm packages/rulecast/src/core/state-dir.ts packages/rulecast/test/core/state-dir.test.ts
```

In the repository root `.gitignore`, delete the line:
```
.rulecast/.state/
```

- [ ] **Step 12: Run everything**

Run: `pnpm vitest run test/core/home.test.ts test/core/session/session.test.ts test/commands/hook.test.ts test/commands/init.test.ts test/core/detection/warm.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS (the build test runs the built CLI with `RULECAST_HOME` set; the perf suite is skipped).

Run: `pnpm typecheck`
Expected: no errors. A leftover `ensureStateDir` or `stateDir(` import from `core/state-dir` is the likely cause of an error; `grep -rn "state-dir\|\.rulecast/\.state" packages/rulecast/src packages/rulecast/test` must print nothing (`dist/` may still hold an older build).

- [ ] **Step 13: Commit**

```bash
git add .gitignore packages/rulecast/src/core/home.ts packages/rulecast/src/core/session/session.ts packages/rulecast/src/core/detection/cache.ts packages/rulecast/src/core/detection/warm.ts packages/rulecast/src/core/pipeline.ts packages/rulecast/src/commands/main.ts packages/rulecast/src/cli.ts packages/rulecast/src/commands/hook.ts packages/rulecast/src/commands/warm.ts packages/rulecast/src/commands/check.ts packages/rulecast/src/commands/init.ts packages/rulecast/test/core/home.test.ts packages/rulecast/test/helpers/home.ts packages/rulecast/test/helpers/cli.ts packages/rulecast/test/core/session/session.test.ts packages/rulecast/test/core/detection/warm.test.ts packages/rulecast/test/core/pipeline-cli.test.ts packages/rulecast/test/core/pipeline-session.test.ts packages/rulecast/test/core/pipeline-deadline.test.ts packages/rulecast/test/commands/hook.test.ts packages/rulecast/test/commands/init.test.ts packages/rulecast/test/build.test.ts packages/rulecast/test/perf/edit-hook.test.ts
git commit -m "refactor: keep rulecast's state in the user cache instead of the project

Claude goes brr.. via Dash"
```

(`git rm` in Step 11 already staged the deletions.)

---

### Task 7: Rule repo cache layout and fetching

**Files:**
- Create: `src/core/repos/layout.ts`, `src/core/repos/fetch.ts`, `test/helpers/rule-repo.ts`
- Test: `test/core/repos/layout.test.ts`, `test/core/repos/fetch.test.ts`

`fetch.ts` runs git through `git(cwd, args, env)` from `src/core/git.ts` (plan 3a, Task 3). It resolves to `{ ok: true, stdout }` or `{ ok: false, stderr }`, merges `env` over `process.env`, and throws only when git itself is missing. `GIT_TERMINAL_PROMPT=0` makes a private repo without credentials fail instead of waiting for a password that no hook can type.

Checked in a scratch experiment against a local bare repository: `git init -q`, `git fetch -q --depth 1 <path or file:// URL> <rev>` and `git -c advice.detachedHead=false checkout -q FETCH_HEAD` work for lightweight tags, annotated tags, full commit SHAs, branch names and `HEAD`. A short SHA fails with `fatal: couldn't find remote ref <sha>`, and so does a rev that doesn't exist.

- [ ] **Step 1: Write the failing layout test**

`test/core/repos/layout.test.ts`:
```ts
import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoDir, repoLabel, repoName } from "../../../src/core/repos/layout"

describe("repo names", () => {
  test.each([
    ["https://github.com/syv-ai/rulecast", "syv-ai/rulecast"],
    ["https://github.com/syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["https://github.com/syv-ai/rulecast/", "syv-ai/rulecast"],
    ["git@github.com:syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["ssh://git@github.com/syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["https://gitlab.com/group/sub/rules", "group/sub/rules"],
    ["/tmp/x/rules.git", "rules"],
    ["/tmp/x/rules/", "rules"],
    ["file:///tmp/x/rules.git", "rules"],
  ])("%s is %s", (url, name) => {
    expect(repoName(url)).toBe(name)
  })

  test("labels combine the name and the rev", () => {
    expect(repoLabel("https://github.com/syv-ai/rulecast", "v0.2.0")).toBe("syv-ai/rulecast@v0.2.0")
  })
})

describe("repo directories", () => {
  test("hosted repos are keyed by host, owner and repo", () => {
    expect(repoDir("/home", "https://github.com/syv-ai/rulecast", "v0.2.0")).toBe(
      path.join("/home", "repos", "github.com_syv-ai_rulecast", "v0.2.0"),
    )
    expect(repoDir("/home", "git@github.com:syv-ai/rulecast.git", "v0.2.0")).toBe(
      path.join("/home", "repos", "github.com_syv-ai_rulecast", "v0.2.0"),
    )
  })

  test("local repos are keyed by name and a hash of the URL", () => {
    const dir = repoDir("/home", "/tmp/x/rules.git", "v1")
    expect(dir).toMatch(/^\/home\/repos\/local_rules_[0-9a-f]{8}\/v1$/)
    expect(repoDir("/home", "/tmp/y/rules.git", "v1")).not.toBe(dir)
  })

  test("unsafe characters in revs and names become underscores", () => {
    expect(path.basename(repoDir("/home", "https://github.com/a/b", "release/1.0"))).toBe("release_1.0")
    expect(path.basename(repoDir("/home", "https://github.com/a/b", ".."))).toBe("_..")
    expect(path.basename(path.dirname(repoDir("/home", "https://example.com/a b/c", "v1")))).toBe("example.com_a_b_c")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/repos/layout.test.ts`
Expected: FAIL: cannot find module `../../../src/core/repos/layout`.

- [ ] **Step 3: Implement `src/core/repos/layout.ts`**

```ts
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** git@github.com:owner/repo.git */
const SCP_LIKE = /^[^@/\s]+@([^:/\s]+):(.+)$/

type ParsedUrl = { kind: "hosted"; host: string; segments: string[] } | { kind: "local"; name: string }

function segmentsOf(repoPath: string): string[] {
  return repoPath
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
}

function localName(file: string): string {
  return path.basename(file.replace(/[\\/]+$/, "")).replace(/\.git$/, "")
}

function parseUrl(url: string): ParsedUrl {
  if (SCHEME.test(url)) {
    const parsed = new URL(url)
    if (parsed.protocol === "file:") return { kind: "local", name: localName(fileURLToPath(parsed)) }
    return { kind: "hosted", host: parsed.hostname, segments: segmentsOf(decodeURIComponent(parsed.pathname)) }
  }
  const scp = url.match(SCP_LIKE)
  if (scp) return { kind: "hosted", host: scp[1]!, segments: segmentsOf(scp[2]!) }
  return { kind: "local", name: localName(url) }
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_")
  // "", "." and ".." would resolve to the parent directory or the directory itself.
  return /^\.*$/.test(segment) ? `_${segment}` : segment
}

/** "syv-ai/rulecast" for hosted URLs; the directory name without ".git" for local paths and file:// URLs. */
export function repoName(url: string): string {
  const parsed = parseUrl(url)
  return parsed.kind === "hosted" ? parsed.segments.join("/") || parsed.host : parsed.name
}

function repoSlug(url: string): string {
  const parsed = parseUrl(url)
  if (parsed.kind === "hosted") return safeSegment([parsed.host, ...parsed.segments].join("_"))
  // Two local repos can share a directory name; the hash keeps them apart.
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 8)
  return safeSegment(`local_${parsed.name}_${hash}`)
}

/** <home>/repos/<slug>/<rev> */
export function repoDir(home: string, url: string, rev: string): string {
  return path.join(home, "repos", repoSlug(url), safeSegment(rev))
}

/** "<repoName(url)>@<rev>": how references from the repo are labelled. */
export function repoLabel(url: string, rev: string): string {
  return `${repoName(url)}@${rev}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/repos/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the rule repo test helper**

`test/helpers/rule-repo.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { git } from "./git"
import { createProject } from "./project"

export interface RuleRepoVersion {
  tag: string
  /** Written on top of the previous version's files. */
  files: Record<string, string>
  /** An annotated tag instead of a lightweight one. */
  annotated?: boolean
}

/** A bare git repository with one commit per version, each tagged. Returns its path (usable as a repo URL). */
export async function createRuleRepo(versions: RuleRepoVersion[]): Promise<string> {
  const work = await createProject({})
  await git(work, "init", "-q", "-b", "main")
  for (const { tag, files, annotated } of versions) {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(work, file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
    }
    await git(work, "add", "-A")
    await git(work, "commit", "-q", "--allow-empty", "-m", tag)
    if (annotated) await git(work, "tag", "-a", tag, "-m", tag)
    else await git(work, "tag", tag)
  }
  const bare = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-rules-")), "rules.git")
  await git(path.dirname(bare), "clone", "-q", "--bare", work, bare)
  return bare
}
```

- [ ] **Step 6: Write the failing fetch test**

`test/core/repos/fetch.test.ts`:
```ts
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { cachedRepo, ensureRepo, fetchCheckout, RepoFetchError } from "../../../src/core/repos/fetch"
import { repoDir } from "../../../src/core/repos/layout"
import { git } from "../../helpers/git"
import { createRuleRepo } from "../../helpers/rule-repo"

const newHome = () => mkdtemp(path.join(tmpdir(), "rulecast-home-"))

const versions = () =>
  createRuleRepo([
    { tag: "v0.1.0", files: { ".rulecast-rules.yaml": "- version: one\n", "docs/a.md": "# One\n" } },
    { tag: "v0.2.0", files: { ".rulecast-rules.yaml": "- version: two\n" }, annotated: true },
  ])

const manifest = (dir: string) => readFile(path.join(dir, ".rulecast-rules.yaml"), "utf8")

describe("fetchCheckout", () => {
  test("checks out a tag without its .git directory", async () => {
    const url = await versions()
    const into = path.join(await newHome(), "checkout")
    await fetchCheckout(url, "v0.1.0", into)
    expect(await manifest(into)).toBe("- version: one\n")
    expect(await readFile(path.join(into, "docs/a.md"), "utf8")).toBe("# One\n")
    expect(existsSync(path.join(into, ".git"))).toBe(false)
  })

  test("checks out annotated tags, full commit SHAs and HEAD", async () => {
    const url = await versions()
    const home = await newHome()
    await fetchCheckout(url, "v0.2.0", path.join(home, "annotated"))
    expect(await manifest(path.join(home, "annotated"))).toBe("- version: two\n")

    const sha = await git(url, "rev-parse", "v0.1.0^{commit}")
    await fetchCheckout(url, sha, path.join(home, "sha"))
    expect(await manifest(path.join(home, "sha"))).toBe("- version: one\n")

    await fetchCheckout(url, "HEAD", path.join(home, "head"))
    expect(await manifest(path.join(home, "head"))).toBe("- version: two\n")
  })

  test("an unknown rev fails with git's message", async () => {
    const url = await versions()
    const into = path.join(await newHome(), "checkout")
    const failure = fetchCheckout(url, "v9.9.9", into)
    await expect(failure).rejects.toBeInstanceOf(RepoFetchError)
    await expect(failure).rejects.toThrow("couldn't find remote ref v9.9.9")
  })
})

describe("ensureRepo", () => {
  test("fetches a rev into the cache once", async () => {
    const url = await versions()
    const home = await newHome()
    expect(cachedRepo(home, url, "v0.1.0")).toBeNull()

    const dir = await ensureRepo(home, url, "v0.1.0")
    expect(dir).toBe(repoDir(home, url, "v0.1.0"))
    expect(cachedRepo(home, url, "v0.1.0")).toBe(dir)
    expect(await manifest(dir)).toBe("- version: one\n")

    // A cached rev is never fetched again: it still resolves after the remote is gone.
    await rm(url, { recursive: true, force: true })
    expect(await ensureRepo(home, url, "v0.1.0")).toBe(dir)
  })

  test("each rev gets its own directory", async () => {
    const url = await versions()
    const home = await newHome()
    const one = await ensureRepo(home, url, "v0.1.0")
    const two = await ensureRepo(home, url, "v0.2.0")
    expect(one).not.toBe(two)
    expect(await manifest(one)).toBe("- version: one\n")
    expect(await manifest(two)).toBe("- version: two\n")
  })

  test("concurrent fetches of one rev share a single checkout and leave no temp files", async () => {
    const url = await versions()
    const home = await newHome()
    const dirs = await Promise.all([1, 2, 3].map(() => ensureRepo(home, url, "v0.2.0")))
    expect(new Set(dirs)).toEqual(new Set([repoDir(home, url, "v0.2.0")]))
    expect(await readdir(path.dirname(dirs[0]!))).toEqual(["v0.2.0"])
    expect(await manifest(dirs[0]!)).toBe("- version: two\n")
  })

  test("a failed fetch leaves nothing in the cache", async () => {
    const url = await versions()
    const home = await newHome()
    await expect(ensureRepo(home, url, "v9.9.9")).rejects.toBeInstanceOf(RepoFetchError)
    expect(cachedRepo(home, url, "v9.9.9")).toBeNull()
    expect(await readdir(path.dirname(repoDir(home, url, "v9.9.9")))).toEqual([])
  })

  test("a temp directory left by a killed fetch is never read", async () => {
    const url = await versions()
    const home = await newHome()
    const parent = path.dirname(repoDir(home, url, "v0.1.0"))
    await mkdir(path.join(parent, ".tmp-crashed"), { recursive: true })
    await writeFile(path.join(parent, ".tmp-crashed", ".rulecast-rules.yaml"), "- partial\n")
    expect(await manifest(await ensureRepo(home, url, "v0.1.0"))).toBe("- version: one\n")
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run test/core/repos/fetch.test.ts`
Expected: FAIL: cannot find module `../../../src/core/repos/fetch`.

- [ ] **Step 8: Implement `src/core/repos/fetch.ts`**

```ts
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

import { git } from "../git"
import { withLock } from "../session/lock"
import { repoDir } from "./layout"

export class RepoFetchError extends Error {}

/** No hook can type a password: a repo that needs credentials must fail, not wait. */
export const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" }

/** Another process may be fetching a big repo; a lock older than any fetch could take is abandoned. */
const FETCH_LOCK = { waitMs: 120_000, staleMs: 5 * 60_000, retryMs: 50 }

async function run(cwd: string, args: string[]): Promise<void> {
  const result = await git(cwd, args, NO_PROMPT)
  if (!result.ok) throw new RepoFetchError(result.stderr.trim() || `git ${args[0]} failed`)
}

/** Shallow fetch of `rev` from `url` into the empty directory `into`, checked out, without .git. */
export async function fetchCheckout(url: string, rev: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true })
  await run(into, ["init", "-q"])
  await run(into, ["fetch", "-q", "--depth", "1", url, rev])
  await run(into, ["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"])
  await rm(path.join(into, ".git"), { recursive: true, force: true })
}

/** The cached checkout of `rev`, or null when it has not been fetched. */
export function cachedRepo(home: string, url: string, rev: string): string | null {
  const dir = repoDir(home, url, rev)
  return existsSync(dir) ? dir : null
}

/**
 * Fetches `rev` into the cache once. The checkout is built in a temp directory and renamed into place under a
 * per-repo lock, so a partially fetched repo is never read and concurrent fetches of one rev share one checkout.
 */
export async function ensureRepo(home: string, url: string, rev: string): Promise<string> {
  const dir = repoDir(home, url, rev)
  if (existsSync(dir)) return dir
  const parent = path.dirname(dir)
  await withLock(
    parent,
    async () => {
      // Another process may have fetched it while this one waited for the lock.
      if (existsSync(dir)) return
      const temp = path.join(parent, `.tmp-${randomUUID()}`)
      try {
        await fetchCheckout(url, rev, temp)
        await rename(temp, dir)
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    },
    FETCH_LOCK,
  )
  return dir
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm vitest run test/core/repos/fetch.test.ts test/core/repos/layout.test.ts`
Expected: PASS. If "concurrent fetches" lists `.lock` next to `v0.2.0`, `withLock` did not remove its lock directory: check that `ensureRepo` awaits `withLock`.

- [ ] **Step 10: Commit**

```bash
git add packages/rulecast/src/core/repos/layout.ts packages/rulecast/src/core/repos/fetch.ts packages/rulecast/test/helpers/rule-repo.ts packages/rulecast/test/core/repos/layout.test.ts packages/rulecast/test/core/repos/fetch.test.ts
git commit -m "feat: fetch rule repos into the cache

Claude goes brr.. via Dash"
```

---

### Task 8: A rule repo's tags and the latest one

**Files:**
- Create: `src/core/repos/tags.ts`
- Test: `test/core/repos/tags.test.ts`

`git ls-remote --tags <url>` runs from the system temp directory, so it needs no repository around it. Checked against a local bare repository, it prints one `sha\trefs/tags/<name>` line per tag. An annotated tag gets a second line, `sha\trefs/tags/<name>^{}`, holding the commit it points to; the first line holds the tag object. `latestTag` compares versions numerically with `parseVersion` from `src/core/version.ts` (plan 3a, Task 4), after stripping a leading `v`.

- [ ] **Step 1: Write the failing test**

`test/core/repos/tags.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { RepoFetchError } from "../../../src/core/repos/fetch"
import { latestTag, remoteTags, type Tag } from "../../../src/core/repos/tags"
import { git } from "../../helpers/git"
import { createRuleRepo } from "../../helpers/rule-repo"

describe("remoteTags", () => {
  test("lists every tag with the commit it points to", async () => {
    const url = await createRuleRepo([
      { tag: "v0.1.0", files: { "a.txt": "one\n" } },
      { tag: "v0.2.0", files: { "a.txt": "two\n" }, annotated: true },
      { tag: "docs-snapshot", files: { "a.txt": "three\n" } },
    ])
    const commit = (tag: string) => git(url, "rev-parse", `${tag}^{commit}`)
    expect(await remoteTags(url)).toEqual([
      { name: "docs-snapshot", sha: await commit("docs-snapshot") },
      { name: "v0.1.0", sha: await commit("v0.1.0") },
      { name: "v0.2.0", sha: await commit("v0.2.0") },
    ])
  })

  test("a repo without tags has none", async () => {
    const url = await createRuleRepo([])
    expect(await remoteTags(url)).toEqual([])
  })

  test("an unreachable repo fails with git's message", async () => {
    const failure = remoteTags("/nonexistent/rulecast-rules.git")
    await expect(failure).rejects.toBeInstanceOf(RepoFetchError)
    await expect(failure).rejects.toThrow("does not appear to be a git repository")
  })
})

describe("latestTag", () => {
  const tag = (name: string): Tag => ({ name, sha: `sha-${name}` })

  test("picks the highest version, compared numerically", () => {
    expect(latestTag([tag("v0.9.0"), tag("v0.10.0"), tag("v0.2.0")])).toEqual(tag("v0.10.0"))
  })

  test("accepts versions without a v and ignores other tags", () => {
    expect(latestTag([tag("1.2.0"), tag("v1.1.9"), tag("nightly"), tag("v2.0.0-rc.1")])).toEqual(tag("1.2.0"))
  })

  test("is null when no tag is a version", () => {
    expect(latestTag([])).toBeNull()
    expect(latestTag([tag("nightly")])).toBeNull()
  })
})
```

`createRuleRepo([])` makes a repository with no commits; its bare clone has no refs, and `ls-remote` exits 0 with no output.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/repos/tags.test.ts`
Expected: FAIL: cannot find module `../../../src/core/repos/tags`.

- [ ] **Step 3: Implement `src/core/repos/tags.ts`**

```ts
import { tmpdir } from "node:os"

import { git } from "../git"
import { parseVersion } from "../version"
import { NO_PROMPT, RepoFetchError } from "./fetch"

export interface Tag {
  name: string
  /** The commit, peeled for annotated tags. */
  sha: string
}

const TAG_REF = "refs/tags/"
const PEELED = "^{}"

/** Every tag of a remote repository, sorted by name. */
export async function remoteTags(url: string): Promise<Tag[]> {
  const result = await git(tmpdir(), ["ls-remote", "--tags", url], NO_PROMPT)
  if (!result.ok) throw new RepoFetchError(result.stderr.trim() || `git ls-remote ${url} failed`)
  const tags = new Map<string, { sha: string; peeled: boolean }>()
  for (const line of result.stdout.split("\n")) {
    const [sha, ref] = line.split("\t")
    if (!sha || !ref?.startsWith(TAG_REF)) continue
    const peeled = ref.endsWith(PEELED)
    const name = ref.slice(TAG_REF.length, peeled ? -PEELED.length : undefined)
    // An annotated tag's peeled line names its commit; the plain line names the tag object.
    if (peeled || !tags.has(name)) tags.set(name, { sha, peeled })
  }
  return [...tags]
    .map(([name, { sha }]) => ({ name, sha }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function versionOf(name: string): [number, number, number] | null {
  return /^v?\d+\.\d+\.\d+$/.test(name) ? parseVersion(name.replace(/^v/, "")) : null
}

/** The tag with the highest X.Y.Z version (an optional leading "v"); null when no tag is a version. */
export function latestTag(tags: readonly Tag[]): Tag | null {
  let best: { tag: Tag; version: [number, number, number] } | null = null
  for (const tag of tags) {
    const version = versionOf(tag.name)
    if (!version) continue
    if (best === null || compareVersions(version, best.version) > 0) best = { tag, version }
  }
  return best?.tag ?? null
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/repos/tags.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/core/repos/tags.ts packages/rulecast/test/core/repos/tags.test.ts
git commit -m "feat: list a rule repo's tags and find the latest

Claude goes brr.. via Dash"
```

Plan 3b is done. Continue with `2026-09-19-rulecast-03c-compile.md`.
