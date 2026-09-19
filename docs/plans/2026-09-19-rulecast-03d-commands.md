# rulecast Plan 3d — `run`, `validate`, `install`, `autoupdate`, `try-repo` and `clean` Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pre-commit-style command set on top of the new config format: `rulecast run` (replacing `check`), `validate [file…]`, `install`/`uninstall` with an adapter install interface, an interim non-interactive `init`, `autoupdate`, `try-repo` and `clean`.

**Architecture:** Every command compiles the project with `compile({ root, registry, repos })` (Task 9) and, where it verifies code, hands the compiled project to `runPipeline` (Task 10). `run` owns file selection (explicit files, ref ranges, all files, the session's edited files, staged files) and turns `--from-ref` into a `baseCommit` the pipeline reads the baseline from. The pipeline gains two options: `stopGate` (only agent stops decide block/allow) and `onlyRules` (`run RULE_ID`). Adapters describe how their hooks are installed (`AdapterInstall`); `install`/`uninstall` only drive that interface. `autoupdate` rewrites `rev` values through the YAML CST so every other byte of the config stays as written. `try-repo` compiles a synthetic config whose single repo resolves to a directory, then reuses `run`'s execution. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3 (`AdapterInstall`), §4 (repo entries), §12 (CLI, `run` file selection, Claude Code adapter, cache and state), §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, zod 3, yaml 2 (CST ranges), vitest, git.

Prerequisite: `2026-09-19-rulecast-03c-compile.md` is done (tasks 1–10). Continue with `2026-09-19-rulecast-03e-repos-compaction.md` afterwards.

---

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME` (from Task 6 on).
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths in **Files:** lists are relative to `packages/rulecast/`; `git add` paths are relative to the repository root.

| File | Responsibility |
|---|---|
| `src/commands/usage.ts` | `UsageError` (moved out of `check.ts`) |
| `src/commands/run.ts` | `rulecast run`: argument parsing, file selection, execution (reused by `try-repo`) |
| `src/commands/check.ts` | Deleted |
| `src/core/types.ts` | `Event.baseCommit`; `InstallScope`, `AdapterInstall`, `Adapter.label`, `Adapter.install` |
| `src/core/pipeline.ts` | `baseCommit`, `stopGate`, `onlyRules` |
| `src/commands/hook.ts` | Passes `stopGate`; finds adapters through `adapters/index.ts` |
| `src/adapters/claude-code/adapter.ts` | Cut pointer names `rulecast run`; install metadata |
| `src/adapters/claude-code/settings.ts` | `mergeHooks`, new `removeHooks` |
| `src/adapters/index.ts` | `ADAPTERS`, `adapterByName` |
| `src/commands/validate.ts` | `rulecast validate [file…]` by filename |
| `src/commands/install.ts` | `installHooks`, `uninstallHooks`, `rulecast install`, `rulecast uninstall` |
| `src/commands/init.ts` | Task 10's interim `rulecast init` installs hooks through `installHooks` (plan 4 replaces it) |
| `src/core/config/edit.ts` | `setRevs`: rewrite `rev` values in config text |
| `src/commands/autoupdate.ts` | `rulecast autoupdate` |
| `src/commands/try-repo.ts` | `rulecast try-repo` |
| `src/commands/clean.ts` | `rulecast clean` |
| `src/commands/main.ts` | Dispatch and usage for every command above |

## Not in this plan

- **`autoupdate` does not check that selected rule ids still exist in the new rev.** pre-commit refuses such updates. Here the next `validate`, `run` or hook reports `not in the manifest` for the missing id. Add the check if that proves too late in practice.
- **`run` reads the working tree**, also for staged files. pre-commit stashes unstaged changes first; rulecast never modifies the working tree.

---

### Task 11: `rulecast run` replaces `check`

**Files:**
- Create: `src/commands/usage.ts`, `src/commands/run.ts`
- Delete: `src/commands/check.ts`
- Modify: `src/core/types.ts` (`Event.baseRef` → `baseCommit`), `src/core/pipeline.ts` (options `stopGate`, `onlyRules`; `baseCommit`), `src/core/baseline/baseline.ts` (comment), `src/commands/hook.ts` (`stopGate`), `src/commands/main.ts` (dispatch, usage), `src/adapters/claude-code/adapter.ts` (cut pointer), `package.json` (drop `tinyglobby`, which only `check` used)
- Test: create `test/commands/run.test.ts`; modify `test/core/pipeline-cli.test.ts`, `test/core/pipeline-session.test.ts`, `test/commands/main.test.ts`, `test/adapters/claude-code/format.test.ts`, `test/build.test.ts`

- [ ] **Step 1: Write the failing pipeline tests**

In `test/core/pipeline-cli.test.ts` (as Task 10 wrote it), in the "verify with a base ref classifies against the merge base" test, replace:
```ts
    const { delivery } = await pipelineAt(root, { kind: "verify", files: [USERS], baseRef: "main", cwd: root })
```
with:
```ts
    const { delivery } = await pipelineAt(root, {
      kind: "verify",
      files: [USERS],
      baseCommit: await mergeBase(root, "main"),
      cwd: root,
    })
```
Directly before the line `import { localConfig } from "../helpers/config"` add:
```ts
import { mergeBase } from "../../src/core/git"
```
Then append inside the `describe` block:
```ts
  test("onlyRules restricts detection to the named rules", async () => {
    const root = await createFixture()
    const { delivery } = await pipelineAt(
      root,
      { kind: "verify", files: [USERS, "src/client/api.ts"], cwd: root },
      { onlyRules: new Set(["frontend/no-generated-edits"]) },
    )
    expect(delivery.findings.map((finding) => finding.rule)).toEqual(["frontend/no-generated-edits"])
  })
```
(`pipelineAt` is already imported since Task 10).

In `test/core/pipeline-session.test.ts`, the scenario's `send` helper runs every event with the stop gate on, as the hook will (the option only affects verify events). In `scenario()`, replace:
```ts
    const result = await pipelineAt(root, { ...rest, cwd: root, session: { id: "s1", agentId } })
```
with:
```ts
    const result = await pipelineAt(root, { ...rest, cwd: root, session: { id: "s1", agentId } }, { stopGate: true })
```
Then append inside the `describe` block:
```ts
  test("without the stop gate a verify makes no stop decision and records no block", async () => {
    const { root, send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })
    const cli = await pipelineAt(root, { kind: "verify", files: [], cwd: root, session: { id: "s1" } })
    expect(cli.delivery.stop).toBeNull()
    expect(cli.delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect((await send({ kind: "verify", files: [] })).stop).toBe("block")
  })
```
(`scenario()` already returns `root`, `send` and `write`, and the file imports `pipelineAt`, since Task 10).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run test/core/pipeline-cli.test.ts test/core/pipeline-session.test.ts`
Expected: FAIL (vitest does not typecheck, so these are runtime failures): the pipeline ignores `baseCommit` (the merge-base test finds line 2 new as well), `onlyRules` is ignored (two findings), and the stop-gate test gets `"block"` instead of `null`.

- [ ] **Step 3: Pipeline options and `baseCommit`**

In `src/core/types.ts`, replace:
```ts
  /** verify from the CLI: --base. */
  baseRef?: string
```
with:
```ts
  /** verify from the CLI: the commit the baseline is read from (the merge base for --from-ref). */
  baseCommit?: string
```

In `src/core/pipeline.ts`, replace (in `PipelineOptions`):
```ts
  /** Detector kinds to skip entirely (check --no-llm). */
  skipDetectorKinds?: ReadonlySet<string>
```
with:
```ts
  /** Detector kinds to skip entirely (run --no-llm). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Run only these rules (rulecast run RULE_ID); touch rules are unaffected. */
  onlyRules?: ReadonlySet<string>
  /** verify from an agent's stop: decide block / allow / capReached. Needs a session. */
  stopGate?: boolean
```

Replace:
```ts
      if (event.baseRef) {
        fallbackCommit = await mergeBase(root, event.baseRef)
        snapshots = new Map()
      }
```
with:
```ts
      if (event.baseCommit) {
        fallbackCommit = event.baseCommit
        snapshots = new Map()
      }
```

Replace `if (event.kind === "verify" && session && !event.baseRef) {` with `if (event.kind === "verify" && session && !event.baseCommit) {`, and drop `mergeBase` from the `./git` import (it becomes `import { headCommit } from "./git"`).

Replace the selection filter:
```ts
    const selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector!.kind),
    )
```
with:
```ts
    const selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(
      (selection) =>
        !skip.has(selection.rule.detector!.kind) && (options.onlyRules?.has(selection.rule.id) ?? true),
    )
```

In `inputFor`, replace `stopGate: event.kind === "verify" && session !== null,` with:
```ts
    stopGate: options.stopGate === true && event.kind === "verify" && session !== null,
```

In `src/core/baseline/baseline.ts`, replace the stale comment:
```ts
  /** Session-start commit (hooks) or merge base (check --base); null for none. */
```
with:
```ts
  /** Session-start commit (hooks) or merge base (run --from-ref); null for none. */
```

In `src/commands/hook.ts`, add `stopGate: projectEvent.kind === "verify",` to the `runPipeline({ … })` call in `handleEvent`, after `maxContextChars: adapter.maxContextChars,`.

- [ ] **Step 4: Run the pipeline tests**

Run: `pnpm vitest run test/core/pipeline-cli.test.ts test/core/pipeline-session.test.ts test/commands/hook.test.ts`
Expected: PASS. `check.ts` still passes `baseRef`, so `pnpm typecheck` fails until Step 7 deletes it; don't commit before then.

- [ ] **Step 5: Write the failing `run` tests**

`test/commands/run.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { git } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

const run = (cwd: string, ...argv: string[]) => runCli(cwd, ["run", ...argv])
const lines = (stdout: string) => JSON.parse(stdout).findings.map((finding: { line: number }) => finding.line)

describe("rulecast run: file selection", () => {
  test("--all-files checks every file git knows about", async () => {
    const root = await createFixture()
    const result = await run(root, "--all-files")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("app/services/users.py:2:5  error    backend/no-httpexception")
    expect(result.stdout).toContain("src/client/api.ts:1:1  warning  frontend/no-generated-edits")
    expect(result.stdout.trimEnd().endsWith("1 error, 1 warning")).toBe(true)
  })

  test("without flags only staged files are checked", async () => {
    const root = await createFixture()
    expect(await run(root)).toMatchObject({ code: 0, stdout: "no findings\n" })
    await writeFile(path.join(root, USERS), VIOLATION)
    expect((await run(root)).stdout).toBe("no findings\n")
    await git(root, "add", USERS)
    const result = await run(root, "--format", "json")
    expect(result.code).toBe(1)
    // No baseline without --from-ref or --session: every finding is new.
    expect(lines(result.stdout)).toEqual([2, 3])
  })

  test("--files resolves paths relative to the current directory", async () => {
    const root = await createFixture()
    const result = await run(path.join(root, "src"), "--files", "client/api.ts", "--format", "json")
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "frontend/no-generated-edits",
    ])
  })

  test("--from-ref checks files changed since the merge base, classified against it", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    expect((await run(root, "--from-ref", "main")).stdout).toBe("no findings\n")

    await writeFile(path.join(root, USERS), VIOLATION)
    const uncommitted = await run(root, "--from-ref", "main", "--format", "json")
    expect(uncommitted.code).toBe(1)
    expect(lines(uncommitted.stdout)).toEqual([3])
    expect(JSON.parse(uncommitted.stdout).preexistingSummary).toEqual([
      { rule: "backend/no-httpexception", file: USERS, count: 1 },
    ])

    await git(root, "commit", "-qam", "change")
    expect(lines((await run(root, "--from-ref", "main", "--to-ref", "feature", "--format", "json")).stdout)).toEqual([3])
    expect((await run(root, "--from-ref", "main", "--to-ref", "main")).stdout).toBe("no findings\n")
  })

  test("--session verifies the session's edited files without deciding a stop", async () => {
    const root = await createFixture()
    expect((await run(root, "--session", "s1")).stdout).toBe("no findings\n")
    await writeFile(path.join(root, USERS), VIOLATION)
    await pipelineAt(root, { kind: "edit", files: [USERS], cwd: root, session: { id: "s1" } })

    const result = await run(root, "--session", "s1", "--format", "json")
    expect(result.code).toBe(1)
    expect(lines(result.stdout)).toEqual([3])
    expect(JSON.parse(result.stdout).stop).toBeNull()
    // The CLI run did not use up the agent's stop block.
    const stop = await pipelineAt(root, { kind: "verify", files: [], cwd: root, session: { id: "s1" } }, { stopGate: true })
    expect(stop.delivery.stop).toBe("block")
  })
})

describe("rulecast run: rules and errors", () => {
  test("RULE_ID runs only that rule", async () => {
    const root = await createFixture()
    const result = await run(root, "backend/no-httpexception", "--all-files", "--format", "json")
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "backend/no-httpexception",
    ])
    const unknown = await run(root, "nope", "--all-files")
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('no rule "nope" (see rulecast validate)')
  })

  test.each([
    [["--format", "xml"], 'unknown format "xml"'],
    [["--to-ref", "main"], "--to-ref needs --from-ref"],
    [["--all-files", "--files", "a.py"], "--all-files and --files cannot be combined"],
    [["--from-ref", "main", "--all-files"], "--from-ref cannot be combined with --all-files or --files"],
    [["--files"], "--files needs at least one file"],
    [["--ref", "v1"], "--ref only applies to try-repo"],
    [["a", "b"], "unexpected arguments: b"],
    [["--from-ref", "nope"], "nope"],
  ])("usage problems exit 2: %j", async (argv, message) => {
    const root = await createFixture()
    const result = await run(root, ...argv)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(message)
  })

  test("outside a project run fails", async () => {
    const root = await createProject({})
    const result = await run(root, "--all-files")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run test/commands/run.test.ts`
Expected: FAIL: every test exits 2 with `unknown command "run"`.

- [ ] **Step 7: Implement `run`, remove `check`**

`src/commands/usage.ts`:
```ts
/** A command was called wrongly; main prints the usage text after the message. */
export class UsageError extends Error {}
```

`src/commands/run.ts`:
```ts
import { parseArgs } from "node:util"

import { CLI_FORMATS, type CliFormat, exitCodeFor, formatDelivery } from "../adapters/cli/format"
import { type CompiledProject, compile } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { allFiles, changedFilesBetween, changedFilesSince, mergeBase, stagedFiles } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"
import { UsageError } from "./usage"

export interface RunArgs {
  /** Positionals before --files: RULE_ID for run; the repository and RULE_ID for try-repo. */
  leading: string[]
  /** The paths after --files, as given; null without --files. */
  files: string[] | null
  allFiles: boolean
  fromRef: string | null
  toRef: string | null
  format: CliFormat
  session: string | null
  noLlm: boolean
  /** --ref: try-repo only. */
  ref: string | null
}

/** Parses run's flags. Positionals after `--files` are files, like pre-commit's `--files F…`. */
export function parseRunArgs(args: string[]): RunArgs {
  const { values, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      files: { type: "boolean", default: false },
      "all-files": { type: "boolean", default: false },
      "from-ref": { type: "string" },
      "to-ref": { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
      ref: { type: "string" },
    },
  })
  const format = values.format as CliFormat
  if (!CLI_FORMATS.includes(format)) {
    throw new UsageError(`unknown format "${values.format}" (use ${CLI_FORMATS.join(", ")})`)
  }

  let filesAt = Number.POSITIVE_INFINITY
  for (const token of tokens) {
    if (token.kind === "option" && token.name === "files") filesAt = Math.min(filesAt, token.index)
  }
  const leading: string[] = []
  const files: string[] = []
  for (const token of tokens) {
    if (token.kind !== "positional") continue
    if (token.index > filesAt) files.push(token.value)
    else leading.push(token.value)
  }

  const fromRef = values["from-ref"] ?? null
  const toRef = values["to-ref"] ?? null
  if (values.files && files.length === 0) throw new UsageError("--files needs at least one file")
  if (values.files && values["all-files"]) throw new UsageError("--all-files and --files cannot be combined")
  if (toRef !== null && fromRef === null) throw new UsageError("--to-ref needs --from-ref")
  if (fromRef !== null && (values.files || values["all-files"])) {
    throw new UsageError("--from-ref cannot be combined with --all-files or --files")
  }
  return {
    leading,
    files: values.files ? files : null,
    allFiles: values["all-files"],
    fromRef,
    toRef,
    format,
    session: values.session ?? null,
    noLlm: values["no-llm"],
    ref: values.ref ?? null,
  }
}

interface SelectedFiles {
  files: string[]
  /** Where the baseline is read from; null: no baseline (or the session's). */
  baseCommit: string | null
}

/** Spec §12, `run` file selection. */
async function selectFiles(root: string, cwd: string, run: RunArgs): Promise<SelectedFiles> {
  if (run.files !== null) {
    const files = run.files.map((file) => toProjectPath(root, cwd, file)).filter((file): file is string => file !== null)
    return { files, baseCommit: null }
  }
  if (run.fromRef !== null) {
    const base = await mergeBase(root, run.fromRef, run.toRef ?? "HEAD")
    const files =
      run.toRef === null ? await changedFilesSince(root, base) : await changedFilesBetween(root, base, run.toRef)
    return { files, baseCommit: base }
  }
  if (run.allFiles) return { files: await allFiles(root), baseCommit: null }
  // With a session and no files, the pipeline verifies the session's edited files, as a Stop does.
  if (run.session !== null) return { files: [], baseCommit: null }
  return { files: await stagedFiles(root), baseCommit: null }
}

export interface RunInput {
  project: CompiledProject
  /** Run only this rule; null: every rule. */
  ruleId: string | null
  run: RunArgs
  registry: DetectorRegistry
  io: CliIo
}

/** A verify event over the selected files, printed in the chosen format. Shared by run and try-repo. */
export async function executeRun({ project, ruleId, run, registry, io }: RunInput): Promise<number> {
  const root = project.root
  if (ruleId !== null && !project.rules.some((rule) => rule.id === ruleId)) {
    throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
  }
  const selected = await selectFiles(root, io.cwd, run)
  const result = await runPipeline({
    project,
    stateDir: ensureProjectState(cacheHome(io.env), root),
    event: {
      kind: "verify",
      files: selected.files,
      baseCommit: selected.baseCommit ?? undefined,
      session: run.session === null ? undefined : { id: run.session },
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: run.noLlm ? new Set(["llm"]) : undefined,
    onlyRules: ruleId === null ? undefined : new Set([ruleId]),
  })
  const text = formatDelivery(result.delivery, run.format, { maxMatchesPerRule: project.config.maxMatchesPerRule })
  if (text) io.stdout(`${text}\n`)
  return exitCodeFor(result.delivery, result.failed)
}

export async function runCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const run = parseRunArgs(args)
  if (run.ref !== null) throw new UsageError("--ref only applies to try-repo")
  if (run.leading.length > 1) throw new UsageError(`unexpected arguments: ${run.leading.slice(1).join(" ")}`)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  return executeRun({ project, ruleId: run.leading[0] ?? null, run, registry, io })
}
```

Delete `src/commands/check.ts` and the glob library only it used:
```bash
git rm packages/rulecast/src/commands/check.ts
pnpm --filter @syv-ai/rulecast remove tinyglobby
```

Run: `grep -rn "tinyglobby\|commands/check\|from \"./check\"" packages/rulecast/src packages/rulecast/test`
Expected: only the `main.ts` import that the next edit replaces.

In `src/commands/main.ts`:
- replace the import `import { checkCommand, UsageError } from "./check"` with `import { runCommand } from "./run"` and `import { UsageError } from "./usage"`;
- replace the `case "check":` branch with:
  ```ts
      case "run":
        return await runCommand(root, args, registry, io)
  ```
- replace the `USAGE` constant with:
  ```ts
  const USAGE = `usage:
    rulecast init
    rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
    rulecast validate
    rulecast hook <adapter>
    rulecast warm [--detector <kind>]...
  `
  ```

- [ ] **Step 8: Point the Claude Code cut at `rulecast run`**

In `src/adapters/claude-code/adapter.ts`, add `Event` to the type import (`import type { Adapter, Event } from "../../core/types"`) and replace:
```ts
const CUT = "\n\n…cut to fit Claude Code's hook output limit. Run `rulecast check --format agent` for the full list."

/** Only findings can push text past the limit: commit keeps references within the budget. */
function withinLimit(text: string): string {
  return text.length <= CONTEXT_LIMIT ? text : text.slice(0, CONTEXT_LIMIT - CUT.length) + CUT
}
```
with:
```ts
/** Where the rest of a cut delivery can be read: the session's findings, from the CLI. */
function cutNotice(event: Event): string {
  const session = event.session ? `--session ${event.session.id} ` : ""
  return `\n\n…cut to fit Claude Code's hook output limit. Run \`rulecast run ${session}--format agent\` for the full list.`
}

