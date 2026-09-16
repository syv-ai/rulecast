# rulecast Plan 2a — Core changes and the Claude Code adapter Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the core for agent hooks and build the Claude Code adapter that turns recorded hook payloads into events and deliveries into hook output.

**Architecture:** The adapter is two pure functions, `parse` (payload → `AdapterInput`) and `format` (`Delivery` → stdout JSON), written against the payloads recorded in `test/payloads/claude-code/`. The core gains what hooks need: a stop that does not block records nothing, the pipeline reports detector kinds that missed the edit deadline, a state directory with a `.gitignore` and debug log, and path helpers that map agent paths into the project. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3, §7, §9, §12 (adapter), §13, §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, zod 3, vitest.

Prerequisite: plan 1 is done. Continue with `2026-09-16-rulecast-02b-hook-init-warm.md` afterwards.

---

## Decisions this plan implements

These came out of recording the payloads (see `test/payloads/claude-code/README.md`). Task 1 writes them into the spec.

1. **Output limit.** Claude Code injects `additionalContext` of up to 10,000 chars and replaces anything longer with a file pointer. The adapter hands commit a budget of 9,000 and cuts anything longer than 10,000 chars (possible only when findings alone exceed it) with a pointer to `rulecast check --format agent`.
2. **`/clear` and fork are new sessions.** They get a new `session_id`, so they need no event. Work from before a `/clear` is not verified at the next Stop. `SessionStart` `compact` is the only `reset`.
3. **Only a blocking stop reaches the agent.** `allow` prints nothing and `capReached` goes to the user as `systemMessage`, so neither records anything in context memory.
4. **Compaction's `SubagentStop`** (`agent_type: ""`) is not verified.
5. **Block reasons say where they come from**, because the recorded model treated an unexplained block as instruction injection.
6. **Hooks never exit non-zero**, and do nothing in directories without `.rulecast/`.

## Conventions

- Run a single test file with `pnpm vitest run <path>`. Run everything with `pnpm test`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`.

## File structure

| File | Responsibility |
|---|---|
| `docs/specs/2026-09-15-rulecast-design.md` | Spec updated with the decisions above |
| `src/core/session/decide.ts` | A stop that does not block records no context |
| `src/core/pipeline.ts` | `deadlineMissed` in `PipelineResult` |
| `src/core/state-dir.ts` | `.rulecast/.state` with `.gitignore`; debug log |
| `src/commands/project.ts` | `findRoot`, `hasProject`, `toProjectPath` (moved out of `main.ts` and `check.ts`) |
| `src/core/types.ts` | `AdapterInput`, revised `Adapter` |
| `src/adapters/claude-code/parse.ts` | Payload → `AdapterInput` |
| `src/adapters/claude-code/adapter.ts` | `format`, output limit, `claudeCodeAdapter` |
| `test/helpers/payloads.ts` | Loads recorded payloads, pointed at a test project |

---

### Task 1: Record the adapter decisions in the spec

**Files:**
- Modify: `docs/specs/2026-09-15-rulecast-design.md`
- Modify: `docs/plans/2026-09-15-rulecast-00-index.md`

- [ ] **Step 1: Update the core types in §3**

Replace:
```ts
interface Detector<Config> {
  kind: string                                    // key under `detect:` in a rule
  schema: ZodType<Config>                         // includes synchronous deep checks
  captures(config: Config): string[]              // template variables every match carries
  events(config: Config): DetectorEvent[]         // default events; a rule's `events` overrides
  run(input: DetectorRun<Config>): Promise<DetectorResult>
}
```
with:
```ts
interface DetectorWarm<Config> {
  rules: { id: string; config: Config }[]   // every rule of this kind in the project
  cache: Cache
  cwd: string
  signal: AbortSignal
}

interface Detector<Config> {
  kind: string                                    // key under `detect:` in a rule
  schema: ZodType<Config>                         // includes synchronous deep checks
  captures(config: Config): string[]              // template variables every match carries
  events(config: Config): DetectorEvent[]         // default events; a rule's `events` overrides
  run(input: DetectorRun<Config>): Promise<DetectorResult>
  warm?(input: DetectorWarm<Config>): Promise<void>   // optional: build caches ahead of events (§13)
}
```

Replace:
```ts
interface Adapter {
  name: string
  supports: EventKind[]
  maxContextChars: number | null     // null = unlimited
  parse(input: unknown): Event | null
  format(delivery: Delivery, event: Event): { stdout: string; exitCode: number }
}
```
with:
```ts
interface AdapterInput {
  cwd: string                        // the agent's directory; the project root is found from it
  event: Event | null                // files may be absolute; the hook command makes them repo-relative
  warmup: boolean                    // start detector warm-up (§13)
}

