# rulecast Plan 3e — Rule repos end to end, compaction re-delivery, and the finish Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove rule repos work through the real entry points (hook, `install`, `run`), make compaction re-deliver the touch conventions of the files the agent's harness re-attaches, and close plan 3 with the public exports, a usage check, the perf test and a hands-on end-to-end run.

**Architecture:** Task 17 adds no planned code: it drives a project that pins a local bare "rule repo" through `rulecast hook claude-code`, `rulecast install` and `rulecast run`, and fixes only what those tests expose. Task 18 keeps the core agent-neutral: work memory records every file each agent reads or edits (`accessed`), adapters declare how many recently accessed files their agent re-attaches after compaction (`Adapter.restoredFiles`; Claude Code 5), and a `reset` clears context memory and then delivers the touch context of those files, which the Claude Code adapter writes as `SessionStart` `additionalContext`. Task 19 exports the new API, pins the usage text, re-runs the perf test and marks plan 3 done. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3 (`Adapter`), §4 (rule repos, reference identity), §7 (`reset`), §9 (stores, reset), §12 (adapter table, CLI, cache), §13, §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, zod 3, yaml 2, vitest, git.

Prerequisite: `2026-09-19-rulecast-03d-commands.md` is done (tasks 11–16). This part completes plan 3; plan 4 (`2026-09-19-rulecast-04a-catalog-docs.md`) follows.

---

## Decisions this part implements

1. **Compaction re-delivery (user-confirmed 2026-09-19).** Recorded from Claude Code 2.1.278 (Task 1 wrote it into `test/payloads/claude-code/README.md`): after `/compact`, Claude Code re-attaches the main agent's 5 most recently read, edited or written files, newest first, without tool calls, so no `touch` fires for them. `SessionStart` `compact` honours `hookSpecificOutput.additionalContext` with the same 10,000-char limit as `PostToolUse`.
2. **Agent-neutral core.** The number 5 belongs to the Claude Code adapter (`restoredFiles: 5`). The core only knows "re-deliver touch context for the agent's N most recently accessed files on reset"; an adapter without re-attachment declares 0 and reset stays silent.
3. **Every file counts as an access**, not only files that match rules: the harness counts all files when it picks the 5 it re-attaches. Accesses are per agent, because a subagent's reads are not in the main agent's context.
4. **Reset takes no snapshots and records no session start.** It only reads work memory and delivers touch context.

Known behaviour, accepted: a second `/compact` with no reads in between re-delivers the same touch context again, although Claude Code re-attaches nothing that time (its re-attached files were attachments, not reads). The duplicate costs context once per compaction and never blocks.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME` (from Task 6 on).
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths are under `packages/rulecast/` unless they start with `docs/`.

| File | Responsibility |
|---|---|
| `test/commands/rule-repos.test.ts` | A project pinning a local bare rule repo, driven through hook, `install` and `run` |
| `src/core/session/state.ts` | `accessed` work records; `WorkState.accessed` per agent |
| `src/core/types.ts` | `Adapter.restoredFiles` |
| `src/core/pipeline.ts` | `PipelineOptions.restoredFiles`; access records on touch and edit; reset re-delivers touch context |
| `src/adapters/claude-code/adapter.ts` | `restoredFiles: 5`; a `reset` delivery becomes `SessionStart` `additionalContext` |
| `src/commands/hook.ts` | Passes `adapter.restoredFiles` to the pipeline |
| `test/core/session/state.test.ts` | Fold of `accessed` |
| `test/core/pipeline-reset.test.ts` | Reset scenarios through the pipeline |
| `test/adapters/claude-code/format.test.ts` | `SessionStart` output |
| `test/commands/hook-compaction.test.ts` | Recorded payloads: read or edit, then `session-start.compact` |
| `src/index.ts` | Public API after plan 3 |
| `test/smoke.test.ts` | The package entry exports the compile, repo and cache API |
| `test/commands/help.test.ts` | Usage text pinned |
| `docs/plans/2026-09-15-rulecast-00-index.md` | Plan 3 marked done |

## Not in this plan

- **Store corruption fallback (§14 "Store unreadable").** Still open from plan 2: the hook logs `CorruptStoreError` and prints nothing.
- **Auto-compaction.** The recording used manual `/compact`. `SessionStart` reports `source: "compact"` for both in Claude Code's docs; if dogfooding shows otherwise, record a payload and add a parse case.

---

### Task 17: Rule repos end to end

**Files:**
- Test: `test/commands/rule-repos.test.ts`
- Modify: only what a failing test points at (see Step 3)

The test builds a bare rule repo with `createRuleRepo` (Task 7), pins it at `v1.0.0` next to a `local` rule, and checks three things the spec promises: hooks never fetch and say so once, `install` fetches, and repo rules then deliver labelled references, absolute locations for `read` references, and override context from the project.

- [ ] **Step 1: Write the test**

`test/commands/rule-repos.test.ts`:
```ts
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createRepo } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"
import { createRuleRepo } from "../helpers/rule-repo"