/** Only findings can push text past the limit: commit keeps references within the budget. */
function withinLimit(text: string, event: Event): string {
  if (text.length <= CONTEXT_LIMIT) return text
  const notice = cutNotice(event)
  return text.slice(0, CONTEXT_LIMIT - notice.length) + notice
}
```
and pass `event` as the second argument at the three `withinLimit(…)` call sites in `format`.

In `test/adapters/claude-code/format.test.ts`, rename the test "output longer than Claude Code's limit is cut with a pointer to rulecast check" to "output longer than Claude Code's limit is cut with a pointer to rulecast run", replace its regex with:
```ts
      expect(text).toMatch(/Run `rulecast run --session s1 --format agent` for the full list\.$/)
```
and append inside the `describe` block:
```ts
  test("without a session the cut points at a plain rulecast run", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `app/services/users.py:${i + 1} ${"x".repeat(60)}` }),
    )
    const output = claudeCodeAdapter.format(
      delivery({ findings }),
      { kind: "edit", files: [], cwd: "/project" },
      { maxMatchesPerRule: 1000 },
    )
    expect(JSON.parse(output.stdout).hookSpecificOutput.additionalContext).toMatch(
      /Run `rulecast run --format agent` for the full list\.$/,
    )
  })
```

- [ ] **Step 9: Move the remaining `check` users to `run`**

Replace `test/commands/main.test.ts` with the file below: Task 10's version without the three `check` tests and the two `check` lines of "usage errors exit 2" (`test/commands/run.test.ts` covers them all), and without the `git` import they alone used:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"

async function run(cwd: string, ...argv: string[]) {
  const { code, stdout, stderr } = await runCli(cwd, argv)
  return { code, stdout, stderr }
}

describe("rulecast CLI", () => {
  test("validate reports rule count, or diagnostics with exit 2", async () => {
    const root = await createFixture()
    expect(await run(root, "validate")).toEqual({ code: 0, stdout: "rulecast: 3 rules valid\n", stderr: "" })
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([...fixtureRules, { id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    )
    expect(await run(root, "validate")).toEqual({
      code: 2,
      stdout: '.rulecast-config.yaml (broken): unknown detector "nope"\n',
      stderr: "",
    })
  })

  test("usage errors exit 2", async () => {
    const root = await createFixture()
    expect((await run(root, "frobnicate")).code).toBe(2)
  })
})
```