interface Adapter {
  name: string
  maxContextChars: number | null     // budget for commit (§9); null = unlimited
  parse(input: unknown): AdapterInput | null   // null = not an input this adapter handles
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
}
```

- [ ] **Step 2: Update §7**

In the events table, replace:
```markdown
| `reset` | `SessionStart` with source `compact` or `clear` |
```
with:
```markdown
| `reset` | `SessionStart` with source `compact` |
```

- [ ] **Step 3: Update §9**

After the bullet:
```markdown
- Otherwise: `capReached` (the agent may stop; the delivery lists what remains).
```
add:
```markdown
- Only `block` reaches the agent. A stop that does not block records nothing in context memory, so what it would have delivered is delivered again at the next event.
```

- [ ] **Step 4: Replace the Claude Code adapter section in §12**

Replace everything from `### Claude Code adapter` up to (not including) `### CLI` with:
```markdown
### Claude Code adapter

Installed by `rulecast init` into `.claude/settings.json`, merged with existing hooks: existing entries are never modified or removed, and a hook whose command runs `rulecast hook claude-code` counts as installed. Every hook runs `rulecast hook claude-code`, or `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code` when rulecast is installed in the project.

| Hook | Matcher | Event | Output | Hook timeout |
|---|---|---|---|---|
| `PostToolUse` | `Read` | `touch` (`completeRead` when `tool_response.file` has `startLine` 1 and `numLines` equal to `totalLines`) | `hookSpecificOutput.additionalContext` | 5 s |
| `PostToolUse` | `Edit\|Write` | `edit` | `hookSpecificOutput.additionalContext` | 5 s |
| `Stop`, `SubagentStop` | — | `verify` | `block`: `{ "decision": "block", "reason": <agent text> }`; `capReached`: `{ "systemMessage": <agent text> }`; `allow`: nothing | `timeouts.verifyMs` + 10 s |
| `UserPromptSubmit` | — | `prompt` | none | 5 s |
| `SessionStart` | `startup\|resume\|compact` | `startup`, `resume`: none, starts warm-up (§13); `compact`: `reset` | none | 5 s |

- **Output limit.** Claude Code injects `additionalContext` of up to 10,000 chars whole and replaces anything longer with a pointer to a saved file plus a 2 KB preview. The adapter declares `maxContextChars` 9,000, so rendering overhead stays under the limit, and cuts output longer than 10,000 chars (possible only when findings alone exceed it) with a line pointing at `rulecast check --format agent`. Block reasons and system messages get the same cut.
- **Block reason.** Starts with a sentence saying the findings come from the project's rulecast rules; without it, agents can read a block as instruction injection.
- Session id from `session_id`; agent id from `agent_id`. File paths come from `tool_input.file_path` (absolute; `tool_response` paths can be relative); the hook command makes them repo-relative and ignores files outside the project.
- `SubagentStop` with an empty `agent_type` is `/compact`'s summariser, not an agent doing work: no `verify`.
- `/clear` and `fork` start a new `session_id`, so they begin with empty stores and need no event. Work from before a `/clear` is not verified at the next Stop: `/clear` starts a new task.
- `rulecast hook` always exits 0 (§14). A directory with no `.rulecast/` above it is not a rulecast project: the hook does nothing and creates no state.

Payloads for every row are recorded from Claude Code 2.1.273 in `test/payloads/claude-code/` (findings in its `README.md`), and the adapter is written against them. Claude Code 2.1.273 has no `MultiEdit` tool.

```

In the CLI block below it, replace the line `rulecast warm                   build detector caches (started detached by hooks; §13)` with `rulecast warm [--detector <kind>]...   build detector caches (started detached by hooks; §13)`.

- [ ] **Step 5: Update §13 and §14**