const USERS = "app/services/users.py"
const REV = "v1.0.0"
const VIOLATION = "def get():\n    print(1)  # TODO remove\n    return 1\n"

const PYTHON_DOC = [
  "# Python",
  "",
  "## Errors",
  "",
  "Services raise domain exceptions.",
  "",
  "## Style",
  "",
  "Keep functions short.",
  "",
].join("\n")

const MANIFEST = stringify([
  {
    id: "python/no-print",
    name: "No print calls",
    files: "\\.py$",
    types: ["python"],
    detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)" } },
    message: "{{file}}:{{line}} prints {{args}}. Use the logger.",
    context: ["@docs/python.md#errors", { path: "@docs/python.md#style", mode: "read" }],
  },
  {
    id: "python/no-todo",
    name: "No TODO comments",
    files: "\\.py$",
    detect: { regex: { pattern: "TODO" } },
    message: "{{file}}:{{line}} leaves a TODO. Track it in an issue.",
    context: ["@docs/python.md#style"],
  },
])

const AGENTS = [
  "# Agents",
  "",
  "## Services",
  "",
  "Services hold business logic.",
  "",
  "## Todos",
  "",
  "Track work in issues, not TODO comments.",
  "",
].join("\n")

/** A committed project pinning the rule repo at REV, plus one local touch rule. */
async function project(): Promise<{ root: string; url: string; label: string; location: string }> {
  const url = await createRuleRepo([{ tag: REV, files: { ".rulecast-rules.yaml": MANIFEST, "docs/python.md": PYTHON_DOC } }])
  const config = stringify({
    repos: [
      {
        repo: url,
        rev: REV,
        rules: [{ id: "python/no-print" }, { id: "python/no-todo", context: ["@AGENTS.md#todos"] }],
      },
      {
        repo: "local",
        rules: [
          {
            id: "local/services",
            name: "Service conventions",
            files: "^app/services/",
            stages: ["touch"],
            context: ["@AGENTS.md#services"],
          },
        ],
      },
    ],
  })
  const root = await createRepo({
    ".rulecast-config.yaml": config,
    "AGENTS.md": AGENTS,
    [USERS]: "def get():\n    return 1\n",
  })
  return {
    root,
    url,
    label: repoLabel(url, REV),
    location: path.join(repoDir(TEST_HOME, url, REV), "docs/python.md"),
  }
}

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const additionalContext = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext

/** What an agent must see for VIOLATION in USERS, from a hook or from run --format agent. */
function expectRepoDelivery(text: string, label: string, location: string) {
  expect(text).toContain("error python/no-print")
  expect(text).toContain(`${USERS}:2 prints 1. Use the logger.`)
  expect(text).toContain(`${USERS}:2 leaves a TODO. Track it in an issue.`)
  // Injected from the rule repo, labelled with its source.
  expect(text).toContain(`--- ${label}:docs/python.md#errors ---\n## Errors\n\nServices raise domain exceptions.`)
  // A read reference from a rule repo points at the fetched file.
  expect(text).toContain(`--- ${label}:docs/python.md#style: read ${location} before continuing ---`)
  // The override's context resolves against the project, not the rule repo.
  expect(text).toContain("--- AGENTS.md#todos ---\n## Todos\n\nTrack work in issues, not TODO comments.")
  expect(text).not.toContain(`--- ${label}:docs/python.md#style ---`)
}