In `test/build.test.ts`, rename the test "built CLI runs check in a project" to "built CLI runs rulecast run in a project" and replace `[cli, "check", "--format", "agent"]` with `[cli, "run", "--all-files", "--format", "agent"]`.

- [ ] **Step 10: Run the tests**

Run: `pnpm vitest run test/commands/run.test.ts test/commands/main.test.ts test/adapters/claude-code/format.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS (the build test builds `dist/` and runs `run --all-files`).

- [ ] **Step 11: Commit**

```bash
git add packages/rulecast/src/commands/usage.ts packages/rulecast/src/commands/run.ts packages/rulecast/src/commands/main.ts packages/rulecast/src/commands/hook.ts packages/rulecast/src/core/types.ts packages/rulecast/src/core/pipeline.ts packages/rulecast/src/core/baseline/baseline.ts packages/rulecast/src/adapters/claude-code/adapter.ts packages/rulecast/package.json pnpm-lock.yaml packages/rulecast/test/commands/run.test.ts packages/rulecast/test/commands/main.test.ts packages/rulecast/test/core/pipeline-cli.test.ts packages/rulecast/test/core/pipeline-session.test.ts packages/rulecast/test/adapters/claude-code/format.test.ts packages/rulecast/test/build.test.ts
git commit -m "feat: replace rulecast check with rulecast run