In §13 replace:
```markdown
`SessionStart` with `startup` or `resume` starts `rulecast warm` for all detectors that declare warm-up work.
```
with:
```markdown
`SessionStart` with `startup` or `resume` starts `rulecast warm` for every detector used by a rule that has a `warm` method (§3).
```

In the §14 table, after the row starting `| Store unreadable or lock not acquired within 2 s |`, add:
```markdown
| Unreadable hook input, unknown adapter, or no `.rulecast/` above the agent's directory | No output | n/a |
```

- [ ] **Step 6: Update the plan index**

In `docs/plans/2026-09-15-rulecast-00-index.md`, replace the plan 2 status cell `Written after plan 1 (payloads must be recorded first)` with ``Written, in two parts executed in order: `2026-09-16-rulecast-02a-adapter.md` (tasks 1–7), `02b-hook-init-warm.md` (tasks 8–13)``.

- [ ] **Step 7: Commit**

```bash
git add docs
git commit -m "docs: record Claude Code adapter decisions in the spec

Claude goes brr.. via Dash"
```

---

### Task 2: A stop that does not block records nothing

**Files:**
- Modify: `src/core/session/decide.ts` (stop gate block at the end of `decide`)
- Test: `test/core/session/decide-findings.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("decide: stop gate", ...)` in `test/core/session/decide-findings.test.ts`, after the `capReached at the cap` test:
```ts
  test("only a blocking stop records context", async () => {
    const warnings = [{ key: "w", text: "problem" }]
    const allow = await decide(input({ stopGate: true, findings: [newWarning], warnings }))
    expect(allow.delivery.warnings).toEqual(["problem"])
    expect(allow.context).toEqual([])

    const work = emptyWork()
    work.stopBlocks.set("main", 3)
    const capped = await decide(input({ stopGate: true, work, findings: [newError], warnings }))
    expect(capped.context).toEqual([])

    const block = await decide(input({ stopGate: true, findings: [newError], warnings }))
    expect(block.context).toEqual([{ t: "warned", key: "w" }])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/session/decide-findings.test.ts`
Expected: FAIL in `only a blocking stop records context`: `allow.context` is `[{ t: "warned", key: "w" }]`, expected `[]`.

- [ ] **Step 3: Implement**

In `src/core/session/decide.ts`, replace the stop gate block:
```ts
  // Stop gate.
  if (input.stopGate) {
    const newErrors = delivery.findings.some((finding) => finding.severity === "error")
    const blocks = input.work.stopBlocks.get(input.agent) ?? 0
    if (!newErrors) delivery.stop = "allow"
    else if (blocks < input.maxBlocks) {
      delivery.stop = "block"
      work.push({ t: "stopBlock", agent: input.agent })
    } else delivery.stop = "capReached"
  }
```
with:
```ts
  // Stop gate.
  if (input.stopGate) {
    const newErrors = delivery.findings.some((finding) => finding.severity === "error")
    const blocks = input.work.stopBlocks.get(input.agent) ?? 0
    if (!newErrors) delivery.stop = "allow"
    else if (blocks < input.maxBlocks) {
      delivery.stop = "block"
      work.push({ t: "stopBlock", agent: input.agent })
    } else delivery.stop = "capReached"
    // Only a block reaches the agent; anything else must not count as delivered.
    if (delivery.stop !== "block") return { delivery, work, context: [] }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/session test/core/pipeline-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/decide.ts test/core/session/decide-findings.test.ts
git commit -m "feat: record no context for a stop that does not block

Claude goes brr.. via Dash"
```

---

### Task 3: The pipeline names detectors that missed the edit deadline

**Files:**
- Modify: `src/core/pipeline.ts`
- Test: `test/core/pipeline-deadline.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/pipeline-deadline.test.ts`:
```ts
import { expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import { runPipeline } from "../../src/core/pipeline"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { createRepo } from "../helpers/git"

const schema = z.object({}).strict()

/** Never finishes, so it always misses the deadline. */
const slowDetector: Detector<z.infer<typeof schema>> = {
  kind: "slow",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: () => new Promise(() => {}),
}

test("an edit names the detector kinds whose results were dropped at the deadline", async () => {
  const root = await createRepo({
    ".rulecast/config.yml": "timeouts:\n  editDeadlineMs: 20\n",
    ".rulecast/rules/slow.yml": "id: slow/rule\nfiles: app/**/*.py\ndetect: { slow: {} }\nmessage: m\n",
    "app/a.py": "x = 1\n",
  })
  const result = await runPipeline({
    root,
    event: { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
    registry: createRegistry([...builtinDetectors, slowDetector]),
    maxContextChars: null,
  })
  expect(result.deadlineMissed).toEqual(["slow"])
  expect(result.failed).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/pipeline-deadline.test.ts`