describe("rule repos end to end", () => {
  test("hooks never fetch: a missing repo is a warning once per context, and local rules keep working", async () => {
    const { root, url } = await project()
    const read = await hook(root, "post-tool-use.read.complete", USERS)
    expect(read.code).toBe(0)
    const text = additionalContext(read.stdout)
    expect(text).toContain("--- AGENTS.md#services ---")
    expect(text).toContain(`${url}@${REV}: not in the cache (run rulecast install)`)
    expect(existsSync(repoDir(TEST_HOME, url, REV))).toBe(false)

    await writeFile(path.join(root, USERS), VIOLATION)
    const edit = await hook(root, "post-tool-use.edit", USERS)
    expect(edit.code).toBe(0)
    expect(edit.stdout).not.toContain("not in the cache")
    expect(edit.stdout).not.toContain("python/no-print")
  })

  test("after install, hooks deliver repo rules with labelled references", async () => {
    const { root, label, location } = await project()
    const install = await runCli(root, ["install"])
    expect(install.code).toBe(0)
    expect(install.stdout).toContain(`fetched ${label}`)

    const read = await hook(root, "post-tool-use.read.complete", USERS)
    expect(additionalContext(read.stdout)).not.toContain("not in the cache")

    await writeFile(path.join(root, USERS), VIOLATION)
    const edit = await hook(root, "post-tool-use.edit", USERS)
    expectRepoDelivery(additionalContext(edit.stdout), label, location)

    const stop = JSON.parse((await hook(root, "stop")).stdout)
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain(`${USERS}:2 prints 1. Use the logger.`)
    // Delivered at the edit, so the stop only points at it.
    expect(stop.reason).toContain(`--- ${label}:docs/python.md#errors (provided earlier in this session) ---`)
  })

  test("run fetches missing repos and reports repo rules the same way", async () => {
    const { root, url, label, location } = await project()
    await writeFile(path.join(root, USERS), VIOLATION)
    const result = await runCli(root, ["run", "--all-files", "--format", "agent"])
    expect(result.code).toBe(1)
    expectRepoDelivery(result.stdout, label, location)
    expect(existsSync(repoDir(TEST_HOME, url, REV))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/commands/rule-repos.test.ts`
Expected: PASS. Tasks 5, 7, 9, 10, 11 and 13 already implement everything these tests check, so this task adds no code when they pass.

- [ ] **Step 3: If a test fails, find the cause before changing anything**

Use the systematic-debugging skill. Decide whether the test or the code is wrong against the spec (§4 reference identity, §12 hook and `install`), then fix the module the contract assigns that behaviour to:

| Symptom | Module |
|---|---|
| No `not in the cache` warning, or a different text | `src/core/repos/provider.ts` (`cachedRepos` message) and the diagnostic-to-warning mapping in `src/core/pipeline.ts` (`<source> (<rule>): <message> (run <hint>)`, without ` (<rule>)` when the diagnostic has no rule, as here) |
| Warning repeated on the edit | the warning key in `src/core/pipeline.ts` must not change between events |
| Repo reference without the `<label>:` prefix | `parseReference` in `src/core/references.ts` |
| `read` reference without the absolute path | `location` in `src/core/session/decide.ts` and `src/core/delivery/render-agent.ts` |
| `AGENTS.md#todos` missing or labelled | `contextRoot` choice in `src/core/compile/project.ts` |
| `install` printed nothing for the fetch | `src/commands/install.ts` |

Add a focused unit test next to the module you change, reproducing the failure there, before fixing it.

- [ ] **Step 4: Run everything**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/test/commands/rule-repos.test.ts
git commit -m "test: drive a pinned rule repo through hook, install and run

Claude goes brr.. via Dash"
```

If Step 3 changed code, add those source and test paths to the `git add` and describe the fix in the message body.

---

### Task 18: Re-deliver touch context after compaction

**Files:**
- Modify: `src/core/session/state.ts`, `src/core/types.ts` (`Adapter`), `src/core/pipeline.ts`, `src/adapters/claude-code/adapter.ts`, `src/commands/hook.ts`
- Test: `test/core/session/state.test.ts`, `test/core/pipeline-reset.test.ts` (new), `test/adapters/claude-code/format.test.ts`, `test/commands/hook-compaction.test.ts` (new)

- [ ] **Step 1: Write the failing fold test**

In `test/core/session/state.test.ts`, in the test `tracks edited files, stop blocks per agent reset by prompts, and disabled rules`, replace:
```ts
      disabled: new Map([["r1", "boom"]]),
    })
  })
```
with:
```ts
      disabled: new Map([["r1", "boom"]]),
      accessed: new Map(),
    })
  })

  test("tracks the files each agent accessed, most recent last", () => {
    const work = foldWork([
      { t: "accessed", agent: "main", file: "a.ts" },
      { t: "accessed", agent: "main", file: "b.ts" },
      { t: "accessed", agent: "sub1", file: "c.ts" },
      { t: "accessed", agent: "main", file: "a.ts" },
    ])
    expect(work.accessed).toEqual(
      new Map([
        ["main", ["b.ts", "a.ts"]],
        ["sub1", ["c.ts"]],
      ]),
    )
    // Accesses are not edits: Stop verifies only edited files.
    expect(work.edited).toEqual([])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/session/state.test.ts`
Expected: FAIL: the first test's object has no `accessed` key, and the new test fails typechecking in the editor and at runtime with `work.accessed` undefined.

- [ ] **Step 3: Add `accessed` to work memory**

In `src/core/session/state.ts`, replace:
```ts
export type WorkRecord =
  | { t: "edited"; file: string }
```
with:
```ts
export type WorkRecord =
  | { t: "edited"; file: string }
  | { t: "accessed"; agent: string; file: string }
```

Replace:
```ts
  disabled: Map<string, string>
}
```
(the end of `WorkState`) with:
```ts
  disabled: Map<string, string>
  /** Files each agent read or edited, unique, least recently accessed first (§9 reset). */
  accessed: Map<string, string[]>
}
```

Replace:
```ts
  return { edited: [], stopBlocks: new Map(), disabled: new Map() }