run selects files like pre-commit (--files, --from-ref/--to-ref,
--all-files, the session's edits, staged files) and runs one rule by id.
Only agent stops decide block or allow.

Claude goes brr.. via Dash"
```

---

### Task 12: `rulecast validate [file…]`

**Files:**
- Modify: `src/commands/validate.ts` (whole file), `src/commands/main.ts` (dispatch, usage), `test/commands/main.test.ts` (remove the validate test), `test/commands/init.test.ts` (validate output)
- Test: `test/commands/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/validate.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const HTTP_DOC = "# HTTP\n\n## Errors\nRaise domain exceptions.\n"

const MANIFEST = [
  "- id: demo/http",
  "  name: No HTTPException",
  "  files: \\.py$",
  "  detect:",
  "    regex: { pattern: 'HTTPException' }",
  '  message: "{{file}}:{{line}} uses HTTPException."',
  '  context: ["@docs/http.md#errors"]',
  "",
].join("\n")

const BROKEN_RULE = [
  "- id: demo/bad",
  "  name: Bad",
  "  detect: { path: {} }",
  '  message: "{{nope}}"',
  "",
].join("\n")

const validate = (cwd: string, ...files: string[]) => runCli(cwd, ["validate", ...files])

describe("rulecast validate", () => {
  test("validates the project config", async () => {
    const root = await createFixture()
    expect(await validate(root)).toEqual({
      code: 0,
      stdout: ".rulecast-config.yaml: 3 rules valid\n",
      stderr: "",
      warmed: [],
    })
  })

  test("prints each diagnostic and exits 2", async () => {
    const root = await createProject({
      ".rulecast-config.yaml": localConfig([{ id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    })
    expect(await validate(root)).toMatchObject({
      code: 2,
      stdout: '.rulecast-config.yaml: .rulecast-config.yaml (broken): unknown detector "nope"\n',
    })
  })

  test("validates a rule repo's manifest, resolving references against its directory", async () => {
    const root = await createProject({ ".rulecast-rules.yaml": MANIFEST, "docs/http.md": HTTP_DOC })
    expect(await validate(root)).toMatchObject({ code: 0, stdout: ".rulecast-rules.yaml: 1 rule valid\n" })
    await writeFile(path.join(root, ".rulecast-rules.yaml"), MANIFEST + BROKEN_RULE)
    expect(await validate(root)).toMatchObject({
      code: 2,
      stdout: '.rulecast-rules.yaml: .rulecast-rules.yaml (demo/bad): unknown template variable "nope"\n',
    })
  })

  test("takes files by name, and validates both files at the root without arguments", async () => {
    const nested = await createProject({ "rules/.rulecast-rules.yaml": MANIFEST, "rules/docs/http.md": HTTP_DOC })
    expect(await validate(nested, "rules/.rulecast-rules.yaml")).toMatchObject({
      code: 0,
      stdout: "rules/.rulecast-rules.yaml: 1 rule valid\n",
    })
    const both = await createProject({
      ".rulecast-config.yaml": localConfig([]),
      ".rulecast-rules.yaml": MANIFEST,
      "docs/http.md": HTTP_DOC,
    })
    expect(await validate(both)).toMatchObject({
      code: 0,
      stdout: ".rulecast-config.yaml: 0 rules valid\n.rulecast-rules.yaml: 1 rule valid\n",
    })
  })

  test("a branch-like rev is a warning, not a failure", async () => {
    const url = await createRuleRepo([
      { tag: "stable", files: { ".rulecast-rules.yaml": MANIFEST, "docs/http.md": HTTP_DOC } },
    ])
    const root = await createProject({
      ".rulecast-config.yaml": `repos:\n  - repo: ${url}\n    rev: stable\n    rules:\n      - id: demo/http\n`,
    })
    expect(await validate(root)).toMatchObject({
      code: 0,
      stdout: [
        `.rulecast-config.yaml: warning: ${url}@stable: rev "stable" looks like a branch: pin a tag or a full commit SHA`,
        ".rulecast-config.yaml: 1 rule valid",
        "",
      ].join("\n"),
    })
  })

  test("other file names and empty directories are errors", async () => {
    const root = await createProject({ "README.md": "" })
    const other = await validate(root, "README.md")
    expect(other.code).toBe(2)
    expect(other.stderr).toContain("README.md: not a .rulecast-config.yaml or .rulecast-rules.yaml")
    const empty = await validate(root)
    expect(empty.code).toBe(2)
    expect(empty.stderr).toContain("nothing to validate: no .rulecast-config.yaml or .rulecast-rules.yaml")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/validate.test.ts`
Expected: FAIL: `validate` ignores its arguments and prints the Task 10 output format (no `<file>:` prefix), and the manifest cases report a missing `.rulecast-config.yaml`.

- [ ] **Step 3: Implement**

`src/commands/validate.ts`:
```ts
import { existsSync } from "node:fs"
import path from "node:path"

import { compile, compileManifest, type Diagnostic } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE, MANIFEST_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { UsageError } from "./usage"

type Validated = { rules: CompiledRule[]; diagnostics: Diagnostic[] }

function formatDiagnostic(diagnostic: Diagnostic): string {
  const level = diagnostic.level === "warning" ? "warning: " : ""
  const rule = diagnostic.rule ? ` (${diagnostic.rule})` : ""
  return `${level}${diagnostic.source}${rule}: ${diagnostic.message}`
}

/** Validates `.rulecast-config.yaml` as a config and `.rulecast-rules.yaml` as a manifest, by file name. */
export async function validateCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const targets =
    args.length > 0
      ? args.map((file) => ({ shown: file, full: path.resolve(io.cwd, file) }))
      : [CONFIG_FILE, MANIFEST_FILE]
          .filter((name) => existsSync(path.join(root, name)))
          .map((name) => ({ shown: name, full: path.join(root, name) }))
  if (targets.length === 0) throw new Error(`nothing to validate: no ${CONFIG_FILE} or ${MANIFEST_FILE}`)
  for (const { shown, full } of targets) {
    const name = path.basename(full)
    if (name !== CONFIG_FILE && name !== MANIFEST_FILE) {
      throw new UsageError(`${shown}: not a ${CONFIG_FILE} or ${MANIFEST_FILE}`)
    }
  }

  let failed = false
  for (const { shown, full } of targets) {
    const dir = path.dirname(full)
    const result: Validated =
      path.basename(full) === CONFIG_FILE
        ? await compile({ root: dir, registry, repos: fetchingRepos(cacheHome(io.env)) })
        : await compileManifest(dir, registry)
    for (const diagnostic of result.diagnostics) io.stdout(`${shown}: ${formatDiagnostic(diagnostic)}\n`)
    if (result.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
      failed = true
      continue
    }
    const count = result.rules.length
    io.stdout(`${shown}: ${count} ${count === 1 ? "rule" : "rules"} valid\n`)
  }
  return failed ? 2 : 0
}
```

In `src/commands/main.ts`, replace the `case "validate":` branch with:
```ts
      case "validate":
        return await validateCommand(root, args, registry, io)
```
and the `rulecast validate` line of `USAGE` with `  rulecast validate [file...]`.

Replace `test/commands/main.test.ts` with (the validate test moved to `validate.test.ts`; what is left checks that an unknown command is a usage error):
```ts
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"

describe("rulecast CLI", () => {
  test("an unknown command is a usage error", async () => {
    const result = await runCli(await createFixture(), ["frobnicate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown command "frobnicate"')
    expect(result.stderr).toContain("usage:")
  })
})
```

`test/commands/init.test.ts` (Task 10) checks `validate`'s old output. Replace:
```ts
    expect(await runCli(root, ["validate"])).toMatchObject({ code: 0, stdout: "rulecast: 0 rules valid\n" })
```
with:
```ts
    expect(await runCli(root, ["validate"])).toMatchObject({ code: 0, stdout: ".rulecast-config.yaml: 0 rules valid\n" })
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/commands/validate.test.ts test/commands/main.test.ts test/commands/init.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/commands/validate.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/commands/validate.test.ts packages/rulecast/test/commands/main.test.ts packages/rulecast/test/commands/init.test.ts
git commit -m "feat: validate configs and manifests by file name

Claude goes brr.. via Dash"
```

---

### Task 13: Adapter install interface, `install` and `uninstall`; `init` installs through them

**Files:**
- Create: `src/adapters/index.ts`, `src/commands/install.ts`
- Modify: `src/core/types.ts` (`InstallScope`, `AdapterInstall`, `Adapter`), `src/adapters/claude-code/settings.ts` (whole file), `src/adapters/claude-code/adapter.ts` (whole file), `src/commands/hook.ts` (adapter lookup), `src/commands/init.ts` (Task 10's interim `init` installs through `installHooks`), `src/commands/main.ts`
- Test: `test/adapters/claude-code/settings.test.ts` (append), `test/commands/install.test.ts`, `test/commands/init.test.ts` (append one test to Task 10's file)

Task 10 already reduced `init` to the minimal config plus the Claude Code settings merge. This task keeps that behaviour and its tests, and only moves the hook install onto the adapter interface, so `init` also sees hooks already installed in the personal settings.

- [ ] **Step 1: Write the failing `removeHooks` tests**

In `test/adapters/claude-code/settings.test.ts`, change the import to `import { mergeHooks, removeHooks, SettingsError } from "../../../src/adapters/claude-code/settings"` and append:
```ts
describe("Claude Code settings: removeHooks", () => {
  const dash = { type: "command", command: "dash-hook stop" }

  test("removes everything mergeHooks added", () => {
    expect(removeHooks(mergeHooks({}, COMMAND, 60_000).settings)).toEqual({
      settings: {},
      removed: [
        "PostToolUse (Read)",
        "PostToolUse (Edit|Write)",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
        "SessionStart (startup|resume|compact)",
      ],
    })
  })

  test("keeps every other setting, group and hook, and does not mutate its input", () => {
    const existing = {
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: {
        PostToolUse: [{ matcher: "Read", hooks: [dash, hook(5)] }],
        Stop: [{ hooks: [dash] }],
        Notification: [],
      },
    }
    const merged = mergeHooks(existing, COMMAND, 60_000).settings
    const input = structuredClone(merged)
    const { settings, removed } = removeHooks(input)
    expect(input).toEqual(merged)
    expect(settings).toEqual({
      permissions: existing.permissions,
      hooks: { PostToolUse: [{ matcher: "Read", hooks: [dash] }], Stop: [{ hooks: [dash] }], Notification: [] },
    })
    expect(removed).toContain("PostToolUse (Read)")
  })

  test("settings without rulecast hooks come back unchanged", () => {
    const settings = { hooks: { Stop: [{ hooks: [dash] }] } }
    expect(removeHooks(settings)).toEqual({ settings, removed: [] })
    expect(removeHooks({})).toEqual({ settings: {}, removed: [] })
  })

  test.each([[[]], [{ hooks: [] }], [{ hooks: { Stop: {} } }], ["text"]])("rejects settings shaped like %j", (bad) => {
    expect(() => removeHooks(bad)).toThrow(SettingsError)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/adapters/claude-code/settings.test.ts`
Expected: FAIL: `removeHooks` is not exported.

- [ ] **Step 3: Implement `removeHooks`**

`src/adapters/claude-code/settings.ts`:
```ts
type JsonObject = Record<string, unknown>

export class SettingsError extends Error {}

const RULECAST_HOOK = /\brulecast\b.*\bhook claude-code\b/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRulecastHook = (hook: unknown): boolean =>
  isObject(hook) && typeof hook.command === "string" && RULECAST_HOOK.test(hook.command)

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
    (group) => isObject(group) && group.matcher === matcher && Array.isArray(group.hooks) && group.hooks.some(isRulecastHook),
  )
}

function hooksOf(settings: unknown): JsonObject {
  if (!isObject(settings)) throw new SettingsError("settings must be a JSON object")
  const hooks = settings.hooks ?? {}
  if (!isObject(hooks)) throw new SettingsError('"hooks" must be an object')
  return hooks
}

/** Adds rulecast's hooks to Claude Code settings. Existing entries are never modified or removed. */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
): { settings: JsonObject; added: string[] } {
  const merged: JsonObject = { ...hooksOf(settings) }
  const added: string[] = []
  for (const { event, matcher, timeout } of hookGroups(verifyMs)) {
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (installed(groups, matcher)) continue
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(matcher === undefined ? event : `${event} (${matcher})`)
  }
  return { settings: { ...(settings as JsonObject), hooks: merged }, added }
}

/**
 * Removes the hooks rulecast added (commands running `rulecast hook claude-code`). Groups and events that only
 * held rulecast hooks go too, and so does a `hooks` object left empty. Everything else is kept as it is.
 */
export function removeHooks(settings: unknown): { settings: JsonObject; removed: string[] } {
  const hooks = hooksOf(settings)
  const source = settings as JsonObject
  const kept: JsonObject = {}
  const removed: string[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    const remaining: unknown[] = []
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(isRulecastHook)) {
        remaining.push(group)
        continue
      }
      removed.push(typeof group.matcher === "string" ? `${event} (${group.matcher})` : event)
      const others = group.hooks.filter((hook) => !isRulecastHook(hook))
      if (others.length > 0) remaining.push({ ...group, hooks: others })
    }
    // Only events emptied here are dropped; an event that was already empty stays.
    if (remaining.length > 0 || groups.length === 0) kept[event] = remaining
  }
  if (removed.length === 0) return { settings: source, removed }
  const result: JsonObject = {}
  for (const [key, value] of Object.entries(source)) {
    if (key !== "hooks") result[key] = value
    else if (Object.keys(kept).length > 0) result[key] = kept
  }
  return { settings: result, removed }
}
```

- [ ] **Step 4: Run it**

Run: `pnpm vitest run test/adapters/claude-code/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `install`/`uninstall` tests**

`test/commands/install.test.ts`:
```ts
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { TEST_HOME } from "../helpers/home"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const SHARED = ".claude/settings.json"
const PERSONAL = ".claude/settings.local.json"
const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const settingsOf = async (root: string, file = SHARED) => JSON.parse(await read(root, file))
const repoConfig = (url: string) => `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    rules: []\n`

describe("rulecast install", () => {
  test("installs the Claude Code hooks in the shared settings; a second run changes nothing", async () => {
    const root = await createFixture()
    const first = await runCli(root, ["install"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain("installed Claude Code hooks in .claude/settings.json: PostToolUse (Read)")
    const settings = await settingsOf(root)
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
    ])
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({ type: "command", command: "rulecast hook claude-code", timeout: 70 })

    const before = await read(root, SHARED)
    expect(await runCli(root, ["install"])).toMatchObject({
      code: 0,
      stdout: "Claude Code hooks already installed in .claude/settings.json\n",
    })
    expect(await read(root, SHARED)).toBe(before)
  })

  test("--scope personal writes the personal settings, and hooks there count as installed", async () => {
    const root = await createFixture()
    expect((await runCli(root, ["install", "--scope", "personal"])).stdout).toContain(
      "installed Claude Code hooks in .claude/settings.local.json",
    )
    expect((await runCli(root, ["install"])).stdout).toBe(
      "Claude Code hooks already installed in .claude/settings.local.json\n",
    )
    expect(existsSync(path.join(root, SHARED))).toBe(false)
  })

  test("uses the project's own rulecast when it is installed", async () => {
    const root = await createFixture()
    await runCli(root, ["install"])
    expect((await settingsOf(root)).hooks.Stop[0].hooks[0].command).toBe("rulecast hook claude-code")
    const local = await createProject({ ".rulecast-config.yaml": "repos: []\n", "node_modules/.bin/rulecast": "" })
    await runCli(local, ["install"])
    expect((await settingsOf(local)).hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
    expect(claudeCodeAdapter.install?.command(true)).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
  })

  test("fetches rule repos missing from the cache", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": "[]\n" } }])
    const root = await createProject({ ".rulecast-config.yaml": repoConfig(url) })
    const first = await runCli(root, ["install"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain(`fetched ${repoLabel(url, "v1.0.0")}\n`)
    expect(existsSync(repoDir(TEST_HOME, url, "v1.0.0"))).toBe(true)
    expect((await runCli(root, ["install"])).stdout).not.toContain("fetched")
  })

  test("a repo that cannot be fetched fails the run after the hooks are installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": repoConfig("/nonexistent/rules.git") })
    const result = await runCli(root, ["install"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(`could not fetch ${repoLabel("/nonexistent/rules.git", "v1.0.0")}`)
    expect(existsSync(path.join(root, SHARED))).toBe(true)
  })

  test("errors: unparseable settings, unknown agents and scopes, no project", async () => {
    const root = await createFixture()
    const broken = await createProject({ ".rulecast-config.yaml": "repos: []\n", [SHARED]: "{ nope" })
    const unparseable = await runCli(broken, ["install"])
    expect(unparseable.code).toBe(2)
    expect(unparseable.stderr).toContain(".claude/settings.json:")
    expect(await read(broken, SHARED)).toBe("{ nope")

    const agent = await runCli(root, ["install", "--agent", "cursor"])
    expect(agent.code).toBe(2)
    expect(agent.stderr).toContain('unknown agent "cursor" (use claude-code)')
    const scope = await runCli(root, ["install", "--scope", "team"])
    expect(scope.code).toBe(2)
    expect(scope.stderr).toContain('unknown scope "team" (use shared, personal)')
    const outside = await runCli(await createProject({}), ["install"])
    expect(outside.code).toBe(2)
    expect(outside.stderr).toContain("no .rulecast-config.yaml in")
  })
})

describe("rulecast uninstall", () => {
  test("removes only what install added", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const original = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [dash] }] } }
    const root = await createFixture()
    // Hooks in both files: install into personal, hide it while installing into shared, then put it back.
    await runCli(root, ["install", "--scope", "personal"])
    const personal = await read(root, PERSONAL)
    await writeFile(path.join(root, PERSONAL), "{}")
    await writeFile(path.join(root, SHARED), JSON.stringify(original))
    await runCli(root, ["install", "--scope", "shared"])
    await writeFile(path.join(root, PERSONAL), personal)

    const result = await runCli(root, ["uninstall"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("removed Claude Code hooks from .claude/settings.json: ")
    expect(result.stdout).toContain("removed Claude Code hooks from .claude/settings.local.json: ")
    expect(await settingsOf(root)).toEqual(original)
    expect(await settingsOf(root, PERSONAL)).toEqual({})
    expect(await runCli(root, ["uninstall"])).toMatchObject({ code: 0, stdout: "no Claude Code hooks to remove\n" })
  })
})
```

- [ ] **Step 6: Extend the `init` test**

Task 10's `test/commands/init.test.ts` (with Task 12's `validate` output) stays. `init` now installs through `installHooks`, so hooks already installed in the personal settings count as installed. Replace its first import line:
```ts
import { readFile } from "node:fs/promises"
```
with:
```ts
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
```
and append inside `describe("rulecast init", ...)`:
```ts
  test("hooks installed in the personal settings count as installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\n" })
    expect((await runCli(root, ["install", "--scope", "personal"])).code).toBe(0)
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Claude Code hooks already installed in .claude/settings.local.json")
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
  })
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm vitest run test/commands/install.test.ts test/commands/init.test.ts`
Expected: FAIL: `unknown command "install"` / `"uninstall"`; the new `init` test fails at the `install` call, and Task 10's `init` would write `.claude/settings.json` anyway. Task 10's other `init` tests still pass.

- [ ] **Step 8: Adapter install interface**

In `src/core/types.ts`, replace the `Adapter` interface with:
```ts
export type InstallScope = "shared" | "personal"

export interface AdapterInstall {
  /** Paths whose presence means the project uses this agent (init); a trailing "/" means a directory. */
  markers: string[]
  /** Settings files, repo-relative, that hooks can be written to. */
  scopes: { scope: InstallScope; file: string }[]
  /** The hook command; local: rulecast is installed in the project's node_modules. */
  command(local: boolean): string
  merge(settings: unknown, command: string, verifyMs: number): { settings: unknown; added: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
}

export interface Adapter {
  name: string
  /** Shown to people: "Claude Code". */
  label: string
  /** Budget handed to commit (§9); null = unlimited. */
  maxContextChars: number | null
  /** null: not an input this adapter handles. */
  parse(input: unknown): AdapterInput | null
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
  /** null: the agent has no hooks to install. */
  install: AdapterInstall | null
}
```

`src/adapters/claude-code/adapter.ts`:
```ts
import { renderAgentText } from "../../core/delivery/render-agent"
import type { Adapter, Event } from "../../core/types"
import { parseClaudeCode } from "./parse"
import { mergeHooks, removeHooks } from "./settings"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish."

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

/** Where the rest of a cut delivery can be read: the session's findings, from the CLI. */
function cutNotice(event: Event): string {
  const session = event.session ? `--session ${event.session.id} ` : ""
  return `\n\n…cut to fit Claude Code's hook output limit. Run \`rulecast run ${session}--format agent\` for the full list.`
}

/** Only findings can push text past the limit: commit keeps references within the budget. */
function withinLimit(text: string, event: Event): string {
  if (text.length <= CONTEXT_LIMIT) return text
  const notice = cutNotice(event)
  return text.slice(0, CONTEXT_LIMIT - notice.length) + notice
}

const NONE = { stdout: "", exitCode: 0 }
const json = (value: unknown) => ({ stdout: JSON.stringify(value), exitCode: 0 })

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  label: "Claude Code",
  maxContextChars: CONTEXT_BUDGET,
  parse: parseClaudeCode,
  format(delivery, event, options) {
    const text = renderAgentText(delivery, options)
    if (text === "") return NONE
    switch (event.kind) {
      case "touch":
      case "edit":
        return json({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text, event) },
        })
      case "verify":
        if (delivery.stop === "block")
          return json({ decision: "block", reason: withinLimit(`${BLOCK_PREAMBLE}\n\n${text}`, event) })
        if (delivery.stop === "capReached")
          return json({ systemMessage: withinLimit(`${CAP_PREAMBLE}\n\n${text}`, event) })
        return NONE
      default:
        return NONE
    }
  },
  install: {
    markers: [".claude/", "CLAUDE.md"],
    scopes: [
      { scope: "shared", file: ".claude/settings.json" },
      { scope: "personal", file: ".claude/settings.local.json" },
    ],
    command: (local) =>
      local ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code' : "rulecast hook claude-code",
    merge: mergeHooks,
    remove: removeHooks,
  },
}
```

`src/adapters/index.ts`:
```ts
import type { Adapter } from "../core/types"
import { claudeCodeAdapter } from "./claude-code/adapter"

/** Every agent adapter rulecast ships. */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter]

export function adapterByName(name: string): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.name === name)
}
```

In `src/commands/hook.ts`, replace:
```ts
import { claudeCodeAdapter } from "../adapters/claude-code/adapter"
```
with:
```ts
import { ADAPTERS, adapterByName } from "../adapters"
```
delete the line `const ADAPTERS: Readonly<Record<string, Adapter>> = { "claude-code": claudeCodeAdapter }`, and replace the lookup at the top of `hookCommand`:
```ts
  const adapter = ADAPTERS[name]
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${Object.keys(ADAPTERS).join(", ")})\n`)
    return 0
  }
```
with:
```ts
  const adapter = adapterByName(name)
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${ADAPTERS.map((known) => known.name).join(", ")})\n`)
    return 0
  }