Expected: FAIL: `expected undefined to deeply equal [ 'slow' ]`.

- [ ] **Step 3: Implement**

In `src/core/pipeline.ts`:

Add a field to `PipelineResult`, after `failed`:
```ts
  /** Detector kinds whose results were dropped at the edit deadline (§13). */
  deadlineMissed: string[]
```

After the line `let failed = project.diagnostics.length > 0` add:
```ts
  const deadlineMissed: string[] = []
```

Replace the early return for prompt and reset:
```ts
    return { delivery: emptyDelivery(), project, failed }
```
with:
```ts
    return { delivery: emptyDelivery(), project, failed, deadlineMissed }
```

In the `for (const timeout of output.timedOut)` loop, replace:
```ts
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
      } else {
```
with:
```ts
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
        deadlineMissed.push(timeout.kind)
      } else {
```

Replace the three remaining returns at the end of `runPipeline`:
```ts
  if (!session) return { delivery: (await decide(inputFor(view))).delivery, project, failed }
```
```ts
    return { delivery, project, failed }
```
(this line appears twice: after `commitSession` and in the `LockTimeoutError` fallback) with, respectively:
```ts
  if (!session) return { delivery: (await decide(inputFor(view))).delivery, project, failed, deadlineMissed }
```
```ts
    return { delivery, project, failed, deadlineMissed }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/core && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline.ts test/core/pipeline-deadline.test.ts
git commit -m "feat: report detector kinds that missed the edit deadline

Claude goes brr.. via Dash"
```

---

### Task 4: State directory and debug log

**Files:**
- Create: `src/core/state-dir.ts`
- Test: `test/core/state-dir.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/state-dir.test.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { debugLogger, ensureStateDir } from "../../src/core/state-dir"
import { createProject } from "../helpers/project"

describe("state directory", () => {
  test("ensureStateDir creates .rulecast/.state with a .gitignore, and never rewrites it", async () => {
    const root = await createProject({ ".rulecast/config.yml": "" })
    const dir = ensureStateDir(root)
    expect(dir).toBe(path.join(root, ".rulecast", ".state"))
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("*\n")

    writeFileSync(path.join(dir, ".gitignore"), "custom\n")
    ensureStateDir(root)
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("custom\n")
  })

  test("debugLogger appends timestamped lines", async () => {
    const root = await createProject({})
    ensureStateDir(root)
    const log = debugLogger(root, () => new Date("2026-09-16T12:00:00.000Z"))
    log("first")
    log("second")
    expect(readFileSync(path.join(root, ".rulecast/.state/debug.log"), "utf8")).toBe(
      "2026-09-16T12:00:00.000Z first\n2026-09-16T12:00:00.000Z second\n",
    )
  })

  test("debugLogger never throws", () => {
    expect(() => debugLogger("/nonexistent/rulecast-root")("line")).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/state-dir.test.ts`
Expected: FAIL: cannot find module `../../src/core/state-dir`.

- [ ] **Step 3: Implement**

`src/core/state-dir.ts`:
```ts
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export function stateDir(root: string): string {
  return path.join(root, ".rulecast", ".state")
}

/** Creates .rulecast/.state with a .gitignore that ignores everything in it. */
export function ensureStateDir(root: string): string {
  const dir = stateDir(root)
  const ignore = path.join(dir, ".gitignore")
  if (!existsSync(ignore)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(ignore, "*\n")
  }
  return dir
}

/** Appends timestamped lines to .rulecast/.state/debug.log. Best effort: never throws. */
export function debugLogger(root: string, now: () => Date = () => new Date()): (line: string) => void {
  const file = path.join(stateDir(root), "debug.log")
  return (line) => {
    try {
      appendFileSync(file, `${now().toISOString()} ${line}\n`)
    } catch {
      // A hook must not fail because its log could not be written.
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/core/state-dir.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/state-dir.ts test/core/state-dir.test.ts
git commit -m "feat: add the state directory and debug log

Claude goes brr.. via Dash"
```