```
with:
```ts
  return { edited: [], stopBlocks: new Map(), disabled: new Map(), accessed: new Map() }
```

In `foldWork`, after the `case "edited":` clause:
```ts
      case "edited":
        state.edited = [...state.edited.filter((file) => file !== record.file), record.file]
        break
```
add:
```ts
      case "accessed": {
        const files = state.accessed.get(record.agent) ?? []
        state.accessed.set(record.agent, [...files.filter((file) => file !== record.file), record.file])
        break
      }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/session/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pipeline tests**

`test/core/pipeline-reset.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import type { Delivery, EventKind } from "../../src/core/types"
import { emptyDelivery } from "../../src/core/types"
import { createFixture } from "../helpers/fixture"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"
const SERVICES = {
  ref: "conventions/backend.md#services",
  state: "full",
  content: "## Services\nBusiness logic lives in services.",
}

async function scenario(restoredFiles = 5) {
  const root = await createFixture()
  const send = async (kind: EventKind, files: string[] = [], agentId?: string): Promise<Delivery> => {
    const session = agentId === undefined ? { id: "s1" } : { id: "s1", agentId }
    const extra = kind === "touch" ? { completeRead: true } : {}
    const result = await pipelineAt(root, { kind, files, cwd: root, session, ...extra }, { restoredFiles })
    return result.delivery
  }
  return { root, send }
}

describe("reset re-delivers touch context", () => {
  test("for files the agent read before compaction", async () => {
    const { send } = await scenario()
    expect((await send("touch", [USERS])).touches).toEqual(["backend/services"])
    const reset = await send("reset")
    expect(reset.touches).toEqual(["backend/services"])
    expect(reset.references).toEqual([SERVICES])
    // Delivered again, so recorded again: the next touch finds it covered.
    expect((await send("touch", [USERS])).touches).toEqual([])
  })

  test("for files the agent edited", async () => {
    const { send } = await scenario()
    await send("edit", [USERS])
    expect((await send("reset")).touches).toEqual(["backend/services"])
  })

  test("only for the most recent restoredFiles files", async () => {
    const { send } = await scenario(5)
    await send("touch", [USERS])
    for (let i = 1; i <= 5; i++) await send("touch", [`docs/note-${i}.md`])
    const reset = await send("reset")
    expect(reset.touches).toEqual([])
    expect(reset.references).toEqual([])
  })

  test("not for files a subagent accessed", async () => {
    const { send } = await scenario()
    await send("touch", [USERS], "sub1")
    expect(await send("reset")).toEqual(emptyDelivery())
    // The subagent's own reset restores its own files.
    expect((await send("reset", [], "sub1")).touches).toEqual(["backend/services"])
  })

  test("never when the adapter restores no files", async () => {
    const { send } = await scenario(0)
    await send("touch", [USERS])
    expect(await send("reset")).toEqual(emptyDelivery())
    // Context memory was still cleared.
    expect((await send("touch", [USERS])).touches).toEqual(["backend/services"])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run test/core/pipeline-reset.test.ts`
Expected: FAIL: `restoredFiles` is not a `PipelineOptions` key (type error in the editor), and at runtime the first reset returns an empty delivery (`touches: []`).

- [ ] **Step 7: Implement reset re-delivery in the pipeline**

In `src/core/pipeline.ts`, add to `PipelineOptions`, after `maxContextChars`:
```ts
  /** Recently accessed files the agent re-attaches after compaction (adapter.restoredFiles); reset re-delivers their touch context. */
  restoredFiles?: number
```