```
(`Adapter` stays imported as a type for `EventContext`.)

- [ ] **Step 9: `install`, `uninstall`, and `init` on top of them**

`src/commands/install.ts`:
```ts
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS, adapterByName } from "../adapters"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import type { Config } from "../core/config/schema"
import { errorMessage, isNotFound } from "../core/errors"
import { cacheHome } from "../core/home"
import { cachedRepo, ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import type { Adapter, AdapterInstall, InstallScope } from "../core/types"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** Parsed settings, or null when the file does not exist. */
async function readSettings(root: string, file: string): Promise<{ value: unknown } | null> {
  let text: string
  try {
    text = await readFile(path.join(root, file), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`)
  }
}

async function writeSettings(root: string, file: string, settings: unknown): Promise<void> {
  const full = path.join(root, file)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, `${JSON.stringify(settings, null, 2)}\n`)
}

function installOf(adapter: Adapter): AdapterInstall {
  if (!adapter.install) throw new UsageError(`${adapter.name} has no hooks to install`)
  return adapter.install
}

/** Runs an adapter's settings transform, naming the file when the settings have the wrong shape. */
function inFile<T>(file: string, transform: () => T): T {
  try {
    return transform()
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`)
  }
}

/**
 * Adds the adapter's hooks to its settings file for `scope`. Hooks already present in any of the adapter's
 * settings files count as installed: then nothing is written and `added` is empty.
 */
export async function installHooks(
  root: string,
  adapter: Adapter,
  scope: InstallScope,
  verifyMs: number,
): Promise<{ file: string; added: string[] }> {
  const install = installOf(adapter)
  const command = install.command(existsSync(path.join(root, "node_modules", ".bin", "rulecast")))
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    if (inFile(file, () => install.merge(current.value, command, verifyMs)).added.length === 0) {
      return { file, added: [] }
    }
  }
  const target = install.scopes.find((candidate) => candidate.scope === scope)
  if (!target) throw new UsageError(`${adapter.name} has no ${scope} settings`)
  const current = (await readSettings(root, target.file))?.value ?? {}
  const merged = inFile(target.file, () => install.merge(current, command, verifyMs))
  await writeSettings(root, target.file, merged.settings)
  return { file: target.file, added: merged.added }
}