---

### Task 5: Project path helpers

**Files:**
- Create: `src/commands/project.ts`
- Modify: `src/commands/main.ts` (remove `findRoot`), `src/commands/check.ts` (remove `toProjectPath`)
- Test: `test/commands/project.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/project.test.ts`:
```ts
import path from "node:path"
import { describe, expect, test } from "vitest"

import { findRoot, hasProject, toProjectPath } from "../../src/commands/project"
import { createProject } from "../helpers/project"

describe("project paths", () => {
  test("findRoot walks up to the nearest directory containing .rulecast", async () => {
    const root = await createProject({ ".rulecast/config.yml": "", "app/deep/x.py": "" })
    expect(findRoot(path.join(root, "app/deep"))).toBe(root)
    const bare = await createProject({ "x.py": "" })
    expect(findRoot(bare)).toBe(bare)
  })

  test("hasProject is true only where .rulecast exists", async () => {
    expect(hasProject(await createProject({ ".rulecast/config.yml": "" }))).toBe(true)
    expect(hasProject(await createProject({ "x.py": "" }))).toBe(false)
  })

  test("toProjectPath makes paths repo-relative and rejects paths outside the root", () => {
    expect(toProjectPath("/repo", "/repo/src", "a.ts")).toBe("src/a.ts")
    expect(toProjectPath("/repo", "/anywhere", "/repo/app/x.py")).toBe("app/x.py")
    expect(toProjectPath("/repo", "/repo", "..config/x")).toBe("..config/x")
    expect(toProjectPath("/repo", "/repo", "/elsewhere/x.py")).toBeNull()
    expect(toProjectPath("/repo", "/repo/src", "../..")).toBeNull()
    expect(toProjectPath("/repo", "/repo", "/repo")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/project.test.ts`
Expected: FAIL: cannot find module `../../src/commands/project`.

- [ ] **Step 3: Implement**

`src/commands/project.ts`:
```ts
import { existsSync } from "node:fs"
import path from "node:path"

/** Nearest ancestor of cwd containing .rulecast/, or cwd itself. */
export function findRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".rulecast"))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

export function hasProject(root: string): boolean {
  return existsSync(path.join(root, ".rulecast"))
}

/** A file as a repo-relative path with forward slashes, or null when it is not inside root. */
export function toProjectPath(root: string, cwd: string, file: string): string | null {
  const relative = path.relative(root, path.resolve(cwd, file))
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return relative.split(path.sep).join("/")
}
```

In `src/commands/main.ts`: delete the `findRoot` function and its doc comment, delete the imports `import { existsSync } from "node:fs"` and `import path from "node:path"`, and add:
```ts
import { findRoot } from "./project"
```

In `src/commands/check.ts`: delete the local `toProjectPath` function and `import path from "node:path"`, add:
```ts
import { toProjectPath } from "./project"
```
and replace:
```ts
  if (positionals.length > 0) {
    files = positionals.map((file) => toProjectPath(root, io.cwd, file))
```
with:
```ts
  if (positionals.length > 0) {
    files = positionals
      .map((file) => toProjectPath(root, io.cwd, file))
      .filter((file): file is string => file !== null)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/commands && pnpm typecheck && grep -rn "findRoot\|toProjectPath" src`
Expected: PASS, no type errors, and `findRoot`/`toProjectPath` are defined only in `src/commands/project.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/commands test/commands/project.test.ts
git commit -m "refactor: move project path helpers into commands/project

Claude goes brr.. via Dash"
```

---

### Task 6: Parse Claude Code payloads

**Files:**
- Modify: `src/core/types.ts` (`Event` doc comment, `Adapter`; add `AdapterInput`)
- Create: `src/adapters/claude-code/parse.ts`, `test/helpers/payloads.ts`
- Test: `test/adapters/claude-code/parse.test.ts`

- [ ] **Step 1: Create the payload helper**