Replace the prompt/reset early return:
```ts
  if (event.kind === "prompt" || event.kind === "reset") {
    if (session && event.kind === "prompt") await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    if (session && event.kind === "reset") await appendContext(session.dir, session.agent, [{ t: "reset" }])
    return { delivery: emptyDelivery(), failed, deadlineMissed }
  }
```
with:
```ts
  const restoredFiles = options.restoredFiles ?? 0
  if (event.kind === "prompt") {
    if (session) await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    return { delivery: emptyDelivery(), failed, deadlineMissed }
  }
  if (event.kind === "reset") {
    if (session) await appendContext(session.dir, session.agent, [{ t: "reset" }])
    // Without re-attached files there is nothing to re-deliver (§9 reset).
    if (!session || restoredFiles === 0) return { delivery: emptyDelivery(), failed, deadlineMissed }
  }
```

Replace the start of the baseline block:
```ts
  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  if (session) {
```
with:
```ts
  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  // A reset only delivers touch context: no snapshots, and it does not start the session.
  if (session && event.kind !== "reset") {
```

Replace the touch selection:
```ts
  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
  }
```
with:
```ts
  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
    if (session) {
      // Every file counts, not only files rules match: the agent's harness picks re-attached files from all of them.
      await appendWork(
        session.dir,
        event.files.map((file) => ({ t: "accessed" as const, agent: session.agent, file })),
      )
    }
  }

  if (event.kind === "reset" && session) {
    // view.context is empty: the reset record was appended above. Newest first, as the harness re-attaches them.
    const recent = (view.work.accessed.get(session.agent) ?? []).slice(-restoredFiles).reverse()
    touches = selectTouchRules(project.rules, recent, view.context.touched, disabled)
  }
```

Nothing else changes: a reset has no findings and no complete read, the stop gate only runs for `verify`, and `commitSession` records the touches and delivered references after the reset record, so later events see them as covered.

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run test/core/pipeline-reset.test.ts test/core/pipeline-session.test.ts test/core/session`
Expected: PASS. `pipeline-session`'s existing reset test passes no `restoredFiles`, so its reset still delivers nothing.

- [ ] **Step 9: Write the failing adapter tests**

In `test/adapters/claude-code/format.test.ts`, add inside the `describe` block, before `the budget handed to commit stays under the limit`:
```ts
  test("a reset delivers the restored conventions as SessionStart additional context", () => {
    const value = delivery({
      touches: ["backend/services"],
      references: [{ ref: "conventions/backend.md#services", state: "full", content: "## Services\nBusiness logic." }],
    })
    expect(JSON.parse(format(value, "reset").stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: renderAgentText(value, options) },
    })
  })

  test("reset output is held to the same limit", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const output = JSON.parse(format(delivery({ findings }), "reset", { maxMatchesPerRule: 1000 }).stdout)
    expect(output.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
  })

  test("Claude Code re-attaches the 5 most recently accessed files after compaction", () => {
    expect(claudeCodeAdapter.restoredFiles).toBe(5)
  })
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm vitest run test/adapters/claude-code/format.test.ts`
Expected: FAIL: `format(value, "reset")` returns `{ stdout: "" }` (`JSON.parse("")` throws), and `restoredFiles` is undefined.

- [ ] **Step 11: Add `restoredFiles` to adapters and format resets**

In `src/core/types.ts`, in `interface Adapter`, after `maxContextChars`:
```ts
  /** Recently read or edited files the agent re-attaches to its context after compaction; reset re-delivers their touch context (§9). 0 = none. */
  restoredFiles: number
```

In `src/adapters/claude-code/adapter.ts`, in `claudeCodeAdapter`, after `maxContextChars: CONTEXT_BUDGET,`:
```ts
  /** Recorded from 2.1.278: /compact re-attaches the 5 most recently read, edited or written files. */
  restoredFiles: 5,
```

In `format` (as Task 13 wrote it), replace:
```ts
      case "touch":
      case "edit":
        return json({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text, event) },
        })
```
with:
```ts
      case "touch":
      case "edit":
        return json({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text, event) },
        })
      case "reset":
        return json({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: withinLimit(text, event) },
        })
```

Run `pnpm typecheck`. `claudeCodeAdapter` is the only `Adapter` object in `src/` and `test/` (no test defines its own), so nothing else needs `restoredFiles`.

- [ ] **Step 12: Pass `restoredFiles` from the hook**

In `src/commands/hook.ts`, in `handleEvent`, add to the options object passed to `runPipeline` (next to `maxContextChars: adapter.maxContextChars,`):
```ts
    restoredFiles: adapter.restoredFiles,
```

- [ ] **Step 13: Write the hook test with recorded payloads**

`test/commands/hook-compaction.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { claudeCodePayload } from "../helpers/payloads"

const USERS = "app/services/users.py"

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