/** Removes the adapter's hooks from every settings file of it that exists. */
export async function uninstallHooks(root: string, adapter: Adapter): Promise<{ file: string; removed: string[] }[]> {
  const install = installOf(adapter)
  const results: { file: string; removed: string[] }[] = []
  for (const { file } of install.scopes) {
    const current = await readSettings(root, file)
    if (current === null) continue
    const { settings, removed } = inFile(file, () => install.remove(current.value))
    if (removed.length === 0) continue
    await writeSettings(root, file, settings)
    results.push({ file, removed })
  }
  return results
}

function selectAdapters(names: string[] | undefined): Adapter[] {
  if (names === undefined) return ADAPTERS.filter((adapter) => adapter.install !== null)
  const known = ADAPTERS.filter((adapter) => adapter.install !== null).map((adapter) => adapter.name)
  return names.map((name) => {
    const adapter = adapterByName(name)
    if (!adapter?.install) throw new UsageError(`unknown agent "${name}" (use ${known.join(", ")})`)
    return adapter
  })
}

export async function loadProjectConfig(root: string, command: string): Promise<Config> {
  const data = await readConfigData(root)
  const config = data.ok ? parseConfig(data.value) : data
  if (!config.ok) throw new Error(`${config.message} (fix it, then run rulecast ${command} again)`)
  return config.value
}

export function printInstall(io: CliIo, adapter: Adapter, result: { file: string; added: string[] }): void {
  io.stdout(
    result.added.length === 0
      ? `${adapter.label} hooks already installed in ${result.file}\n`
      : `installed ${adapter.label} hooks in ${result.file}: ${result.added.join(", ")}\n`,
  )
}

/** Fetches every URL repo the config pins that is missing from the cache. False when a fetch failed. */
async function fetchMissingRepos(config: Config, io: CliIo): Promise<boolean> {
  const home = cacheHome(io.env)
  let ok = true
  for (const entry of config.repos) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    if (cachedRepo(home, entry.repo, entry.rev) !== null) continue
    const label = repoLabel(entry.repo, entry.rev)
    try {
      await ensureRepo(home, entry.repo, entry.rev)
      io.stdout(`fetched ${label}\n`)
    } catch (error) {
      io.stderr(`rulecast: could not fetch ${label}: ${errorMessage(error)}\n`)
      ok = false
    }
  }
  return ok
}

export async function installCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { agent: { type: "string", multiple: true }, scope: { type: "string", default: "shared" } },
  })
  const scope = values.scope
  if (scope !== "shared" && scope !== "personal") {
    throw new UsageError(`unknown scope "${scope}" (use shared, personal)`)
  }
  const adapters = selectAdapters(values.agent)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents (run rulecast init)`)
  const config = await loadProjectConfig(root, "install")
  for (const adapter of adapters) {
    printInstall(io, adapter, await installHooks(root, adapter, scope, config.timeouts.verifyMs))
  }
  return (await fetchMissingRepos(config, io)) ? 0 : 2
}

export async function uninstallCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { agent: { type: "string", multiple: true } } })
  for (const adapter of selectAdapters(values.agent)) {
    const results = await uninstallHooks(root, adapter)
    if (results.length === 0) io.stdout(`no ${adapter.label} hooks to remove\n`)
    for (const { file, removed } of results) {
      io.stdout(`removed ${adapter.label} hooks from ${file}: ${removed.join(", ")}\n`)
    }
  }
  return 0
}
```

In `src/commands/init.ts` (Task 10's interim `init`; plan 4 replaces it with the interactive one), move the hook install onto `installHooks`. Replace the imports and the settings constant:
```ts
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { mergeHooks } from "../adapters/claude-code/settings"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import { errorMessage, isNotFound } from "../core/errors"
import type { CliIo } from "./main"

const SETTINGS = ".claude/settings.json"
```
with:
```ts
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS } from "../adapters"
import { CONFIG_FILE } from "../core/config/load"
import { installHooks, loadProjectConfig, printInstall } from "./install"
import type { CliIo } from "./main"
```

Replace:
```ts
export async function initCommand(root: string, io: CliIo): Promise<number> {
```
with:
```ts
/** Interim, non-interactive setup: a minimal config plus every adapter's hooks in shared scope. */
export async function initCommand(root: string, args: string[], io: CliIo): Promise<number> {
  parseArgs({ args, options: {} })
```

Replace everything from the config check to the install message:
```ts
  const data = await readConfigData(root)
  const config = data.ok ? parseConfig(data.value) : data
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
    merged = mergeHooks(current, command, config.value.timeouts.verifyMs)
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
```
with:
```ts
  const config = await loadProjectConfig(root, "init")
  for (const adapter of ADAPTERS) {
    if (adapter.install) printInstall(io, adapter, await installHooks(root, adapter, "shared", config.timeouts.verifyMs))
  }
```
The `SCAFFOLD` constant, the config file creation and the closing `next:` line stay as Task 10 wrote them. The messages do not change: `loadProjectConfig` throws the same `(fix it, then run rulecast init again)` error, and `printInstall` and `installHooks` print and throw the same texts as the code they replace.

In `src/commands/main.ts`:
- add `import { installCommand, uninstallCommand } from "./install"`;
- replace the `case "init":` branch with `return await initCommand(root, args, io)` under the same case, and add:
  ```ts
      case "install":
        return await installCommand(root, args, io)
      case "uninstall":
        return await uninstallCommand(root, args, io)
  ```
- replace `USAGE` with:
  ```ts
  const USAGE = `usage:
    rulecast init
    rulecast install [--agent <name>]... [--scope shared|personal]
    rulecast uninstall [--agent <name>]...
    rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
    rulecast validate [file...]
    rulecast hook <adapter>
    rulecast warm [--detector <kind>]...
  `
  ```

- [ ] **Step 10: Run the tests**

Run: `pnpm vitest run test/commands/install.test.ts test/commands/init.test.ts test/adapters/claude-code test/commands/hook.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/rulecast/src/core/types.ts packages/rulecast/src/adapters/index.ts packages/rulecast/src/adapters/claude-code/adapter.ts packages/rulecast/src/adapters/claude-code/settings.ts packages/rulecast/src/commands/install.ts packages/rulecast/src/commands/init.ts packages/rulecast/src/commands/hook.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/adapters/claude-code/settings.test.ts packages/rulecast/test/commands/install.test.ts packages/rulecast/test/commands/init.test.ts
git commit -m "feat: install and uninstall agent hooks through the adapter

Adapters describe their hook install (markers, scopes, command, merge,
remove). install also fetches pinned rule repos. The interim init now
installs hooks through the same code.

Claude goes brr.. via Dash"
```

---

### Task 14: `rulecast autoupdate`

**Files:**
- Create: `src/core/config/edit.ts`, `src/commands/autoupdate.ts`
- Modify: `src/commands/main.ts`
- Test: `test/core/config/edit.test.ts`, `test/commands/autoupdate.test.ts`

- [ ] **Step 1: Write the failing `setRevs` tests**

`test/core/config/edit.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { setRevs } from "../../../src/core/config/edit"

const CONFIG = [
  "# top comment",
  "repos:",
  "  - repo: https://github.com/syv-ai/rulecast",
  "    rev: v0.1.0   # frozen: v0.1.0",
  "    rules:",
  "      - id: a   # keep me",
  "  - repo: https://x/y",
  '    rev: "v1.0.0"  # pinned',
  "    rules: []",
  "  - { repo: https://z/w, rev: 'v2.0.0', rules: [] }",
  "  - repo: local",
  "    rules: [{ id: b, name: B, stages: [touch], context: ['@a.md'] }]",
  "",
].join("\n")

const replaced = (from: string, to: string) => CONFIG.replace(from, to)

describe("setRevs", () => {
  test("changes only the rev values, keeping quotes and comments; a stale frozen comment goes", () => {
    const text = setRevs(CONFIG, [
      { index: 0, rev: "v0.2.0", frozenTag: null },
      { index: 1, rev: "v1.1.0", frozenTag: null },
      { index: 2, rev: "v2.1.0", frozenTag: null },
    ])
    expect(text).toBe(
      CONFIG.replace("rev: v0.1.0   # frozen: v0.1.0", "rev: v0.2.0")
        .replace('rev: "v1.0.0"  # pinned', 'rev: "v1.1.0"  # pinned')
        .replace("rev: 'v2.0.0'", "rev: 'v2.1.0'"),
    )
  })

  test("freezing writes the SHA with a frozen comment", () => {
    expect(setRevs(CONFIG, [{ index: 0, rev: "deadbeef", frozenTag: "v0.2.0" }])).toBe(
      replaced("rev: v0.1.0   # frozen: v0.1.0", "rev: deadbeef  # frozen: v0.2.0"),
    )
    expect(setRevs(CONFIG, [{ index: 1, rev: "cafe", frozenTag: "v1.1.0" }])).toBe(
      replaced('rev: "v1.0.0"  # pinned', 'rev: "cafe"  # frozen: v1.1.0'),
    )
  })

  test("keeps Windows line endings", () => {
    const text = "repos:\r\n  - repo: u\r\n    rev: v1 # frozen: v1\r\n    rules: []\r\n"
    expect(setRevs(text, [{ index: 0, rev: "v2", frozenTag: null }])).toBe(
      "repos:\r\n  - repo: u\r\n    rev: v2\r\n    rules: []\r\n",
    )
  })

  test("no updates returns the text unchanged; a repo without rev is an error", () => {
    expect(setRevs(CONFIG, [])).toBe(CONFIG)
    expect(() => setRevs(CONFIG, [{ index: 3, rev: "v1", frozenTag: null }])).toThrow("repos[3] has no rev")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/config/edit.test.ts`
Expected: FAIL: cannot find module `../../../src/core/config/edit`.

- [ ] **Step 3: Implement `setRevs`**

`src/core/config/edit.ts`:
```ts
import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml"

export interface RevUpdate {
  /** Index of the entry in `repos`. */
  index: number
  rev: string
  /** Freezing: the tag the SHA in `rev` stands for, written as a `# frozen: <tag>` comment. */
  frozenTag: string | null
}

