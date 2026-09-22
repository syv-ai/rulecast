# rulecast Plan 7a — `rulecast doctor` Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one 0.1 command that does not exist yet. `rulecast doctor` compiles the project, checks the environment every configured rule depends on, reports where the agent hooks and the cache live, and dry-runs every rule on one file it matches — so a developer whose rules silently do nothing has one command that says why.

**Approach:** The environment checks belong to the detectors, not to `doctor`. A new optional `check` method on the `Detector` interface — the exact shape of the existing optional `warm` — lets each detector answer for its own dependencies: `ast-grep` that the native module loads for every language its rules name, `linter` that each configured tool resolves, `command` that each rule's argv[0] is executable, `llm` that the provider is reachable and every rule's model alias maps. A core module (`src/core/detection/check.ts`) drives them exactly as `warm.ts` drives `warm`. `doctor` itself owns only what is not a detector's business: compilation, hook installation, cache paths, and the dry run.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: plan 6 is done (`4a6a754`). Continue with `2026-09-22-rulecast-07b-ci-release.md`, then `07c-public-dogfood.md`.

---

## Decisions this plan implements

1. **Environment checks live on the detectors, behind an optional `check` method.** Spec §5 lists doctor's environment checks as a fixed list — "linter binaries, `@ast-grep/napi`, LLM credentials, hook installation, cache paths" — and a `doctor.ts` that hard-codes that list would be the only place in `src/` outside `src/detectors/` that knows what a `linter` rule or an `llm` rule needs. `warm` already established the pattern for "some detectors have extra work, the core drives whichever do" (`src/core/detection/warm.ts:29`, `warmableKinds`), down to filtering by the kinds the project's rules actually use. `check` is the same shape and gets the same treatment.

   The method is optional, so `regex` and `path` — whose only environmental dependency is a regex the compiler already validated — do not implement it, and a third-party detector written against 0.1's contract keeps working.

2. **`doctor` never calls a model.** An `llm` rule's dry run would be a real, billed model call, times every llm rule in the project, every time someone runs `doctor` to find out why their `regex` rule is quiet. So the dry run skips the `llm` kind and says so in its output. What `llm` contributes instead is its `check`: is the provider reachable (`claude`/`opencode` on the PATH, or `api_key_env` set), and does every rule's `model` resolve for the configured provider. Those are the two pre-flight checks plan 6a deliberately deferred to doctor (plan 6a, Decision 3) — both environmental, both free, and both currently only discoverable when a `verify` finally runs and reports them per rule.

3. **The dry run is one detection per rule, not one batched detection.** Batching is the hot path's optimisation; doctor's job is attribution. Running each rule alone on one file it matches means a rule that throws is named, and a rule that matches nothing is distinguishable from a rule that never ran. Doctor is not on any latency budget — it is a command a person types when something is already wrong.

4. **Exit 2 on any error, 0 otherwise, like `validate`.** Warnings do not fail: an uninstalled adapter or a rule with no matching file in the repository today is worth saying and is not a broken installation. Spec §14's "the CLI fails closed" is about findings and internal failure; doctor reports, so its errors are the checks that failed.