describe("rulecast hook claude-code: compaction", () => {
  test("SessionStart compact re-delivers the touch conventions of a file read before it", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    const compact = await hook(root, "session-start.compact")
    expect(compact.code).toBe(0)
    const output = JSON.parse(compact.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart")
    expect(output.hookSpecificOutput.additionalContext).toContain(
      "--- conventions/backend.md#services ---\n## Services\nBusiness logic lives in services.",
    )
  })

  test("a file the agent edited is restored too", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), "def get():\n    return None\n")
    await hook(root, "post-tool-use.edit", USERS)
    const output = JSON.parse((await hook(root, "session-start.compact")).stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain("--- conventions/backend.md#services ---")
  })

  test("nothing accessed, or accessed only by a subagent: compaction prints nothing", async () => {
    const root = await createFixture()
    expect(await hook(root, "session-start.compact")).toMatchObject({ code: 0, stdout: "" })
    await hook(root, "post-tool-use.read.subagent", USERS)
    expect(await hook(root, "session-start.compact")).toMatchObject({ code: 0, stdout: "" })
  })
})
```

- [ ] **Step 14: Run the new and affected tests**

Run: `pnpm vitest run test/commands/hook-compaction.test.ts test/adapters/claude-code test/commands/hook.test.ts`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add packages/rulecast/src/core/session/state.ts packages/rulecast/src/core/types.ts packages/rulecast/src/core/pipeline.ts packages/rulecast/src/adapters/claude-code/adapter.ts packages/rulecast/src/commands/hook.ts packages/rulecast/test/core/session/state.test.ts packages/rulecast/test/core/pipeline-reset.test.ts packages/rulecast/test/adapters/claude-code/format.test.ts packages/rulecast/test/commands/hook-compaction.test.ts
git commit -m "feat: re-deliver touch context for files re-attached after compaction

Work memory records every file each agent reads or edits. Adapters
declare how many recent files their agent re-attaches after compaction
(Claude Code: 5); a reset clears context memory and delivers the touch
context of those files, as SessionStart additionalContext in Claude Code.

Claude goes brr.. via Dash"
```

---

### Task 19: Public API, usage, perf and the end-to-end run

**Files:**
- Modify: `src/index.ts`, `test/smoke.test.ts`, `src/commands/main.ts` (only if the usage test fails), `docs/plans/2026-09-15-rulecast-00-index.md`
- Test: `test/commands/help.test.ts` (new)

- [ ] **Step 1: Write the failing export test**

In `test/smoke.test.ts`, add at the end:
```ts
test("package entry exports the compile, rule repo and cache API", () => {
  for (const name of [
    "compile",
    "compileManifest",
    "cachedRepos",
    "fetchingRepos",
    "cacheHome",
    "projectStateDir",
    "runPipeline",
    "adapterByName",
  ] as const) {
    expect(rulecast[name]).toBeTypeOf("function")
  }
  expect(rulecast.CONFIG_FILE).toBe(".rulecast-config.yaml")
  expect(rulecast.MANIFEST_FILE).toBe(".rulecast-rules.yaml")
  expect(rulecast.VERSION).toMatch(/^\d+\.\d+\.\d+$/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/smoke.test.ts`
Expected: FAIL: `cacheHome` is undefined on the package entry (so are `projectStateDir`, `adapterByName`, `CONFIG_FILE`, `MANIFEST_FILE` and `VERSION`; Task 10 already exports `compile`, `compileManifest` and the repo providers), and TypeScript reports the missing properties.

- [ ] **Step 3: Replace the package entry**

Replace the whole of `src/index.ts` with:
```ts
export { claudeCodeAdapter } from "./adapters/claude-code/adapter"
export { ADAPTERS, adapterByName } from "./adapters/index"
export { type CompiledProject, type CompileOptions, compile, compileManifest, type Diagnostic } from "./core/compile/project"
export type { CompiledDetector, CompiledRule } from "./core/compile/rule"
export { CONFIG_FILE, MANIFEST_FILE } from "./core/config/load"
export type { Config, RuleEntry, Stage } from "./core/config/schema"
export { renderAgentText } from "./core/delivery/render-agent"
export { perRule } from "./core/detection/per-rule"
export { createRegistry, type DetectorRegistry } from "./core/detection/registry"
export { cacheHome, type Env, projectStateDir } from "./core/home"
export { type PipelineOptions, type PipelineResult, runPipeline } from "./core/pipeline"
export { type Checkout, cachedRepos, fetchingRepos, fixedRepo, type RepoProvider } from "./core/repos/provider"
export type * from "./core/types"
export { emptyDelivery } from "./core/types"
export { VERSION } from "./core/version"
export { builtinDetectors } from "./detectors"
```