`test/helpers/payloads.ts`:
```ts
import { readFileSync } from "node:fs"
import path from "node:path"

export interface Payload {
  session_id: string
  cwd: string
  agent_id?: string
  tool_input?: { file_path?: string }
  [key: string]: unknown
}

/**
 * A payload recorded in test/payloads/claude-code, optionally pointed at a test project:
 * `root` replaces cwd, `file` (repo-relative) replaces tool_input.file_path, `sessionId` replaces session_id.
 */
export function claudeCodePayload(
  name: string,
  overrides: { root?: string; file?: string; sessionId?: string } = {},
): Payload {
  const payload: Payload = JSON.parse(
    readFileSync(new URL(`../payloads/claude-code/${name}.json`, import.meta.url), "utf8"),
  )
  if (overrides.root) payload.cwd = overrides.root
  if (overrides.file && payload.tool_input) payload.tool_input.file_path = path.join(payload.cwd, overrides.file)
  if (overrides.sessionId) payload.session_id = overrides.sessionId
  return payload
}
```

- [ ] **Step 2: Write the failing test**

`test/adapters/claude-code/parse.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { parseClaudeCode } from "../../../src/adapters/claude-code/parse"
import type { EventKind } from "../../../src/core/types"
import { claudeCodePayload } from "../../helpers/payloads"

const parse = (name: string) => {
  const payload = claudeCodePayload(name)
  return { payload, parsed: parseClaudeCode(payload) }
}

describe("Claude Code adapter: parse", () => {
  test.each<[string, EventKind, string[], boolean | undefined]>([
    ["post-tool-use.read.complete", "touch", ["/project/src/math.ts"], true],
    ["post-tool-use.read.partial", "touch", ["/project/src/math.ts"], false],
    ["post-tool-use.read.relative-response-path", "touch", ["/project/src/wide.txt"], true],
    ["post-tool-use.edit", "edit", ["/project/src/math.ts"], undefined],
    ["post-tool-use.edit.replace-all", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.create", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.update", "edit", ["/project/src/wide.txt"], undefined],
    ["stop", "verify", [], undefined],
    ["stop.after-block", "verify", [], undefined],
    ["user-prompt-submit", "prompt", [], undefined],
    ["session-start.compact", "reset", [], undefined],
  ])("%s → %s", (name, kind, files, completeRead) => {
    const { payload, parsed } = parse(name)
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: { kind, files, completeRead, cwd: "/project", session: { id: payload.session_id } },
    })
  })

  test.each<[string, EventKind]>([
    ["post-tool-use.read.subagent", "touch"],
    ["post-tool-use.edit.subagent", "edit"],
    ["subagent-stop", "verify"],
    ["subagent-stop.after-block", "verify"],
  ])("%s carries the subagent's agent id", (name, kind) => {
    const { payload, parsed } = parse(name)
    expect(parsed?.event?.kind).toBe(kind)
    expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
  })

  test.each([
    "post-tool-use.agent",
    "post-tool-use-failure.read.too-large",
    "subagent-stop.compaction",
    "pre-compact.manual",
    "session-start.clear",
    "session-start.fork",
  ])("%s has no event", (name) => {
    expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: false })
  })

  test.each(["session-start.startup", "session-start.startup.interactive", "session-start.resume"])(
    "%s starts warm-up",
    (name) => {
      expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: true })
    },
  )

  test.each([
    null,
    "text",
    {},
    { hook_event_name: "Stop", cwd: "/project" },
    { hook_event_name: "Stop", session_id: "", cwd: "/project" },
  ])("rejects malformed input %j", (input) => {
    expect(parseClaudeCode(input)).toBeNull()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run test/adapters/claude-code/parse.test.ts`
Expected: FAIL: cannot find module `../../../src/adapters/claude-code/parse`.

- [ ] **Step 4: Update the adapter types**

In `src/core/types.ts`, replace the `files` doc comment in `Event`:
```ts
  /** Repo-relative paths. Empty for prompt and reset. */
  files: string[]
```
with:
```ts
  /** Repo-relative paths (adapters may give absolute ones; the hook command converts them). Empty for prompt and reset. */
  files: string[]
```