const FROZEN = /^\s*#\s*frozen:/

function quoted(value: string, type: Scalar.Type | undefined): string {
  if (type === "QUOTE_DOUBLE") return JSON.stringify(value)
  if (type === "QUOTE_SINGLE") return `'${value.replaceAll("'", "''")}'`
  return value
}

/**
 * Rewrites `repos[index].rev` values in config text. Every other byte stays as written: edits are made
 * on the source ranges the YAML parser reports, not by re-serialising the document.
 */
export function setRevs(text: string, updates: readonly RevUpdate[]): string {
  if (updates.length === 0) return text
  const doc = parseDocument(text, { keepSourceTokens: true })
  const repos = doc.get("repos", true)
  if (!isSeq(repos)) throw new Error("repos must be a list")
  const edits: { start: number; end: number; text: string }[] = []
  for (const update of updates) {
    const entry = repos.items[update.index]
    if (!isMap(entry)) throw new Error(`repos[${update.index}] is not a mapping`)
    const rev = entry.get("rev", true)
    if (!isScalar(rev) || !rev.range) throw new Error(`repos[${update.index}] has no rev`)
    // range: [start, end of the value, end of the node including trailing whitespace and comment].
    const [start, valueEnd] = rev.range
    const value = quoted(update.rev, rev.type)
    if (entry.flow) {
      // `{ repo: …, rev: …, rules: … }`: the rest of the line belongs to the mapping, so only the value changes.
      edits.push({ start, end: valueEnd, text: value })
      continue
    }
    const newline = text.indexOf("\n", valueEnd)
    let end = newline === -1 ? text.length : newline
    if (text[end - 1] === "\r") end--
    let tail = text.slice(valueEnd, end)
    if (update.frozenTag !== null) tail = `  # frozen: ${update.frozenTag}`
    else if (FROZEN.test(tail)) tail = ""
    edits.push({ start, end, text: value + tail })
  }
  let result = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }
  return result
}
```

Freezing replaces any trailing comment on the `rev` line with the frozen comment, as pre-commit does; without `--freeze`, only a `# frozen:` comment is removed and other comments stay.

- [ ] **Step 4: Run it**

Run: `pnpm vitest run test/core/config/edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing command tests**

`test/commands/autoupdate.test.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { git } from "../helpers/git"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const MANIFEST = { ".rulecast-rules.yaml": "[]\n" }

const configFor = (urls: string[]) =>
  [
    "# pinned rule repos",
    "repos:",
    ...urls.flatMap((url) => [`  - repo: ${url}`, "    rev: v1.0.0 # the catalog", "    rules: []"]),
    "  - repo: local",
    "    rules: []",
    "",
  ].join("\n")

const read = (root: string) => readFile(path.join(root, ".rulecast-config.yaml"), "utf8")

async function twoVersions(): Promise<string> {
  return createRuleRepo([
    { tag: "v1.0.0", files: MANIFEST },
    { tag: "v1.1.0", files: { ...MANIFEST, "CHANGELOG.md": "1.1\n" } },
  ])
}