biome's organizeImports may reorder these lines on commit; that is fine.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/smoke.test.ts && pnpm typecheck`
Expected: PASS. If `export type *` clashes with a named export (TypeScript: "Module … has already exported a member named …"), a type moved between modules in tasks 10–18; drop the duplicate named type export.

- [ ] **Step 5: Pin the usage text**

`test/commands/help.test.ts`:
```ts
import { expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const USAGE = `usage:
  rulecast init
  rulecast install [--agent <name>]... [--scope shared|personal]
  rulecast uninstall [--agent <name>]...
  rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast autoupdate [--freeze] [--repo URL]...
  rulecast try-repo <path|url> [RULE_ID] [--ref REV] [run flags]
  rulecast validate [file...]
  rulecast clean [--project]
  rulecast hook <adapter>
  rulecast warm [--detector <kind>]...
`

test("help prints every command", async () => {
  const cwd = await createProject({})
  expect(await runCli(cwd, ["help"])).toMatchObject({ code: 0, stdout: USAGE })
})

test("no command prints usage and exits 2", async () => {
  const cwd = await createProject({})
  expect(await runCli(cwd, [])).toMatchObject({ code: 2, stdout: USAGE })
})

test("check is gone", async () => {
  const cwd = await createProject({})
  const result = await runCli(cwd, ["check"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain('unknown command "check"')
})
```

Run: `pnpm vitest run test/commands/help.test.ts`
Expected: PASS. If the usage differs, tasks 11–16 each added one line; make `USAGE` in `src/commands/main.ts` equal the test's text exactly (the test's text is the spec's command table) and rerun.

- [ ] **Step 6: Run the whole suite and the perf test**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

Run: `pnpm test:perf`
Expected: PASS, printing `edit hook: p50 … ms, p95 … ms`. Plan 2 measured p50 111 ms, p95 118 ms on an Apple M3 Pro; compile now reads one YAML file instead of 30 rule files but also hashes the realpath of the project root, so the numbers should be close. If p95 is 500 ms or more, or more than 50 ms above plan 2's, stop and use the systematic-debugging skill: time `node dist/cli.js help`, then compile, then detection, before changing anything.

- [ ] **Step 7: Run the end-to-end verification below**

Work through "End-to-end verification" at the end of this document by hand. Every step states its expected result; if one differs, fix the cause (with a test) before continuing.

- [ ] **Step 8: Mark plan 3 done**

In `docs/plans/2026-09-15-rulecast-00-index.md`, in row 3 (pre-commit-style config and rule repos), replace the status cell's leading `Written` with `Done (<today's date, YYYY-MM-DD>)`, keep the list of parts, and append `; edit hook p50 <n> ms, p95 <n> ms on <machine>` with Step 6's numbers.

- [ ] **Step 9: Commit and push**

```bash
git add packages/rulecast/src/index.ts packages/rulecast/test/smoke.test.ts packages/rulecast/test/commands/help.test.ts docs/plans/2026-09-15-rulecast-00-index.md
git commit -m "feat: export the compile, rule repo and cache API; finish plan 3

Claude goes brr.. via Dash"
git fetch origin
git push origin main
```

Add `packages/rulecast/src/commands/main.ts` to the `git add` if Step 5 changed it. If `git fetch` shows `main` moved, rebase is not allowed here (other sessions share the working tree): stop and ask the user how to integrate.

---

## End-to-end verification

A person can follow this in a scratch directory; nothing touches real projects or the real cache. Run it after Task 19 Step 6.

```bash
# 0. Build, and keep everything in one scratch directory with its own cache.
pnpm build
export RULECAST=$PWD/packages/rulecast/dist/cli.js
export PAYLOADS=$PWD/packages/rulecast/test/payloads/claude-code
export SCRATCH=$(mktemp -d)
export RULECAST_HOME=$SCRATCH/home
cd "$SCRATCH"

# 1. A rule repo with one rule and its doc, tagged v1.0.0, published as a bare repo.
mkdir rules && cd rules && git init -q -b main
mkdir docs && printf '# Python\n\n## Errors\n\nServices raise domain exceptions.\n' > docs/python.md
cat > .rulecast-rules.yaml <<'EOF'
- id: python/no-print
  name: No print calls
  files: \.py$
  detect:
    regex: { pattern: 'print\((?<args>[^)]*)\)' }
  message: "{{file}}:{{line}} prints {{args}}. Use the logger."
  context: ["@docs/python.md#errors"]