Replace the `Adapter` interface:
```ts
export interface Adapter {
  name: string
  supports: EventKind[]
  maxContextChars: number | null
  parse(input: unknown): Event | null
  format(delivery: Delivery, event: Event): { stdout: string; exitCode: number }
}
```
with:
```ts
export interface AdapterInput {
  /** The agent's directory; the project root is found from it. */
  cwd: string
  /** null: nothing to run for this input. */
  event: Event | null
  /** Start detector warm-up (§13). */
  warmup: boolean
}

export interface Adapter {
  name: string
  /** Budget handed to commit (§9); null = unlimited. */
  maxContextChars: number | null
  /** null: not an input this adapter handles. */
  parse(input: unknown): AdapterInput | null
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
}
```

- [ ] **Step 5: Implement the parser**

`src/adapters/claude-code/parse.ts`:
```ts
import { z } from "zod"

import type { AdapterInput, EventKind } from "../../core/types"

const common = z.object({
  hook_event_name: z.string(),
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  agent_type: z.string().optional(),
  source: z.string().optional(),
})

const fileTool = z.object({
  tool_name: z.string(),
  tool_input: z.object({ file_path: z.string().min(1) }),
})

const readResponse = z.object({
  tool_response: z.object({
    file: z.object({ startLine: z.number(), numLines: z.number(), totalLines: z.number() }),
  }),
})

/** Maps a Claude Code hook payload (recorded in test/payloads/claude-code) to an adapter input. */
export function parseClaudeCode(input: unknown): AdapterInput | null {
  const head = common.safeParse(input)
  if (!head.success) return null
  const { hook_event_name: hook, session_id: id, cwd, agent_id: agentId, agent_type: agentType, source } = head.data
  const session = agentId === undefined ? { id } : { id, agentId }
  const result = (kind: EventKind | null, files: string[] = [], completeRead?: boolean): AdapterInput => ({
    cwd,
    event: kind === null ? null : { kind, files, cwd, session, ...(completeRead === undefined ? {} : { completeRead }) },
    warmup: false,
  })

  switch (hook) {
    case "PostToolUse": {
      const tool = fileTool.safeParse(input)
      if (!tool.success) return result(null)
      const { tool_name: name, tool_input: toolInput } = tool.data
      if (name === "Edit" || name === "Write") return result("edit", [toolInput.file_path])
      if (name !== "Read") return result(null)
      const read = readResponse.safeParse(input)
      const file = read.success ? read.data.tool_response.file : null
      return result("touch", [toolInput.file_path], file !== null && file.startLine === 1 && file.numLines === file.totalLines)
    }
    case "Stop":
      return result("verify")
    case "SubagentStop":
      // /compact's summariser runs as a subagent with an empty agent type.
      return result(agentType === "" ? null : "verify")
    case "UserPromptSubmit":
      return result("prompt")
    case "SessionStart":
      // clear and fork arrive with a new session id, so their stores are already empty.
      if (source === "compact") return result("reset")
      return { ...result(null), warmup: source === "startup" || source === "resume" }
    default:
      return result(null)
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run test/adapters/claude-code/parse.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/adapters/claude-code/parse.ts test/helpers/payloads.ts test/adapters/claude-code/parse.test.ts
git commit -m "feat: parse Claude Code hook payloads

Claude goes brr.. via Dash"
```

---

### Task 7: Format deliveries for Claude Code

**Files:**
- Create: `src/adapters/claude-code/adapter.ts`
- Test: `test/adapters/claude-code/format.test.ts`

- [ ] **Step 1: Write the failing test**