5. **`doctor` works without a compiled project only far enough to say so.** With no `.rulecast-config.yaml` above the cwd it prints the cache paths and the error `no .rulecast-config.yaml in <cwd> or its parents (run rulecast init)`, and exits 2 — the same message `run` gives. Everything else needs rules.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`, and a spawned CLI must get it in the child's env. `ls ~/.cache/rulecast` must still be absent when this plan is done.
- **No test in `pnpm test` may call a real model or open a socket to one, and none may depend on what happens to be installed on the machine.** `doctor` and `init` are the two commands that read a real environment: every doctor test stubs `PATH` with `vi.stubEnv("PATH", "/usr/bin:/bin")` and puts whatever binary it wants found into the fixture's `node_modules/.bin` (`test/helpers/llm.ts` for an agent CLI, `test/helpers/linters.ts` for a linter). A machine with `claude`, `ruff` or `eslint` installed must not turn a red test green.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause. Biome runs with `--error-on-warnings`, so unsorted imports and unsorted `export` lines in `src/index.ts` fail a commit — run `pnpm lint:fix` before committing.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout. Check that `git commit` exited 0; don't filter its output through `grep` or `tail`.
- Commit after every task. Commit messages end with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`. Commit straight to `main`; `git fetch` before pushing.
- **When a planned test fails, find the cause before changing the test.** Plans 5 and 6 each turned up real defects this way.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/which.ts` | `onPath(command)`: is a command executable on the PATH. One copy, used by three callers |
| `src/core/types.ts` | `DetectorCheck`, `CheckResult`, the optional `Detector.check` |
| `src/core/detection/check.ts` | `checkableKinds`, `checkDetectors`: drives every used detector's `check`, as `warm.ts` drives `warm` |
| `src/detectors/ast-grep/detector.ts` | `check`: the native module loads and every configured language parses |
| `src/detectors/command/detector.ts` | `check`: each rule's `run[0]` is executable |
| `src/detectors/linter/detector.ts` | `check`: each configured tool resolves to something runnable |
| `src/detectors/linter/resolve.ts` | Drops its private `onPath` for `core/which.ts`; exports `describeTool` |
| `src/detectors/llm/providers/types.ts` | `LlmProvider.available`: can this backend be reached at all |
| `src/detectors/llm/providers/{claude-code,opencode}.ts` | `available`: the binary resolves |
| `src/detectors/llm/providers/{anthropic,openai}.ts` | `available`: `api_key_env` is set; reports the endpoint |
| `src/detectors/llm/detector.ts` | `check`: the provider is available, and every rule's `model` resolves |
| `src/commands/install.ts` | Exports `hooksInstalled(root, adapter)`, lifted out of `installHooks` |
| `src/commands/doctor.ts` | The command: sections, statuses, exit code |
| `src/commands/main.ts` | `doctor` in `USAGE` and in the `switch` |
| `src/index.ts` | Exports `CheckResult`, `DetectorCheck`, `checkDetectors` |
| `test/core/which.test.ts` | `onPath` |
| `test/core/detection/check.test.ts` | `checkDetectors` against fake detectors |
| `test/detectors/*/check.test.ts` | Each detector's `check` |
| `test/commands/doctor.test.ts` | The command, section by section, and its exit codes |
| `test/commands/help.test.ts` | The usage text gains a `doctor` line |
| `docs/specs/2026-09-15-rulecast-design.md` | §6 gains `check` in the contract; §12 the doctor row is already there |
| `agents/reference/detectors.md` | A line saying `rulecast doctor` reports each detector's environment |

## The output `doctor` produces

Pinned here because Task 6 to Task 8 each add one section of it and the tests assert on it. Status labels are padded to a 9-character column; sections are separated by one blank line.

```
rulecast doctor

project    /tmp/app
config     .rulecast-config.yaml — 4 rules, 0 errors, 1 warning
  warning  .rulecast-config.yaml (python/no-print): rev "main" looks like a branch

environment
  ok       ast-grep — python, typescript
  ok       oxlint — node_modules/.bin/oxlint
  error    ruff — not installed (python/lint)
  ok       claude-code — node_modules/.bin/claude
  error    model "haiku" — no name for the openai-compatible provider (docs/tone)

hooks
  ok       Claude Code — .claude/settings.json
  warning  Claude Code — not installed (run rulecast install)

cache
  home     /tmp/rulecast-home-xxxx
  project  /tmp/rulecast-home-xxxx/projects/2f1c9a0b4d5e6f70
  repos    syv-ai/rulecast@v0.1.0 — cached

dry run
  ok       python/no-print — app/main.py, 1 match
  ok       react/no-client-edits — app/main.tsx, no match
  warning  python/layering — no file in the project matches this rule
  error    ops/shell-check — ./check.sh: not executable
  skipped  docs/tone — llm rules are not dry-run (a model call costs money)

2 errors, 2 warnings
```

A clean project ends `no problems found`. The `hooks` section prints one line per adapter that has an install; the `ok` and `warning` lines above are the two possibilities for one adapter, not two adapters.

---

## Task 1: `onPath`, in one place

**Files:** create `src/core/which.ts` · modify `src/detectors/linter/resolve.ts:30-36` · test `test/core/which.test.ts`

**Behaviour:** `onPath("sh")` is true; `onPath("definitely-not-a-real-binary-9x7")` is false. `resolveTool` keeps behaving exactly as it does now, with its private `onPath` replaced by the shared one as the default argument.

Three call sites need this question answered in this plan — `linter`'s check, `command`'s check and the two CLI llm providers' `available` — and `resolve.ts` already has the implementation. Move it rather than copy it.

- [ ] Write `test/core/which.test.ts`: `sh` is found, a nonsense name is not, and a name containing a shell metacharacter (`"; echo pwned"`) is not found and does not execute anything. `command -v` runs under `/bin/sh`, so the argument must reach it as an argument, not as shell text — `execFile` with an argv array already guarantees this, and the test pins it.
- [ ] Create `src/core/which.ts`:

  ```ts
  import { execFile } from "node:child_process"
  import { promisify } from "node:util"

  const exec = promisify(execFile)

  /**
   * Is `command` runnable by name? `command -v` under /bin/sh, so it answers the same question the
   * shell would — including builtins and shell functions, which a PATH scan would miss.
   */
  export async function onPath(command: string): Promise<boolean> {
    try {
      await exec("command", ["-v", command], { shell: "/bin/sh" })
      return true
    } catch {
      return false
    }
  }
  ```

- [ ] In `resolve.ts`, delete the local `onPath` and import it from `../../core/which`. The `available` parameter of `resolveTool` keeps its current signature and default.
- [ ] Verify: `pnpm vitest run test/core/which.test.ts test/detectors/linter` → passes.
- [ ] Commit.

## Task 2: the `check` contract and the core that drives it

**Files:** modify `src/core/types.ts:96-110` · create `src/core/detection/check.ts` · modify `src/index.ts` · test `test/core/detection/check.test.ts`

**Behaviour:** `checkDetectors` collects `CheckResult`s from every detector kind used by a project's rules whose detector implements `check`, passing that kind's rules. A detector without `check` contributes nothing. A `check` that throws becomes one `error` result naming the kind, so a broken check cannot take the command down.

- [ ] Add to `src/core/types.ts`, next to `DetectorWarm`:

  ```ts
  export interface DetectorCheck<Config> {
    /** Every rule of this detector kind in the project. */
    rules: { id: string; config: Config }[]
    /** Project settings from .rulecast-config.yaml; the same value a run gets. */
    settings: DetectorSettings
    /** The process environment, so a check can look for credentials without reaching for process.env. */
    env: Readonly<Record<string, string | undefined>>
    cwd: string
    signal: AbortSignal
  }

  export interface CheckResult {
    /** What was checked, as a person would name it: "ruff", "ast-grep", `model "haiku"`. */
    what: string
    level: "ok" | "warning" | "error"
    /** Why: a resolved path when it worked, the reason when it did not. */
    detail: string
    /** The rules this result decides the fate of; empty when it is about the kind as a whole. */
    rules: string[]
  }
  ```

  and on `Detector<Config>`, after `warm`:

  ```ts
  /** Optional: report what this detector's rules need from the environment (rulecast doctor, §5). */
  check?(input: DetectorCheck<Config>): Promise<CheckResult[]>
  ```

- [ ] Write `test/core/detection/check.test.ts` against fake detectors built with `createRegistry`, driven through a `CompiledProject`-shaped value (follow `test/core/detection/warm.test.ts` for how it builds one):
  - a kind whose rules exist and whose detector has `check` → its results come back, in the order the detector returned them, each carrying the kind
  - a kind with `check` but no rule in the project → not called
  - a detector without `check` → contributes nothing, and is not an error
  - `check` throws → exactly one result, `level: "error"`, `what` naming the kind, `detail` the error message, `rules` listing every rule of that kind
  - the `rules` a detector receives are `{ id, config }` for its kind only, and `settings` and `env` are the values passed in
- [ ] Create `src/core/detection/check.ts`, mirroring `warm.ts`:

  ```ts
  export interface CheckOptions {
    project: CompiledProject
    registry: DetectorRegistry
    settings: DetectorSettings
    env: Readonly<Record<string, string | undefined>>
    timeoutMs: number
  }

  /** Detector kinds used by the project's rules whose detector has environment checks. */
  export function checkableKinds(project: CompiledProject, registry: DetectorRegistry): string[]

  /** Every used detector's own checks, each result tagged with the kind that produced it. */
  export function checkDetectors(options: CheckOptions): Promise<(CheckResult & { kind: string })[]>
  ```

  Kinds run in parallel; results come back grouped by kind, kinds in the order `checkableKinds` returns them, so the output is stable. Use `AbortSignal.timeout(options.timeoutMs)` as `warmDetectors` does; `doctor` will pass 30 s.
- [ ] Export `CheckResult`, `DetectorCheck`, `checkDetectors` and `checkableKinds` from `src/index.ts` (`export type *` already covers the two types in `core/types.ts`; the two functions need a line).
- [ ] Verify: `pnpm vitest run test/core/detection/check.test.ts` → passes; `pnpm typecheck` → clean.
- [ ] Commit.

## Task 3: `ast-grep` and `command` check themselves

**Files:** modify `src/detectors/ast-grep/detector.ts` · modify `src/detectors/command/detector.ts` · test `test/detectors/ast-grep/check.test.ts`, `test/detectors/command/check.test.ts`

**Behaviour:**

`ast-grep`'s `check` loads a parser for every distinct `language` its rules name, through the same `parserFor` the detector uses.
- all languages parse → one `ok` result, `what: "ast-grep"`, `detail` the languages sorted and comma-joined, `rules: []`
- `parserFor` throws (`AstGrepUnavailable`) → one `error` result, `what: "ast-grep"`, `detail` the error's message, `rules` every ast-grep rule id

One result for the kind, not one per language: a broken native module breaks all of them at once, and the fix is the same.

`command`'s `check` asks, for each distinct `run[0]` across its rules:
- a path containing a separator (`./check.sh`, `scripts/x.py`) → resolved against `cwd` and tested for `X_OK`. Reachable → `ok` with the path; not executable or absent → `error` with `not executable` or `no such file`
- a bare name (`shellcheck`) → `onPath`. Found → `ok`; not found → `error` with `not installed`
- `rules` on a failing result lists every rule that names that command

- [ ] Write both test files. `command`'s uses a fixture with one script `chmod 0o755`, one script `chmod 0o644`, and one rule naming a bare command that does not exist; it stubs `PATH` so the machine's own binaries are out of reach. `ast-grep`'s asserts the happy path only — `python` (the dynamic language) and `typescript` (built in) in one project, producing one `ok` result whose `detail` is `python, typescript`. Do **not** try to make the native module fail: `load.ts` memoises the load process-globally (`src/detectors/ast-grep/load.ts:19`), so a test that broke it would poison every later test in the file. The failure shape is already covered by Task 2's "check throws" case.
- [ ] Implement both `check` methods.
- [ ] Verify: `pnpm vitest run test/detectors/ast-grep test/detectors/command` → passes.
- [ ] Commit.

## Task 4: `linter` checks its tools

**Files:** modify `src/detectors/linter/detector.ts` · modify `src/detectors/linter/resolve.ts` · test `test/detectors/linter/check.test.ts`

**Behaviour:** For each distinct `tool` across the linter rules, `check` reports whether it resolves to something runnable, using `resolveTool`'s own order — `<root>/node_modules/.bin/<tool>`, then `uv run` for a Python tool in a Python project, then the PATH.

| Situation | Result |
|---|---|
| `node_modules/.bin/oxlint` exists and is executable | `ok`, `detail: "node_modules/.bin/oxlint"` |
| `pyproject.toml` present and `uv` on the PATH, tool is `ruff` | `ok`, `detail: "uv run -- ruff"` |
| resolved to a bare name that `onPath` finds | `ok`, `detail: "<path or name> (PATH)"` — the bare name is enough; do not shell out for a full path |
| resolved to a bare name nothing provides | `error`, `detail: "not installed"`, `rules` every rule using that tool |

`resolveTool` currently returns `{ command, prefix }` and cannot say *how* it resolved, so the last two rows are indistinguishable from its return value alone. Add to `resolve.ts`:

```ts
/** How `resolveTool` found a tool, for doctor: the command as a person would type it, and whether it exists. */
export async function describeTool(tool: ToolName, root: string): Promise<{ command: string; found: boolean }>
```

implemented on top of `resolveTool`: `command` is `[resolved.command, ...resolved.prefix].join(" ")` made root-relative when it is inside `root`; `found` is true when the resolved command is an absolute path (it was already tested for `X_OK`) or when `onPath` finds the bare name.

- [ ] Write `test/detectors/linter/check.test.ts`. Use `test/helpers/linters.ts`'s `linkTool` to put a real `oxlint` in the fixture's `node_modules/.bin`; write a fake `uv` there too for the `ruff` case; stub `PATH` to `/usr/bin:/bin` so a machine with a real `ruff` cannot pass the "not installed" case.
- [ ] Implement `describeTool` and `linterDetector.check`.
- [ ] Verify: `pnpm vitest run test/detectors/linter` → passes.
- [ ] Commit.

## Task 5: the two llm pre-flight checks plan 6 deferred

**Files:** modify `src/detectors/llm/providers/types.ts` · modify `src/detectors/llm/providers/{claude-code,opencode,anthropic,openai}.ts` · modify `src/detectors/llm/detector.ts` · modify `src/index.ts` · test `test/detectors/llm/check.test.ts`

**Behaviour:** `llmDetector.check` returns, in this order:

1. **The provider is reachable.** One result, `what` the provider name.
   - `claude-code` / `opencode`: `resolveCli(name, cwd)` returns an absolute path, or `onPath(name)` finds it → `ok`, `detail` the path or `"<name> (PATH)"`. Neither → `error`, `detail: "<name> is not installed"`, `rules` every llm rule.
   - `anthropic` / `openai-compatible`: `env[settings.apiKeyEnv]` is a non-empty string → `ok`, `detail` the endpoint the provider would call (`endpoint(baseUrl, API, path)`, so a misconfigured `base_url` is visible here). Unset → `error`, `detail: "$<apiKeyEnv> is not set"`, `rules` every llm rule.
2. **Every rule's model resolves.** One result per distinct `model` across the rules.
   - `resolveModel(model, provider)` returns a string → `ok`, `what: 'model "<model>"'`, `detail` the resolved name when it differs from the written one, else `"passed through"`.
   - returns `null` → `error`, `what: 'model "<model>"'`, `detail: 'no name for the <provider> provider; use that provider\'s own model name'`, `rules` every rule naming it. This is the message `runCall` produces today at verify time (`src/detectors/llm/detector.ts:112`); keep the wording identical so the two agree.

Neither check makes a network call or spawns the model. Reachability is "could this be called", not "does it answer".

Add to `LlmProvider` in `providers/types.ts`:

```ts
/**
 * Can this backend be reached at all — the binary exists, or the key is set. Environmental, so it
 * never calls the model: `rulecast doctor` asks it (spec §5), and a false answer here is the same
 * situation LlmUnavailableError reports at run time.
 */