EOF
git add -A && git commit -qm v1 && git tag v1.0.0 && cd ..
git clone -q --bare rules rules.git

# 2. A project pinning it, with a local touch rule.
mkdir project && cd project && git init -q -b main
printf '# Agents\n\n## Services\n\nServices hold business logic.\n' > AGENTS.md
mkdir -p app/services && printf 'def get():\n    return 1\n' > app/services/users.py
cat > .rulecast-config.yaml <<EOF
# Project conventions for agents.
repos:
  - repo: $SCRATCH/rules.git
    rev: v1.0.0   # first release
    rules:
      - id: python/no-print
  - repo: local
    rules:
      - id: local/services
        name: Service conventions
        files: ^app/services/
        stages: [touch]
        context: ["@AGENTS.md#services"]
EOF
git add -A && git commit -qm init
```

| # | Command (in `$SCRATCH/project`) | Expected |
|---|---|---|
| 3 | `node $RULECAST install` | exit 0; `.claude/settings.json` has six rulecast hook groups; prints `fetched rules@v1.0.0`; `$RULECAST_HOME/repos/local_rules_<8 hex>/v1.0.0/.rulecast-rules.yaml` exists |
| 4 | `node $RULECAST validate` | exit 0; `.rulecast-config.yaml: 2 rules valid` |
| 5 | `printf 'def get():\n    print(1)\n' > app/services/users.py && node $RULECAST run --all-files --format agent; echo $?` | the finding `app/services/users.py:2 prints 1. Use the logger.`, the section `--- rules@v1.0.0:docs/python.md#errors ---`, exit code `1` |
| 6 | `node $RULECAST run; echo $?` | no staged files: `no findings`, exit `0` |
| 7 | `git add app/services/users.py && node $RULECAST run; echo $?` | the staged file's finding, exit `1`; then `git reset -q app/services/users.py` |
| 8 | Read hook: `node -e 'const p=require(process.argv[1]);p.cwd=process.cwd();p.session_id="e2e";p.tool_input.file_path=process.cwd()+"/app/services/users.py";process.stdout.write(JSON.stringify(p))' $PAYLOADS/post-tool-use.read.complete.json \| node $RULECAST hook claude-code` | JSON with `hookSpecificOutput.additionalContext` containing `--- AGENTS.md#services ---` |
| 9 | Compaction: the same `node -e …` with `$PAYLOADS/session-start.compact.json` (it has no `tool_input`; drop that assignment) piped to `node $RULECAST hook claude-code` | JSON with `hookEventName: "SessionStart"` and `--- AGENTS.md#services ---` again |
| 10 | Stop: the same with `$PAYLOADS/stop.json` | `{"decision":"block","reason":"This project's rulecast rules (.rulecast-config.yaml) found problems…"}` naming `prints 1` |
| 11 | Missing repo: `RULECAST_HOME=$SCRATCH/empty-home` with step 8's command | the services context plus the warning `…/rules.git@v1.0.0: not in the cache (run rulecast install)`; `$SCRATCH/empty-home/repos` does not exist |
| 12 | Release v1.1.0: `(cd ../rules && echo '# v1.1' >> docs/python.md && git commit -qam v1.1 && git tag v1.1.0 && git push -q ../rules.git main --tags)` then `node $RULECAST autoupdate` | prints the update from `v1.0.0` to `v1.1.0`; `git diff .rulecast-config.yaml` shows only the `rev:` value changed, with `# first release` and the top comment intact |
| 13 | `node $RULECAST autoupdate --freeze` | `rev:` becomes the 40-hex commit of `v1.1.0` followed by `  # frozen: v1.1.0`; the `# first release` comment is replaced, nothing else changes |
| 14 | `node $RULECAST try-repo ../rules --all-files --format agent` | the same finding labelled `rules@working-tree:docs/python.md#errors`; `.rulecast-config.yaml` unchanged |
| 15 | `node $RULECAST uninstall` | removes exactly the six rulecast groups; any other hooks you added to `.claude/settings.json` by hand remain |
| 16 | `node $RULECAST clean --project` then `node $RULECAST clean` | `removed $RULECAST_HOME/projects/<16 hex>`, then `removed $RULECAST_HOME`; running `clean` again prints `nothing to clean` |

Optional, with Claude Code installed: in `$SCRATCH/project` run `node $RULECAST install`, start `claude`, ask it to read `app/services/users.py`, add a `print` call, run `/compact`, and ask what the service conventions say. The answer should quote `Services hold business logic.` from the post-compaction `SessionStart` context. Remove the scratch directory afterwards with `rm -rf "$SCRATCH"`.