`test/adapters/claude-code/format.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { CONTEXT_LIMIT, claudeCodeAdapter } from "../../../src/adapters/claude-code/adapter"
import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { type Delivery, type Event, type EventKind, emptyDelivery, type Finding } from "../../../src/core/types"

const options = { maxMatchesPerRule: 10 }
const event = (kind: EventKind): Event => ({ kind, files: [], cwd: "/project", session: { id: "s1" } })
const finding = (overrides: Partial<Finding> = {}): Finding => ({
  rule: "backend/no-httpexception",
  severity: "error",
  status: "new",
  file: "app/services/users.py",
  line: 3,
  column: 5,
  message: "app/services/users.py:3 raises HTTPException(500). Raise a domain exception.",
  count: 1,
  ...overrides,
})
const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({ ...emptyDelivery(), ...overrides })
const format = (value: Delivery, kind: EventKind, opts = options) => claudeCodeAdapter.format(value, event(kind), opts)

describe("Claude Code adapter: format", () => {
  test("touch and edit deliver agent text as additional context", () => {
    const value = delivery({ findings: [finding()] })
    for (const kind of ["touch", "edit"] as const) {
      const output = format(value, kind)
      expect(output.exitCode).toBe(0)
      expect(JSON.parse(output.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: renderAgentText(value, options) },
      })
    }
  })

  test("nothing to say prints nothing", () => {
    for (const kind of ["touch", "edit", "verify", "prompt", "reset"] as const) {
      expect(format(delivery(), kind)).toEqual({ stdout: "", exitCode: 0 })
    }
  })

  test("a blocked stop hands the findings to the agent as the block reason", () => {
    const output = JSON.parse(format(delivery({ findings: [finding()], stop: "block" }), "verify").stdout)
    expect(output.decision).toBe("block")
    expect(output.reason).toMatch(/^This project's rulecast rules/)
    expect(output.reason).toContain("raises HTTPException(500)")
  })

  test("an allowed stop prints nothing", () => {
    const value = delivery({ findings: [finding({ severity: "warning" })], stop: "allow" })
    expect(format(value, "verify")).toEqual({ stdout: "", exitCode: 0 })
  })

  test("a stop past the block cap tells the user what remains", () => {
    const output = JSON.parse(format(delivery({ findings: [finding()], stop: "capReached" }), "verify").stdout)
    expect(output).toEqual({ systemMessage: expect.stringContaining("raises HTTPException(500)") })
  })

  test("output longer than Claude Code's limit is cut with a pointer to rulecast check", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const big = delivery({ findings, stop: "block" })
    const wide = { maxMatchesPerRule: 1000 }
    const edit = JSON.parse(format(big, "edit", wide).stdout).hookSpecificOutput.additionalContext as string
    const stop = JSON.parse(format(big, "verify", wide).stdout).reason as string
    for (const text of [edit, stop]) {
      expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(text).toMatch(/Run `rulecast check --format agent` for the full list\.$/)
    }
  })

  test("the budget handed to commit stays under the limit", () => {
    expect(claudeCodeAdapter.maxContextChars).toBeLessThan(CONTEXT_LIMIT)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/adapters/claude-code/format.test.ts`
Expected: FAIL: cannot find module `../../../src/adapters/claude-code/adapter`.

- [ ] **Step 3: Implement**

`src/adapters/claude-code/adapter.ts`:
```ts
import { renderAgentText } from "../../core/delivery/render-agent"
import type { Adapter } from "../../core/types"
import { parseClaudeCode } from "./parse"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast/rules) found problems in code changed in this session. Fix them before you finish."

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

const CUT = "\n\n…cut to fit Claude Code's hook output limit. Run `rulecast check --format agent` for the full list."

/** Only findings can push text past the limit: commit keeps references within the budget. */
function fit(text: string): string {
  return text.length <= CONTEXT_LIMIT ? text : text.slice(0, CONTEXT_LIMIT - CUT.length) + CUT
}

const NONE = { stdout: "", exitCode: 0 }
const json = (value: unknown) => ({ stdout: JSON.stringify(value), exitCode: 0 })

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  maxContextChars: CONTEXT_BUDGET,
  parse: parseClaudeCode,
  format(delivery, event, options) {
    const text = renderAgentText(delivery, options)
    if (text === "") return NONE
    switch (event.kind) {
      case "touch":
      case "edit":
        return json({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: fit(text) } })
      case "verify":
        if (delivery.stop === "block") return json({ decision: "block", reason: fit(`${BLOCK_PREAMBLE}\n\n${text}`) })
        if (delivery.stop === "capReached") return json({ systemMessage: fit(`${CAP_PREAMBLE}\n\n${text}`) })
        return NONE
      default:
        return NONE
    }
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/adapters && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit and push**

```bash
git add src/adapters/claude-code/adapter.ts test/adapters/claude-code/format.test.ts
git commit -m "feat: format deliveries as Claude Code hook output

Claude goes brr.. via Dash"
git push origin main
```

Plan 2a is done. Continue with `2026-09-16-rulecast-02b-hook-init-warm.md`.