describe("rulecast autoupdate", () => {
  test("moves each rev to the latest tag and keeps the rest of the file", async () => {
    const url = await twoVersions()
    const config = configFor([url])
    const root = await createProject({ ".rulecast-config.yaml": config })

    const first = await runCli(root, ["autoupdate"])
    expect(first).toMatchObject({ code: 0, stdout: `${url}: updating v1.0.0 -> v1.1.0\n` })
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", "rev: v1.1.0 # the catalog"))

    expect(await runCli(root, ["autoupdate"])).toMatchObject({ code: 0, stdout: `${url}: already up to date\n` })
  })

  test("--freeze pins the tag's commit and a plain run turns it back into the tag", async () => {
    const url = await twoVersions()
    const config = configFor([url])
    const root = await createProject({ ".rulecast-config.yaml": config })
    const sha = await git(url, "rev-parse", "v1.1.0^{commit}")

    expect((await runCli(root, ["autoupdate", "--freeze"])).stdout).toBe(
      `${url}: updating v1.0.0 -> ${sha} (frozen: v1.1.0)\n`,
    )
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", `rev: ${sha}  # frozen: v1.1.0`))
    expect((await runCli(root, ["autoupdate", "--freeze"])).stdout).toBe(`${url}: already up to date\n`)

    await runCli(root, ["autoupdate"])
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", "rev: v1.1.0"))
  })

  test("--repo limits the update to the named repos", async () => {
    const first = await twoVersions()
    const second = await twoVersions()
    const config = configFor([first, second])
    const root = await createProject({ ".rulecast-config.yaml": config })
    expect((await runCli(root, ["autoupdate", "--repo", second])).stdout).toBe(`${second}: updating v1.0.0 -> v1.1.0\n`)
    const lines = (await read(root)).split("\n")
    expect(lines[3]).toBe("    rev: v1.0.0 # the catalog")
    expect(lines[6]).toBe("    rev: v1.1.0 # the catalog")

    const unknown = await runCli(root, ["autoupdate", "--repo", "https://example.com/nope"])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('no repo "https://example.com/nope" in .rulecast-config.yaml')
  })

  test("repos without version tags are left alone; unreachable repos fail the run", async () => {
    const untagged = await createRuleRepo([{ tag: "stable", files: MANIFEST }])
    const url = await twoVersions()
    const root = await createProject({
      ".rulecast-config.yaml": configFor(["/nonexistent/rules.git", untagged, url]),
    })
    const result = await runCli(root, ["autoupdate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("rulecast: /nonexistent/rules.git:")
    expect(result.stdout).toBe(`${untagged}: no version tags\n${url}: updating v1.0.0 -> v1.1.0\n`)
    expect(await read(root)).toContain("    rev: v1.1.0 # the catalog")
  })

  test("needs a valid config", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: nope\n" })
    const result = await runCli(root, ["autoupdate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".rulecast-config.yaml: repos")
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run test/commands/autoupdate.test.ts`
Expected: FAIL: `unknown command "autoupdate"`.

- [ ] **Step 7: Implement the command**

`src/commands/autoupdate.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { type RevUpdate, setRevs } from "../core/config/edit"
import { CONFIG_FILE } from "../core/config/load"
import { errorMessage } from "../core/errors"
import { latestTag, remoteTags, type Tag } from "../core/repos/tags"
import { loadProjectConfig } from "./install"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** Moves each URL repo's rev to its latest version tag, like pre-commit autoupdate. */
export async function autoupdateCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { freeze: { type: "boolean", default: false }, repo: { type: "string", multiple: true } },
  })
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const config = await loadProjectConfig(root, "autoupdate")
  const only = values.repo
  for (const url of only ?? []) {
    if (!config.repos.some((entry) => entry.repo === url)) throw new UsageError(`no repo "${url}" in ${CONFIG_FILE}`)
  }

  const updates: RevUpdate[] = []
  let failed = false
  for (const [index, entry] of config.repos.entries()) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    if (only && !only.includes(entry.repo)) continue
    let latest: Tag | null
    try {
      latest = latestTag(await remoteTags(entry.repo))
    } catch (error) {
      io.stderr(`rulecast: ${entry.repo}: ${errorMessage(error)}\n`)
      failed = true
      continue
    }
    if (latest === null) {
      io.stdout(`${entry.repo}: no version tags\n`)
      continue
    }
    const rev = values.freeze ? latest.sha : latest.name
    if (rev === entry.rev) {
      io.stdout(`${entry.repo}: already up to date\n`)
      continue
    }
    io.stdout(`${entry.repo}: updating ${entry.rev} -> ${rev}${values.freeze ? ` (frozen: ${latest.name})` : ""}\n`)
    updates.push({ index, rev, frozenTag: values.freeze ? latest.name : null })
  }

  if (updates.length > 0) {
    const file = path.join(root, CONFIG_FILE)
    await writeFile(file, setRevs(await readFile(file, "utf8"), updates))
  }
  return failed ? 2 : 0
}
```

In `src/commands/main.ts`, add `import { autoupdateCommand } from "./autoupdate"`, a dispatch branch:
```ts
      case "autoupdate":
        return await autoupdateCommand(root, args, io)
```
and the usage line `  rulecast autoupdate [--freeze] [--repo URL]...` after the `run` line.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run test/core/config/edit.test.ts test/commands/autoupdate.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/rulecast/src/core/config/edit.ts packages/rulecast/src/commands/autoupdate.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/core/config/edit.test.ts packages/rulecast/test/commands/autoupdate.test.ts
git commit -m "feat: add rulecast autoupdate

Revs move to the latest version tag (or its commit with --freeze);
only the rev values in the config change.

Claude goes brr.. via Dash"
```

---

### Task 15: `rulecast try-repo`

**Files:**
- Create: `src/commands/try-repo.ts`
- Modify: `src/commands/main.ts`
- Test: `test/commands/try-repo.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/try-repo.test.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const MANIFEST = [
  "- id: demo/http",
  "  name: No HTTPException",
  "  files: \\.py$",
  "  detect:",
  "    regex: { pattern: 'HTTPException' }",
  '  message: "{{file}}:{{line}} uses HTTPException."',
  '  context: ["@docs/http.md#errors"]',
  "- id: demo/generated",
  "  name: Generated client",
  "  files: ^src/client/",
  "  detect: { path: {} }",
  '  message: "{{file}} is generated."',
  "",
].join("\n")

const REPO_FILES = { ".rulecast-rules.yaml": MANIFEST, "docs/http.md": "# HTTP\n\n## Errors\nRaise domain exceptions.\n" }

type Json = { findings: { rule: string; line: number }[]; references: { ref: string }[] }
const parse = (stdout: string): Json => JSON.parse(stdout)

describe("rulecast try-repo", () => {
  test("runs a local directory's rules against the project without touching its config", async () => {
    const root = await createFixture()
    const config = await readFile(path.join(root, ".rulecast-config.yaml"), "utf8")
    const repo = await createProject(REPO_FILES)

    const result = await runCli(root, ["try-repo", repo, "--all-files", "--format", "json"])
    expect(result.code).toBe(1)
    const output = parse(result.stdout)
    expect(output.findings.map((finding) => [finding.rule, finding.line])).toEqual([
      ["demo/generated", 1],
      ["demo/http", 2],
    ])
    expect(output.references.map((reference) => reference.ref)).toEqual([
      `${path.basename(repo)}@working-tree:docs/http.md#errors`,
    ])
    expect(await readFile(path.join(root, ".rulecast-config.yaml"), "utf8")).toBe(config)
  })

  test("RULE_ID runs one rule", async () => {
    const root = await createFixture()
    const repo = await createProject(REPO_FILES)
    const result = await runCli(root, ["try-repo", repo, "demo/http", "--all-files", "--format", "json"])
    expect(parse(result.stdout).findings.map((finding) => finding.rule)).toEqual(["demo/http"])

    const unknown = await runCli(root, ["try-repo", repo, "nope", "--all-files"])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain(`no rule "nope" in ${path.basename(repo)}@working-tree`)
  })

  test("fetches a URL at --ref", async () => {
    const root = await createFixture()
    const url = await createRuleRepo([{ tag: "v1.0.0", files: REPO_FILES }])
    const result = await runCli(root, ["try-repo", url, "demo/http", "--ref", "v1.0.0", "--all-files", "--format", "json"])
    expect(result.code).toBe(1)
    expect(parse(result.stdout).references.map((reference) => reference.ref)).toEqual([
      `${repoLabel(url, "v1.0.0")}:docs/http.md#errors`,
    ])
  })

  test("works outside a rulecast project", async () => {
    const root = await createProject({ "app.py": "raise HTTPException(1)\n" })
    const repo = await createProject(REPO_FILES)
    const result = await runCli(root, ["try-repo", repo, "--files", "app.py", "--format", "json"])
    expect(parse(result.stdout).findings.map((finding) => finding.rule)).toEqual(["demo/http"])
  })

  test("usage problems exit 2", async () => {
    const root = await createFixture()
    const repo = await createProject(REPO_FILES)
    expect((await runCli(root, ["try-repo"])).stderr).toContain("try-repo needs a repository path or URL")
    expect((await runCli(root, ["try-repo", repo, "--ref", "v1"])).stderr).toContain("--ref only applies to URLs")
    expect((await runCli(root, ["try-repo", repo, "a", "b"])).stderr).toContain("unexpected arguments: b")
    const empty = await runCli(root, ["try-repo", await createProject({}), "--all-files"])
    expect(empty.code).toBe(2)
    expect(empty.stderr).toContain(".rulecast-rules.yaml not found")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/try-repo.test.ts`
Expected: FAIL: `unknown command "try-repo"`.

- [ ] **Step 3: Implement**

`src/commands/try-repo.ts`:
```ts
import { existsSync, statSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { compile } from "../core/compile/project"
import { readConfigData, readManifest } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { fetchCheckout } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fixedRepo } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { executeRun, parseRunArgs } from "./run"
import { UsageError } from "./usage"

const isDirectory = (file: string) => existsSync(file) && statSync(file).isDirectory()

/** The project's config data with its settings kept, or {} outside a project. */
async function baseConfigData(root: string): Promise<Record<string, unknown>> {
  if (!hasProject(root)) return {}
  const data = await readConfigData(root)
  if (!data.ok) throw new Error(data.message)
  return typeof data.value === "object" && data.value !== null && !Array.isArray(data.value)
    ? (data.value as Record<string, unknown>)
    : {}
}

/** Runs a rule repo's rules (all, or one) against the project without editing its config. */
export async function tryRepoCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const run = parseRunArgs(args)
  const [repo, ruleId, ...extra] = run.leading
  if (repo === undefined) throw new UsageError("try-repo needs a repository path or URL")
  if (extra.length > 0) throw new UsageError(`unexpected arguments: ${extra.join(" ")}`)

  const local = path.resolve(io.cwd, repo)
  const fromDirectory = isDirectory(local)
  if (fromDirectory && run.ref !== null) throw new UsageError("--ref only applies to URLs")
  const rev = fromDirectory ? "working-tree" : (run.ref ?? "HEAD")
  const temp = fromDirectory ? null : await mkdtemp(path.join(tmpdir(), "rulecast-try-repo-"))
  try {
    const dir = temp ?? local
    if (temp !== null) await fetchCheckout(repo, rev, temp)
    const label = fromDirectory ? `${path.basename(local)}@${rev}` : repoLabel(repo, rev)

    const manifest = await readManifest(dir)
    if (!manifest.ok) throw new Error(`${label}: ${manifest.message}`)
    const ids = manifest.value.flatMap((rule) => {
      const id = (rule as { id?: unknown } | null)?.id
      return typeof id === "string" ? [id] : []
    })
    if (ruleId !== undefined && !ids.includes(ruleId)) throw new UsageError(`no rule "${ruleId}" in ${label}`)

    const configData = {
      ...(await baseConfigData(root)),
      repos: [{ repo, rev, rules: (ruleId === undefined ? ids : [ruleId]).map((id) => ({ id })) }],
    }
    const project = await compile({ root, registry, repos: fixedRepo(dir, label), configData })
    return await executeRun({ project, ruleId: null, run, registry, io })
  } finally {
    if (temp !== null) await rm(temp, { recursive: true, force: true })
  }
}
```

The synthetic entry's rev (`working-tree`, `HEAD` or a tag) may look like a branch; that is a warning-level diagnostic, which `run` does not count as a failure.

In `src/commands/main.ts`, add `import { tryRepoCommand } from "./try-repo"`, a dispatch branch:
```ts
      case "try-repo":
        return await tryRepoCommand(root, args, registry, io)
```
and the usage line `  rulecast try-repo <path|url> [RULE_ID] [--ref REV] [run flags]` after the `autoupdate` line.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/commands/try-repo.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/commands/try-repo.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/commands/try-repo.test.ts
git commit -m "feat: add rulecast try-repo for rule authors

Claude goes brr.. via Dash"
```

---

### Task 16: `rulecast clean`

**Files:**
- Create: `src/commands/clean.ts`
- Modify: `src/commands/main.ts`
- Test: `test/commands/clean.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/clean.test.ts`:
```ts
import { existsSync, mkdtempSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { projectStateDir } from "../../src/core/home"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"

/** A home of its own: cleaning must not remove the test file's shared home. */
function freshHome(): { home: string; env: { RULECAST_HOME: string } } {
  const home = mkdtempSync(path.join(tmpdir(), "rulecast-clean-"))
  return { home, env: { RULECAST_HOME: home } }
}

describe("rulecast clean", () => {
  test("--project removes only the project's directory", async () => {
    const { home, env } = freshHome()
    const root = await createFixture()
    await runCli(root, ["run", "--all-files"], "", env)
    const project = projectStateDir(home, root)
    expect(existsSync(project)).toBe(true)
    await mkdir(path.join(home, "repos", "keep"), { recursive: true })

    expect(await runCli(root, ["clean", "--project"], "", env)).toMatchObject({ code: 0, stdout: `removed ${project}\n` })
    expect(existsSync(project)).toBe(false)
    expect(existsSync(path.join(home, "repos", "keep"))).toBe(true)
    expect(await runCli(root, ["clean", "--project"], "", env)).toMatchObject({ code: 0, stdout: "nothing to clean\n" })
  })

  test("without flags removes the whole cache", async () => {
    const { home, env } = freshHome()
    const root = await createFixture()
    await runCli(root, ["run", "--all-files"], "", env)
    expect(await runCli(root, ["clean"], "", env)).toMatchObject({ code: 0, stdout: `removed ${home}\n` })
    expect(existsSync(home)).toBe(false)
    expect(await runCli(root, ["clean"], "", env)).toMatchObject({ code: 0, stdout: "nothing to clean\n" })
  })

  test("--project needs a project", async () => {
    const { env } = freshHome()
    const result = await runCli(await createProject({}), ["clean", "--project"], "", env)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/commands/clean.test.ts`
Expected: FAIL: `unknown command "clean"`.

- [ ] **Step 3: Implement**

`src/commands/clean.ts`:
```ts
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { parseArgs } from "node:util"

import { CONFIG_FILE } from "../core/config/load"
import { cacheHome, projectStateDir } from "../core/home"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/** Deletes rulecast's cache, or only the current project's directory in it. */
export async function cleanCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { project: { type: "boolean", default: false } } })
  const home = cacheHome(io.env)
  let target = home
  if (values.project) {
    if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
    target = projectStateDir(home, root)
  }
  if (!existsSync(target)) {
    io.stdout("nothing to clean\n")
    return 0
  }
  await rm(target, { recursive: true, force: true })
  io.stdout(`removed ${target}\n`)
  return 0
}
```

In `src/commands/main.ts`, add `import { cleanCommand } from "./clean"`, a dispatch branch:
```ts
      case "clean":
        return await cleanCommand(root, args, io)
```
and replace `USAGE` with the final text:
```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/commands/clean.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add packages/rulecast/src/commands/clean.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/commands/clean.test.ts
git commit -m "feat: add rulecast clean

Claude goes brr.. via Dash"
git fetch
git push origin main
```

Part 3d is done. Continue with `2026-09-19-rulecast-03e-repos-compaction.md`.