available(input: { settings: LlmSettings; env: NodeJS.ProcessEnv; cwd: string }): Promise<{ ok: boolean; detail: string }>
```

Implement it on all four providers. `claude-code` and `opencode` share their implementation through a helper in `providers/cli.ts`:

```ts
/** resolveCli, then the PATH: what `available` reports for a CLI provider. */
export async function cliAvailable(name: string, cwd: string): Promise<{ ok: boolean; detail: string }>
```

- [ ] Write `test/detectors/llm/check.test.ts`, one case per row above. `vi.stubEnv("PATH", "/usr/bin:/bin")` in every case; the "installed" cases put a stub `claude` in the fixture's `node_modules/.bin` with `stubAgentCli` from `test/helpers/llm.ts`. Assert that no call was made to the stub in any case — read its `.calls/` directory and expect it empty. That is the test that keeps `check` from ever becoming a model call.
- [ ] Implement `cliAvailable`, the four `available` methods and `llmDetector.check`.
- [ ] Export nothing new from `src/index.ts` beyond what Task 2 added; `LlmProvider` is already exported and now carries `available`, which is a breaking change to that interface — note it in the plan-7 index row, there are no third-party providers yet.
- [ ] Verify: `pnpm vitest run test/detectors/llm` → passes, and `ls packages/rulecast/test/**/claude.calls` shows no call directories.
- [ ] Commit.

## Task 6: the command — compile, cache, exit code

**Files:** create `src/commands/doctor.ts` · modify `src/commands/main.ts:35-46,56-80` · modify `test/commands/help.test.ts` · test `test/commands/doctor.test.ts`

**Behaviour:** `rulecast doctor` prints the `rulecast doctor`, `project`, `config` and `cache` sections and the trailing count, and exits 2 when the config has error diagnostics, 0 otherwise. `rulecast help` lists it.

- The `config` line reports the compiled rule count and the diagnostic counts; each diagnostic follows as an indented status line, `error` or `warning` from `diagnostic.level`, formatted as `validate` formats them (`src/commands/validate.ts:13-17` — lift `formatDiagnostic` into `doctor.ts`'s own helper or export it from `validate.ts`; prefer exporting, one copy).
- The `cache` section prints `home` (`cacheHome(io.env)`), `project` (`projectStateDir(home, root)`) and one `repos` line per repo entry the config pins, each `<label> — cached` or `<label> — not fetched (run rulecast install)`; a `not fetched` repo is a `warning`, not an error, because compile has already turned it into a diagnostic if it matters. Use `cachedRepo` from `src/core/repos/fetch.ts` and `repoLabel` from `src/core/repos/layout.ts`, as `fetchMissingRepos` does (`src/commands/install.ts:118-134`).
- `doctor` compiles with `fetchingRepos(cacheHome(io.env))`, like `run` and `validate`: it is a CLI command, so a missing repo is fetched rather than reported.
- With no project (`hasProject(root)` false): print `rulecast doctor`, the `cache` section's `home` line, then `rulecast: no .rulecast-config.yaml in <io.cwd> or its parents (run rulecast init)` on stderr, and return 2.
- `ensureProjectState(home, root)` is called so the `root` file exists and the printed project path is real.

- [ ] Add the `doctor` line to `USAGE` in `src/commands/main.ts`, after `warm`, and the `case "doctor"` to the switch. Update the `USAGE` constant in `test/commands/help.test.ts` to match — that test asserts the whole text, so it fails first and pins the wording:

  ```
  rulecast doctor
  ```

- [ ] Write `test/commands/doctor.test.ts` with the sections this task produces:
  - a valid project → stdout contains `project    <root>`, `config     .rulecast-config.yaml — 2 rules, 0 errors, 0 warnings`, a `cache` section with the test `RULECAST_HOME`, and exit 0
  - a config with an error diagnostic → the diagnostic appears as an `error` line, the count line says `1 error`, exit 2
  - a config with only a warning diagnostic → exit 0, count line says `1 warning`
  - no `.rulecast-config.yaml` anywhere above cwd → exit 2 and the `run rulecast init` message on stderr
  - the project's `root` file exists in the state directory afterwards
- [ ] Implement `src/commands/doctor.ts`.
- [ ] Verify: `pnpm vitest run test/commands/doctor.test.ts test/commands/help.test.ts` → passes.
- [ ] Commit.

## Task 7: the `environment` and `hooks` sections

**Files:** modify `src/commands/doctor.ts` · modify `src/commands/install.ts:56-78` · test `test/commands/doctor.test.ts`, `test/commands/install.test.ts`

**Behaviour:** `doctor` prints the `environment` section from `checkDetectors` and the `hooks` section from each adapter's install state.

`installHooks` already contains the "are these hooks present in any of the adapter's settings files" logic, inline in its loop. Lift it:

```ts
/** The adapter's settings file its hooks are already in, or null. A hook counts wherever it is (spec §12). */
export async function hooksInstalled(root: string, adapter: Adapter): Promise<string | null>
```

`installHooks` then calls it, so there is one definition of "installed" and `doctor` cannot drift from `install`.

- `environment`: one status line per result from `checkDetectors`, `what` then `detail`, with the deciding rules in parentheses when the result is not `ok` and names any: `error    ruff — not installed (python/lint)`. More than three rules are truncated to `(a, b, c and 2 more)`.
- `hooks`: one line per adapter in `ADAPTERS` with `install !== null`. Installed → `ok  <label> — <file>`. Not installed → `warning  <label> — not installed (run rulecast install)`.

- [ ] Write the `hooksInstalled` test in `test/commands/install.test.ts`: null on a project with no settings file, null with a settings file that has other hooks, the file name once `installHooks` has run, and the same file when the hooks are in the *personal* file while `shared` was asked for.
- [ ] Lift `hooksInstalled` out of `installHooks` and make `installHooks` use it. `pnpm vitest run test/commands/install.test.ts` must still pass unchanged apart from the new cases.
- [ ] Extend `test/commands/doctor.test.ts`: a project with an `oxlint` linter rule and a `command` rule pointing at an executable script prints two `ok` environment lines; the same project with the script `chmod 0o644` prints an `error` line naming the rule and exits 2; a project with no `.claude/settings.json` prints the `hooks` warning and still exits 0. Stub `PATH` in every case.
- [ ] Implement both sections.
- [ ] Verify: `pnpm vitest run test/commands` → passes.
- [ ] Commit.

## Task 8: the dry run

**Files:** modify `src/commands/doctor.ts` · test `test/commands/doctor.test.ts`

**Behaviour:** For every compiled rule, in config order, one status line:

| Rule | Line |
|---|---|
| has a detector, the `llm` kind | `skipped  <id> — llm rules are not dry-run (a model call costs money)` |
| has a detector, no file in the project matches it | `warning  <id> — no file in the project matches this rule` |
| has a detector, ran, no error | `ok       <id> — <file>, <n> matches` (`1 match`, `no match`) |
| has a detector, the run reported an error for it | `error    <id> — <message>` |
| has no detector (a `stages: [touch]` rule) | `ok       <id> — context only, nothing to run` |

The candidate file is the first path from `allFiles(root)` (`src/core/git.ts`, what `run --all-files` uses) that `rule.matches(file)` accepts — sorted, so the choice is deterministic. Each rule runs alone through `runDetection` (`src/core/detection/run.ts`) with `event: "verify"`, an empty `changes` map, a memory cache, `defaultDetectorSettings()` overridden with the project's `config.llm`, and the project's `timeouts.verifyMs` as `timeoutMs`. A timed-out kind becomes an `error` line saying `timed out after <n> ms`.

A memory cache, not the project's disk cache: doctor is a diagnostic, and a run that quietly answered from a stale cache would be the wrong answer to the question being asked.

- [ ] Extend `test/commands/doctor.test.ts`:
  - a `regex` rule that matches → `ok` with the file and `1 match`
  - a `regex` rule whose pattern matches nothing in a file it selects → `ok … no match`
  - a rule whose `files` regex selects nothing in the repository → `warning`, exit still 0
  - a `command` rule whose script exits with unparseable output → `error` naming the rule, exit 2
  - an `llm` rule → the `skipped` line, and the stub `claude` in `node_modules/.bin` recorded no call
  - a `stages: [touch]` rule with `context` and no `detect` → `ok … context only`
  - the summary line counts the dry run's errors together with the environment's
- [ ] Implement the section.
- [ ] Verify: `pnpm vitest run test/commands/doctor.test.ts` → passes; `pnpm test` → the whole suite green.
- [ ] Commit.

## Task 9: the documents catch up

**Files:** modify `docs/specs/2026-09-15-rulecast-design.md` · modify `agents/reference/detectors.md` · modify `docs/plans/2026-09-15-rulecast-00-index.md`

**Behaviour:** The spec describes `check` where it describes the detector contract, and the plan index's row 7 names the three parts.

- [ ] Spec §6, in the contract list, after **Cache**: a **Checks** bullet — "A detector may implement `check` to report what its rules need from the environment: binaries, native modules, credentials. `rulecast doctor` runs it for every kind a project uses (§5); nothing else does."
- [ ] Spec §5, the doctor consumer line: append "…then a dry run of every rule on one matching file. `llm` rules are not dry-run — a model call costs money — so their `check` is what doctor reports instead."
- [ ] `agents/reference/detectors.md`: one line under the intro saying `rulecast doctor` reports each detector's environment, so an agent that has just drafted a rule knows how to find out whether the tool it named exists.
- [ ] Plan index: row 7 `Status` becomes `Written 2026-09-22, in three parts: 2026-09-22-rulecast-07a-doctor.md, 07b-ci-release.md, 07c-public-dogfood.md`.
- [ ] Verify: `pnpm test` → passes (`test/agents-docs.test.ts` checks the doc's links).
- [ ] Commit.

---

## End-to-end verification

From the repository root, with a scratch project:

```sh
pnpm build
cd "$(mktemp -d)" && git init -q .
printf 'repos:\n  - repo: local\n    rules:\n      - id: no-print\n        name: No print\n        files: "\\.py$"\n        detect: {regex: {pattern: "print\\("}}\n        message: "{{file}}:{{line}} prints."\n' > .rulecast-config.yaml
printf 'print("x")\n' > a.py
node ~/repos/agentic-linting/packages/rulecast/dist/cli.js doctor; echo "exit $?"
```

Expected: a `config` line reading `1 rule, 0 errors, 0 warnings`, no `environment` section (neither `regex` nor `path` has checks), a `hooks` warning for Claude Code, the three `cache` lines, a dry run line `ok       no-print — a.py, 1 match`, and `exit 0`.

Then break it and check the exit code moves:

```sh
sed -i '' 's/print\\\\(/[/' .rulecast-config.yaml   # an invalid regex
node ~/repos/agentic-linting/packages/rulecast/dist/cli.js doctor; echo "exit $?"
```

Expected: an `error` diagnostic line under `config`, `0 rules`, and `exit 2`.

Finally, from the rulecast repository itself: `pnpm test && pnpm typecheck && pnpm lint` all clean, and `ls ~/.cache/rulecast` still reports no such directory.
