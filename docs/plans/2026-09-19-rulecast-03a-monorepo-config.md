# rulecast Plan 3a — Monorepo, file filters, config schema and reference roots Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the plan 3 decisions in the spec, turn the repository into a pnpm monorepo with the CLI in `packages/rulecast/`, and add the building blocks of the pre-commit-style format: file-type tags and regex filters, git file listing, the `.rulecast-config.yaml` and manifest schemas, and context references that know which root they resolve against.

**Architecture:** Everything in this part is additive except the move. Task 2 moves the package without changing behaviour. Tasks 3–5 add modules that the new compiler (Task 9) consumes: `core/files.ts` (pre-commit's `files`/`exclude`/`types` semantics), `core/git.ts` (the git runner and file listings, moved out of `core/baseline/`), `core/config/` (zod schemas with snake_case input and the camelCase shape the rest of the code reads, plus YAML loading), `core/version.ts`, and a `ReferenceRoot` for `parseReference`, so references written in a rule repo's manifest resolve inside that repo's cache directory and are labelled with it. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3, §4, §5, §7, §9, §12, §16.

**Tech Stack:** Node ≥ 20, TypeScript 5, pnpm 10 workspaces, zod 3, yaml 2, vitest 3.

Prerequisite: plans 1 and 2 are done (HEAD `5f43432` or later). Continue with `2026-09-19-rulecast-03b-cache-repos.md` afterwards.

---

## Decisions plan 3 implements

Made with the user on 2026-09-19, or settled while writing the plan. Task 1 writes the spec-visible ones into the spec.

1. **Monorepo first.** Task 2 moves `src/`, `test/` and the package config into `packages/rulecast/` before any format work, so every later task uses final paths. The root becomes a private pnpm workspace that owns biome and lefthook; `pnpm test`, `pnpm typecheck`, `pnpm build` and `pnpm test:perf` keep working from the root.
2. **Plan numbering.** The new plans are 3 (this format change) and 4 (interactive init). The old plans 3–5 (structural detectors, LLM, distribution) become 5–7, and Task 1 fixes the references to them.
3. **Re-delivery after compaction (user-confirmed).** A recording on Claude Code 2.1.278 showed that after `/compact` the main agent's 5 most recently read, edited or written files come back as attachments, without the tool calls that would trigger `touch`. rulecast records every file each agent reads or edits in work memory (which `reset` does not clear) and, on `reset`, delivers the touch context of the agent's most recent files. The count is the adapter's `restoredFiles` (Claude Code: 5), so the core stays agent-neutral. `SessionStart` `compact` injects `hookSpecificOutput.additionalContext` with the same 10,000-char limit as `PostToolUse`. Implemented in Task 18.
4. **Interim `init`.** Task 10 reduces today's scaffolding `init` to "write a minimal `.rulecast-config.yaml` and install hooks" (no example rule, no `conventions/example.md`), because the old scaffold stops compiling at the switch; Task 13 moves its hook install onto the adapter `install` interface. Plan 4 replaces it with the interactive `init`.
5. **The cache holds all state.** Sessions, detector caches, warm locks and the debug log move from `.rulecast/.state` to `$RULECAST_HOME/projects/<hash>/`. Tests get their own `RULECAST_HOME` and never touch `~/.cache/rulecast`.
6. **Hooks never fetch; the CLI does.** The compiler gets repos from a `RepoProvider`: hooks pass a cache-only provider, `run`/`validate`/`install`/`try-repo` a fetching one.
7. **Config keys.** YAML keys are snake_case; the zod schema maps them to the camelCase `Config` the code already uses (`config.timeouts.editDeadlineMs`), which keeps the pipeline and session code unchanged.
8. **Reference identity.** A reference from a rule repo has `ref` `<owner>/<repo>@<rev>:<path>[#anchor]` and an absolute `path` in the cache. Context memory keys on `path`, so repo references dedupe separately from project files with the same relative path.
9. **`run` details.** `Event.baseRef` becomes `baseCommit` (the command computes the merge base). `--from-ref` without `--to-ref` reads changes up to the working tree, including uncommitted and untracked files, like the old `check --base`. `run --session <id>` with no file flags verifies the session's edited files. The stop decision runs only for agent stops (`PipelineOptions.stopGate`), so a CLI run never consumes a stop block. Claude Code's cut-off pointer names `rulecast run --session <id> --format agent`.
10. **`install --scope`.** `install` takes `--scope shared|personal` like `init`, because `init` installs through it.
11. **Diagnostics have a level.** A branch-like `rev` is a warning; `validate` prints it and still exits 0; hooks ignore warnings.

## Conventions

- Until Task 2 is committed, paths are as they are today (`src/…`, `test/…`, run from the repository root). From Task 2 on, the CLI package lives in `packages/rulecast/`; the **Files:** lists name paths relative to it, and `git add` uses paths from the repository root.
- Run one test file with `pnpm vitest run <path>`; from Task 2 on the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.
- `.dash/` is untracked and not ours; never stage it.

## File structure

Paths after Task 2, relative to `packages/rulecast/` unless they start at the repository root.

| File | Responsibility |
|---|---|
| `docs/specs/2026-09-15-rulecast-design.md` (root) | Spec amended with decisions 3, 9, 10 and the adapter interface additions |
| `docs/plans/2026-09-15-rulecast-00-index.md` (root) | Seven plans, new numbering |
| `package.json`, `pnpm-workspace.yaml` (root) | Private workspace; scripts delegate to the package |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | The `@syv-ai/rulecast` package, moved |
| `src/core/files.ts` | File-type tags, `files`/`exclude`/`types` filters |
| `src/core/git.ts` | git runner, commits, merge bases, file listings (moved from `src/core/baseline/git.ts`) |
| `src/core/version.ts` | Running version, version comparison |
| `src/core/config/schema.ts` | Config, rule and override schemas |
| `src/core/config/load.ts` | Reading `.rulecast-config.yaml` and `.rulecast-rules.yaml` |
| `src/core/references.ts` | References resolve against a `ReferenceRoot` |
| `src/core/types.ts`, `src/core/session/decide.ts`, `src/core/delivery/render-agent.ts` | `DeliveredReference.location` for rule repo references |

## Not in this plan

- **Store corruption fallback (§14 "Store unreadable").** Still open from plan 2: the hook logs `CorruptStoreError` and prints nothing.
- **`autoupdate` checking the new rev.** pre-commit refuses an update whose manifest lacks a configured id; rulecast leaves that to `validate` and the hook diagnostics.
- **Windows paths.** File matching and references assume forward slashes, as the rest of the code does.

---

### Task 1: Record the plan 3 decisions in the spec and renumber the plans

**Files:**
- Modify: `docs/specs/2026-09-15-rulecast-design.md`
- Modify: `test/payloads/claude-code/README.md`
- Modify: `docs/plans/2026-09-15-rulecast-00-index.md`
- Modify: `docs/plans/2026-09-16-rulecast-02b-hook-init-warm.md`
- Modify: `test/perf/edit-hook.test.ts` (doc comment only)

- [ ] **Step 1: Update the status line**

In `docs/specs/2026-09-15-rulecast-design.md`, replace:
```markdown
**Status:** draft for review (revised after architecture review A–F; 2026-09-16: pre-commit-style config, rule repos and interactive init folded in from `2026-09-16-rulecast-pre-commit-format-design.md` and `2026-09-16-rulecast-interactive-init-design.md`)
```
with:
```markdown
**Status:** draft for review (revised after architecture review A–F; 2026-09-16: pre-commit-style config, rule repos and interactive init folded in from `2026-09-16-rulecast-pre-commit-format-design.md` and `2026-09-16-rulecast-interactive-init-design.md`; 2026-09-19: re-delivery after compaction, `run` and `install` details from planning)
```

- [ ] **Step 2: Update the core types in §3**

Replace:
```ts
  baseRef?: string                   // verify from the CLI: --from-ref; the baseline is its merge base with HEAD
```
with:
```ts
  baseCommit?: string                // verify from the CLI: the commit the baseline is read from (run --from-ref: the merge base)
```

Replace:
```ts
interface AdapterInstall {
  markers: string[]                  // paths whose presence means the project uses this agent (init)
  scopes: { scope: "shared" | "personal"; file: string }[]   // settings files hooks can be written to
  merge(settings: unknown, command: string, verifyMs: number): { settings: unknown; added: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
}

interface Adapter {
  name: string
  maxContextChars: number | null     // budget for commit (§9); null = unlimited
```
with:
```ts
interface AdapterInstall {
  markers: string[]                  // paths whose presence means the project uses this agent (init); trailing "/" = directory
  scopes: { scope: "shared" | "personal"; file: string }[]   // settings files hooks can be written to
  command(local: boolean): string    // the hook command; local = rulecast is installed in the project
  merge(settings: unknown, command: string, verifyMs: number): { settings: unknown; added: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
}

interface Adapter {
  name: string
  label: string                      // human name, e.g. "Claude Code"
  maxContextChars: number | null     // budget for commit (§9); null = unlimited
  restoredFiles: number              // recently accessed files the agent re-attaches after compaction (§9, reset)
```

- [ ] **Step 3: Update §7**

Replace:
```markdown
| `reset` | `SessionStart` with source `compact` | none | none; clears the agent's context memory |
```
with:
```markdown
| `reset` | `SessionStart` with source `compact` | touch rules matching the restored files | clears the agent's context memory, then the agent's `restoredFiles` most recently read or edited files (no detection) |
```

- [ ] **Step 4: Update §9**

Replace:
```markdown
| **Work memory** | edited files; stop-block counter per agent | session | `prompt` resets that agent's counter; nothing clears edited files |
```
with:
```markdown
| **Work memory** | edited files; files each agent read or edited, most recent last; stop-block counter per agent | session | `prompt` resets that agent's counter; nothing clears the file lists |
```

After the bullet:
```markdown
- Compaction clears context memory but not stop-block counters, so a reset cannot restart a Stop loop.
```
add:
```markdown
- After compaction an agent's harness may re-attach recently used files to the new context without the tool calls that trigger `touch` (Claude Code re-attaches the 5 most recently read, edited or written files). So a `reset` clears context memory, then delivers the touch context of the agent's `restoredFiles` most recently accessed files, as a `touch` would. The adapter declares `restoredFiles`; 0 means no re-delivery.
```

- [ ] **Step 5: Update §12**

In the Claude Code adapter table, replace:
```markdown
| `SessionStart` | `startup\|resume\|compact` | `startup`, `resume`: none, starts warm-up (§13); `compact`: `reset` | none | 5 s |
```
with:
```markdown
| `SessionStart` | `startup\|resume\|compact` | `startup`, `resume`: none, starts warm-up (§13); `compact`: `reset` | `compact`: `hookSpecificOutput.additionalContext` | 5 s |
```

After the bullet starting `- **Block reason.**` add:
```markdown
- **Compaction.** `/compact` re-attaches the main agent's 5 most recently read, edited or written files (a partial read comes back whole, an edited file with its current content) without tool calls, so the adapter declares `restoredFiles` 5. `SessionStart` `compact` output has the same 10,000-char limit as `PostToolUse`.
```

Replace:
```markdown
Payloads for every row are recorded from Claude Code 2.1.273 in `test/payloads/claude-code/` (findings in its `README.md`), and the adapter is written against them. Claude Code 2.1.273 has no `MultiEdit` tool.
```
with:
```markdown
Payloads for every row are recorded from Claude Code 2.1.273 in `packages/rulecast/test/payloads/claude-code/` (findings in its `README.md`, including the compaction behaviour recorded with 2.1.278), and the adapter is written against them. Claude Code 2.1.273 has no `MultiEdit` tool.
```

In the CLI table, replace:
```markdown
| `rulecast install [--agent <name>]` | Installs agent hooks, merged without modifying existing entries, and fetches missing rule repos |
| `rulecast uninstall [--agent <name>]` | Removes only the hook entries rulecast added |
| `rulecast run [RULE_ID] [--all-files \| --files F…] [--from-ref A --to-ref B] [--format terminal\|agent\|json\|sarif] [--session <id>] [--no-llm]` | Verify event |
```
with:
```markdown
| `rulecast install [--agent <name>]... [--scope shared\|personal]` | Installs agent hooks (default: every adapter, shared scope), merged without modifying existing entries, and fetches missing rule repos |
| `rulecast uninstall [--agent <name>]...` | Removes only the hook entries rulecast added |
| `rulecast run [RULE_ID] [--all-files \| --files F…] [--from-ref A [--to-ref B]] [--format terminal\|agent\|json\|sarif] [--session <id>] [--no-llm]` | Verify event |
```

Replace:
```markdown
| `rulecast try-repo <path\|url> [RULE_ID] [run flags]` | Runs a repo's rules against the project without editing the config (for rule authors) |
```
with:
```markdown
| `rulecast try-repo <path\|url> [RULE_ID] [--ref REV] [run flags]` | Runs a repo's rules against the project without editing the config (for rule authors): a local directory as it is on disk, a URL at `--ref` (default `HEAD`) |
```

Replace the paragraph starting `**`run` file selection:**` with:
```markdown
**`run` file selection:** explicit `--files`; otherwise `--from-ref A [--to-ref B]`: files changed since the merge base of A and B (B defaults to `HEAD`; without `--to-ref`, changes up to the working tree including untracked files), read from the working tree, with that merge base as the baseline; otherwise `--all-files`: `git ls-files --cached --others --exclude-standard`; otherwise, with `--session`, the session's edited files, as at a Stop; otherwise staged files, as pre-commit does. Without `--from-ref` and `--session` there is no baseline and every finding is new. `RULE_ID` runs that rule only. The CLI adapter maps error findings to exit code 1; it has no stop decision, so a run never counts as a stop block. CI documentation recommends `--from-ref` so llm rules judge only changed files.
```

- [ ] **Step 6: Update §15**

Replace:
```markdown
- **Session:** scenario tests driven directly with synthetic findings and events — `touch → edit → edit → reset → edit → verify ×4 → prompt → verify`, sections covered by whole files, agent reads, budget fallbacks, subagent isolation — asserted against golden `Delivery` values. No detectors, no fixture repo.
```
with:
```markdown
- **Session:** scenario tests driven directly with synthetic findings and events — `touch → edit → edit → reset → edit → verify ×4 → prompt → verify`, sections covered by whole files, agent reads, budget fallbacks, subagent isolation, a reset re-delivering the touch context of restored files — asserted against golden `Delivery` values. No detectors, no fixture repo.
```

- [ ] **Step 7: Record the compaction findings with the payloads**

In `test/payloads/claude-code/README.md`, after the bullet starting `- **Non-interactive runs.**`, add:
```markdown
- **Compaction re-attaches files.** Recorded on 2026-09-19 with Claude Code 2.1.278 (`claude -p --resume <session-id> "/compact" < /dev/null` compacts without an interactive session; hooks fire `SessionStart` resume, `PreCompact`, `SubagentStop`, `SessionStart` compact). After `/compact`, the main agent's 5 most recently read, edited or written files come back as `attachment` entries of type `file`, newest first, with no Read call. A partial read comes back whole; an edited file with its current content; a very large file (38,000 chars in the recording) becomes a pointer telling the agent to Read it, while an 11,400-char file came back whole. A second `/compact` with no reads in between re-attached nothing.
- **`SessionStart` `compact` output.** `hookSpecificOutput.additionalContext` reaches the model as a system reminder ("SessionStart hook additional context: …"); plain stdout is injected too. 12,040 chars were replaced by a `<persisted-output>` pointer with a 2 KB preview, as for `PostToolUse`. The recorded `SessionStart` compact payload has the same keys as `session-start.compact.json`.
```

- [ ] **Step 8: Renumber the plans in the index**

Replace the whole content of `docs/plans/2026-09-15-rulecast-00-index.md` with:
```markdown
# rulecast — implementation plans

Spec: `docs/specs/2026-09-15-rulecast-design.md`

The spec is split into seven plans. Each produces working, tested software on its own and builds on the previous one. Plans 3 and 4 were added on 2026-09-19 for the pre-commit-style config and the interactive `init` (spec revision of 2026-09-16). The structural detectors, LLM and distribution plans moved from 3–5 to 5–7.

| # | Plan | Delivers | Spec sections | Status |
|---|---|---|---|---|
| 1 | Core + CLI | Package scaffold, compile, `regex`/`path` detectors, detection runner, baseline, session, delivery, pipeline, `rulecast check` and `rulecast validate` | §3–§11, §12 (CLI), §14, §15 (compile/baseline/session) | Done (2026-09-16), in five parts executed in order: `2026-09-15-rulecast-01a-compile.md` (tasks 1–8), `01b-detection.md` (9–14), `01c-baseline.md` (15–20), `01d-session-delivery.md` (21–27), `01e-pipeline-cli.md` (28–32) |
| 2 | Claude Code | Claude Code adapter from recorded payloads, `rulecast hook`, `rulecast init`, `rulecast warm` + detached warm-up, perf test | §12 (adapter), §13 | Done (2026-09-16), in two parts executed in order: `2026-09-16-rulecast-02a-adapter.md` (tasks 1–7), `02b-hook-init-warm.md` (tasks 8–13); edit hook p50 111 ms, p95 118 ms on an Apple M3 Pro (regex and path rules only) |
| 3 | Pre-commit-style config and rule repos | Monorepo layout, `.rulecast-config.yaml` and rule repo manifests, file-type tags and regex filters, reference roots, the user cache (`$RULECAST_HOME`), repo fetching, `run` (replaces `check`), `validate [file…]`, `install`/`uninstall`, `autoupdate`, `try-repo`, `clean`, re-delivery after compaction | §3–§5, §7, §9, §12 (CLI, cache and state), §14, §16 | Written, in five parts executed in order: `2026-09-19-rulecast-03a-monorepo-config.md` (tasks 1–5), `03b-cache-repos.md` (6–8), `03c-compile.md` (9–10), `03d-commands.md` (11–16), `03e-repos-compaction.md` (17–19) |
| 4 | Interactive init | Catalog rule packages (`rules-general`, `rules-python`, `rules-react`) and the generated root manifest, agent docs under `agents/`, interactive `rulecast init` | §4 (rule repos), §12 (`init`, agent docs), §15 (init) | Written, in two parts executed in order: `2026-09-19-rulecast-04a-catalog-docs.md` (tasks 1–2), `04b-init.md` (3–9) |
| 5 | Structural and external detectors | `ast-grep`, `command`, `linter` (ruff, oxlint, eslint); exported detector and adapter contract suites | §6, §15 | Written after plan 4 |
| 6 | LLM detector | `llm` detector, providers, cache, budget | §6 (`llm`) | Written after plan 5 |
| 7 | Distribution | `rulecast doctor`, standalone binary, release pipeline, public repository (needed by the drafting prompt's raw GitHub links), dogfooding on a private client codebase | §5 (doctor), §16, §17 | Written after plan 6 |

The `design-system` detector (§18) gets its own spec after 0.1.

## Conventions for all plans

- Package manager: pnpm (workspace). Node ≥ 20. ESM only.
- The CLI package lives in `packages/rulecast/`. Plans 1 and 2 predate the move: their `src/…` and `test/…` paths are now under `packages/rulecast/`.
- Tests: vitest, under `packages/rulecast/test/` mirroring `src/`.
- No module-level mutable state anywhere in `src/`. Anything a module needs is passed in.
- Commit after every task. Commit messages end with the line `Claude goes brr.. via Dash`.
```

- [ ] **Step 9: Fix references to the old plan 3**

In `docs/plans/2026-09-16-rulecast-02b-hook-init-warm.md`:
- replace `Plan 3 adds those rules to \`test/perf/edit-hook.test.ts\`.` with `Plan 5 (was plan 3 before the 2026-09-19 renumbering) adds those rules to \`test/perf/edit-hook.test.ts\`.`
- replace `/** 25 regex rules and 5 path rules. Plan 3 adds ast-grep, ruff and command rules (spec §13). */` with `/** 25 regex rules and 5 path rules. Plan 5 adds ast-grep, ruff and command rules (spec §13). */`
- replace `Plan 2 is done. Before plan 3, dogfood by hand:` with `Plan 2 is done. Before plan 3 (plan 5 after the 2026-09-19 renumbering), dogfood by hand:`

In `test/perf/edit-hook.test.ts`, replace:
```ts
/** 25 regex rules and 5 path rules. Plan 3 adds ast-grep, ruff and command rules (spec §13). */
```
with:
```ts
/** 25 regex rules and 5 path rules. Plan 5 adds ast-grep, ruff and command rules (spec §13). */
```

- [ ] **Step 10: Check nothing else names the old numbers**

Run: `grep -rn "plan 3\|Plan 3\|plan 4\|Plan 4\|plan 5\|Plan 5" docs test src | grep -v "2026-09-19-rulecast-0"`
Expected: only the lines edited in Steps 8–9 and the plan 1/2 documents' own historical mentions of plans they wrote before (e.g. "Written after plan 1"). Fix any other reference to the old numbering.

- [ ] **Step 11: Commit**

```bash
git add docs/specs/2026-09-15-rulecast-design.md docs/plans/2026-09-15-rulecast-00-index.md docs/plans/2026-09-16-rulecast-02b-hook-init-warm.md test/payloads/claude-code/README.md test/perf/edit-hook.test.ts docs/plans/2026-09-19-rulecast-03a-monorepo-config.md docs/plans/2026-09-19-rulecast-03b-cache-repos.md docs/plans/2026-09-19-rulecast-03c-compile.md docs/plans/2026-09-19-rulecast-03d-commands.md docs/plans/2026-09-19-rulecast-03e-repos-compaction.md docs/plans/2026-09-19-rulecast-04a-catalog-docs.md docs/plans/2026-09-19-rulecast-04b-init.md
git commit -m "docs: record plan 3 decisions and renumber the plans

Claude goes brr.. via Dash"
```
(If the plan documents were already committed together with this plan, leave them out of `git add`.)

---

### Task 2: Move the package into a pnpm workspace

**Files:**
- Move: `src/`, `test/`, `package.json`, `tsconfig.json`, `vitest.config.ts` → `packages/rulecast/`
- Create: `package.json` (root), `pnpm-workspace.yaml`
- Modify: `packages/rulecast/package.json`, `pnpm-lock.yaml` (regenerated)

The move changes no behaviour, so the existing suite is the test: it must pass unchanged from the new location.

- [ ] **Step 1: Record the baseline**

Run: `pnpm test`
Expected: PASS (215 tests at the time of writing, the perf suite skipped). Note the count; Step 6 must match it.

- [ ] **Step 2: Move the package**

```bash
mkdir -p packages/rulecast
git mv src test package.json tsconfig.json vitest.config.ts packages/rulecast/
rm -rf dist
```

- [ ] **Step 3: Trim the package manifest**

In `packages/rulecast/package.json`, replace the `scripts` block:
```json
  "scripts": {
    "build": "tsup src/index.ts src/cli.ts --format esm --dts --clean",
    "test": "vitest run",
    "test:perf": "RULECAST_PERF=1 vitest run test/perf",
    "typecheck": "tsc --noEmit",
    "lint": "biome check --error-on-warnings",
    "lint:fix": "biome check --write",
    "prepare": "lefthook install"
  },
```
with:
```json
  "scripts": {
    "build": "tsup src/index.ts src/cli.ts --format esm --dts --clean",
    "test": "vitest run",
    "test:perf": "RULECAST_PERF=1 vitest run test/perf",
    "typecheck": "tsc --noEmit"
  },
```
and in `devDependencies` remove the `"@biomejs/biome"` and `"lefthook"` lines (they move to the root).

- [ ] **Step 4: Create the workspace root**

`package.json` (root):
```json
{
  "name": "rulecast-workspace",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.26.0",
  "scripts": {
    "build": "pnpm --filter @syv-ai/rulecast build",
    "test": "pnpm -r test",
    "test:perf": "pnpm --filter @syv-ai/rulecast test:perf",
    "typecheck": "pnpm -r typecheck",
    "vitest": "pnpm --filter @syv-ai/rulecast exec vitest",
    "lint": "biome check --error-on-warnings",
    "lint:fix": "biome check --write",
    "prepare": "lefthook install"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.14",
    "lefthook": "2.1.14"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`lefthook.yml`, `biome.json` and `.gitignore` stay at the root unchanged: biome's `!!**/dist` and the unanchored `node_modules/` and `dist/` ignore patterns cover the package directory, and lefthook's `pnpm typecheck` now runs the recursive root script.

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: the lockfile gains the `packages/rulecast` importer; `packages/rulecast/node_modules` appears; `lefthook install` runs from the root `prepare` script.

- [ ] **Step 6: Verify everything still works from the root**

Run: `pnpm test`
Expected: PASS with the same count as Step 1 (`test/build.test.ts` builds `packages/rulecast/dist`, because `pnpm -r test` runs vitest with the package as its working directory).

Run: `pnpm vitest run test/core/anchors.test.ts`
Expected: PASS (the root `vitest` script runs vitest inside the package).

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all succeed; `packages/rulecast/dist/cli.js` exists.

Run: `pnpm test:perf`
Expected: PASS, printing `edit hook: p50 … ms, p95 … ms` in the same range as before (p95 around 120 ms on an M3 Pro).

Run: `git status --short`
Expected: renames into `packages/rulecast/`, the new root files, the modified lockfile, and `?? .dash/`. Nothing else.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml packages/rulecast
git commit -m "build: move the CLI package into a pnpm workspace

Claude goes brr.. via Dash"
```

---

### Task 3: File-type tags, regex filters and git file listings

**Files:**
- Create: `src/core/files.ts`
- Move: `src/core/baseline/git.ts` → `src/core/git.ts`, `test/core/baseline/git.test.ts` → `test/core/git.test.ts`
- Modify: `src/core/baseline/baseline.ts`, `src/core/pipeline.ts`, `src/commands/check.ts`, `test/core/baseline/baseline.test.ts` (imports)
- Test: `test/core/files.test.ts`, `test/core/git.test.ts`

- [ ] **Step 1: Write the failing test for file filters**

`test/core/files.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { compileFilter, type FileFilter, type FileFilterInput, KNOWN_TAGS, tagsOf } from "../../src/core/files"

const ALL: FileFilterInput = { files: "", exclude: "^$", types: ["file"], typesOr: [], excludeTypes: [] }

function filter(overrides: Partial<FileFilterInput>): FileFilter {
  const result = compileFilter({ ...ALL, ...overrides })
  if (typeof result === "string") throw new Error(result)
  return result
}

describe("tagsOf", () => {
  test("tags by extension, ignoring case; every file is a file", () => {
    expect([...tagsOf("app/main.py")].sort()).toEqual(["file", "python", "text"])
    expect([...tagsOf("src/Card.TSX")].sort()).toEqual(["file", "text", "tsx"])
    expect([...tagsOf(".github/ci.yml")].sort()).toEqual(["file", "text", "yaml"])
    expect([...tagsOf("Makefile")]).toEqual(["file"])
    expect([...tagsOf(".gitignore")]).toEqual(["file"])
  })

  test("ts and tsx are separate tags, as in pre-commit", () => {
    expect(tagsOf("a.ts").has("tsx")).toBe(false)
    expect(tagsOf("a.tsx").has("ts")).toBe(false)
  })

  test("KNOWN_TAGS has file and every table tag", () => {
    for (const tag of ["file", "text", "python", "ts", "tsx", "javascript", "jsx", "markdown", "yaml", "json"]) {
      expect(KNOWN_TAGS.has(tag)).toBe(true)
    }
  })
})

describe("compileFilter", () => {
  test("the defaults match every file", () => {
    expect(filter({})("any/path/at/all.bin")).toBe(true)
  })

  test("files and exclude are searched in the path, not anchored", () => {
    const services = filter({ files: "services/", exclude: "\\.test\\.py$" })
    expect(services("app/services/users.py")).toBe(true)
    expect(services("app/services/users.test.py")).toBe(false)
    expect(services("app/routes/users.py")).toBe(false)

    const anchored = filter({ files: "^frontend/src/client/" })
    expect(anchored("frontend/src/client/sdk.gen.ts")).toBe(true)
    expect(anchored("other/frontend/src/client/sdk.gen.ts")).toBe(false)
  })

  test("types needs all tags, types_or at least one, exclude_types none", () => {
    const python = filter({ types: ["text", "python"] })
    expect(python("a.py")).toBe(true)
    expect(python("a.ts")).toBe(false)

    const typescript = filter({ typesOr: ["ts", "tsx"] })
    expect(typescript("a.ts")).toBe(true)
    expect(typescript("a.tsx")).toBe(true)
    expect(typescript("a.js")).toBe(false)

    const notDocs = filter({ excludeTypes: ["markdown"] })
    expect(notDocs("README.md")).toBe(false)
    expect(notDocs("a.py")).toBe(true)
  })

  test("reports invalid regexes and unknown tags", () => {
    expect(compileFilter({ ...ALL, files: "(" })).toMatch(/^files: invalid regex: /)
    expect(compileFilter({ ...ALL, exclude: "[" })).toMatch(/^exclude: invalid regex: /)
    expect(compileFilter({ ...ALL, types: ["pyhton"] })).toBe('unknown file type "pyhton"')
    expect(compileFilter({ ...ALL, typesOr: ["tsxx"] })).toBe('unknown file type "tsxx"')
    expect(compileFilter({ ...ALL, excludeTypes: ["md"] })).toBe('unknown file type "md"')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/files.test.ts`
Expected: FAIL: cannot find module `../../src/core/files`.

- [ ] **Step 3: Implement file filters**

`src/core/files.ts`:
```ts
import path from "node:path"

import { errorMessage } from "./errors"

/** Extension (lowercase, with the dot) → file-type tags, after pre-commit's identify. Every file also has "file". */
export const TYPE_TABLE: Readonly<Record<string, readonly string[]>> = {
  ".py": ["text", "python"],
  ".pyi": ["text", "python", "pyi"],
  ".ts": ["text", "ts"],
  ".mts": ["text", "ts"],
  ".cts": ["text", "ts"],
  ".tsx": ["text", "tsx"],
  ".js": ["text", "javascript"],
  ".mjs": ["text", "javascript"],
  ".cjs": ["text", "javascript"],
  ".jsx": ["text", "jsx"],
  ".md": ["text", "markdown"],
  ".mdx": ["text", "mdx"],
  ".yaml": ["text", "yaml"],
  ".yml": ["text", "yaml"],
  ".json": ["text", "json"],
  ".toml": ["text", "toml"],
  ".css": ["text", "css"],
  ".scss": ["text", "scss"],
  ".html": ["text", "html"],
  ".sh": ["text", "shell"],
  ".sql": ["text", "sql"],
  ".go": ["text", "go"],
  ".rs": ["text", "rust"],
  ".txt": ["text", "plain-text"],
}

export const KNOWN_TAGS: ReadonlySet<string> = new Set(["file", ...Object.values(TYPE_TABLE).flat()])

const FILE_ONLY: ReadonlySet<string> = new Set(["file"])

export function tagsOf(file: string): ReadonlySet<string> {
  const tags = TYPE_TABLE[path.posix.extname(file).toLowerCase()]
  return tags ? new Set(["file", ...tags]) : FILE_ONLY
}

export interface FileFilterInput {
  /** Regex searched in the repo-relative path. */
  files: string
  exclude: string
  /** All must match. */
  types: string[]
  /** At least one must match, unless empty. */
  typesOr: string[]
  /** None may match. */
  excludeTypes: string[]
}

export type FileFilter = (file: string) => boolean

function compileRegex(key: "files" | "exclude", source: string): RegExp | string {
  try {
    return new RegExp(source)
  } catch (error) {
    return `${key}: invalid regex: ${errorMessage(error)}`
  }
}

/** A diagnostic message instead of a filter when a regex does not compile or a tag is unknown. */
export function compileFilter(input: FileFilterInput): FileFilter | string {
  const files = compileRegex("files", input.files)
  if (typeof files === "string") return files
  const exclude = compileRegex("exclude", input.exclude)
  if (typeof exclude === "string") return exclude
  const unknown = [...input.types, ...input.typesOr, ...input.excludeTypes].find((tag) => !KNOWN_TAGS.has(tag))
  if (unknown !== undefined) return `unknown file type "${unknown}"`

  const { types, typesOr, excludeTypes } = input
  return (file) => {
    if (!files.test(file) || exclude.test(file)) return false
    const tags = tagsOf(file)
    return (
      types.every((tag) => tags.has(tag)) &&
      (typesOr.length === 0 || typesOr.some((tag) => tags.has(tag))) &&
      !excludeTypes.some((tag) => tags.has(tag))
    )
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/files.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Move the git helpers**

```bash
git mv packages/rulecast/src/core/baseline/git.ts packages/rulecast/src/core/git.ts
git mv packages/rulecast/test/core/baseline/git.test.ts packages/rulecast/test/core/git.test.ts
```

Update the imports:
- `src/core/baseline/baseline.ts`: `import { fileAtCommit } from "./git"` → `import { fileAtCommit } from "../git"`
- `src/core/pipeline.ts`: `import { headCommit, mergeBase } from "./baseline/git"` → `import { headCommit, mergeBase } from "./git"`
- `src/commands/check.ts`: `import { changedFilesSince, mergeBase } from "../core/baseline/git"` → `import { changedFilesSince, mergeBase } from "../core/git"`
- `test/core/baseline/baseline.test.ts`: `import { headCommit } from "../../../src/core/baseline/git"` → `import { headCommit } from "../../../src/core/git"`
- `test/core/git.test.ts`: replace its three import lines
  ```ts
  import { changedFilesSince, fileAtCommit, headCommit, mergeBase } from "../../../src/core/baseline/git"
  import { createRepo, git } from "../../helpers/git"
  import { createProject } from "../../helpers/project"
  ```
  with
  ```ts
  import {
    allFiles,
    changedFilesBetween,
    changedFilesSince,
    fileAtCommit,
    headCommit,
    mergeBase,
    stagedFiles,
  } from "../../src/core/git"
  import { createRepo, git } from "../helpers/git"
  import { createProject } from "../helpers/project"
  ```
  and add `mkdir` to its `node:fs/promises` import: `import { mkdir, rm, writeFile } from "node:fs/promises"`.

- [ ] **Step 6: Write the failing tests for the new listings**

Append inside `describe("git helpers", ...)` in `test/core/git.test.ts`:
```ts
  test("allFiles lists tracked and untracked files but not ignored ones", async () => {
    const root = await createRepo({ ".gitignore": "dist/\n", "a.ts": "a\n", "src/b.ts": "b\n" })
    await mkdir(path.join(root, "dist"), { recursive: true })
    await writeFile(path.join(root, "dist/out.js"), "x\n")
    await writeFile(path.join(root, "new file.ts"), "n\n")
    expect(await allFiles(root)).toEqual([".gitignore", "a.ts", "new file.ts", "src/b.ts"])
  })

  test("stagedFiles lists staged files that still exist", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n" })
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await writeFile(path.join(root, "c.ts"), "c\n")
    await git(root, "add", "a.ts", "c.ts")
    await git(root, "rm", "-q", "b.ts")
    await writeFile(path.join(root, "unstaged.ts"), "u\n")
    expect(await stagedFiles(root)).toEqual(["a.ts", "c.ts"])
  })

  test("changedFilesBetween lists files changed between two commits, and mergeBase takes a second ref", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
    const base = (await headCommit(root))!
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await git(root, "rm", "-q", "c.ts")
    await git(root, "commit", "-q", "-am", "change a, delete c")
    await writeFile(path.join(root, "b.ts"), "uncommitted\n")
    expect(await mergeBase(root, "main", "feature")).toBe(base)
    expect(await changedFilesBetween(root, base, "feature")).toEqual(["a.ts"])
  })
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm vitest run test/core/git.test.ts`
Expected: FAIL: `allFiles`, `stagedFiles` and `changedFilesBetween` are not exported (the moved tests still pass).

- [ ] **Step 8: Implement the listings**

In `src/core/git.ts`, replace:
```ts
type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })
```
with:
```ts
export type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

/** Runs git; a non-zero exit is a result, not an exception. `env` is added to the process environment. */
export async function git(cwd: string, args: string[], env?: Readonly<Record<string, string>>): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: env ? { ...process.env, ...env } : undefined,
    })
```

Replace:
```ts
export async function mergeBase(cwd: string, ref: string): Promise<string> {
  const result = await git(cwd, ["merge-base", "HEAD", ref])
```
with:
```ts
export async function mergeBase(cwd: string, ref: string, other = "HEAD"): Promise<string> {
  const result = await git(cwd, ["merge-base", other, ref])
```

Append:
```ts
function nulSeparated(stdout: string): string[] {
  return [...new Set(stdout.split("\0").filter(Boolean))].sort()
}

/** Tracked and untracked files, not ignored ones: the files `run --all-files` checks. Sorted. */
export async function allFiles(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  if (!result.ok) throw new Error(`git ls-files failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}

/** Staged files that are not deleted. Sorted. */
export async function stagedFiles(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["diff", "--cached", "--name-only", "-z", "--relative", "--diff-filter=d"])
  if (!result.ok) throw new Error(`git diff --cached failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}

/** Files changed from `from` to `to` that exist at `to`. Sorted. */
export async function changedFilesBetween(cwd: string, from: string, to: string): Promise<string[]> {
  const result = await git(cwd, ["diff", "--name-only", "-z", "--relative", "--diff-filter=d", from, to])
  if (!result.ok) throw new Error(`git diff ${from} ${to} failed: ${result.stderr.trim()}`)
  return nulSeparated(result.stdout)
}
```

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run test/core/git.test.ts test/core/files.test.ts`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/rulecast/src/core/files.ts packages/rulecast/src/core/git.ts packages/rulecast/src/core/baseline/baseline.ts packages/rulecast/src/core/pipeline.ts packages/rulecast/src/commands/check.ts packages/rulecast/test/core/files.test.ts packages/rulecast/test/core/git.test.ts packages/rulecast/test/core/baseline/baseline.test.ts
git commit -m "feat: add file-type tags, regex file filters and git file listings

Claude goes brr.. via Dash"
```
(`git mv` already staged the deletions of the old paths.)

---

### Task 4: Version, config and manifest schemas

**Files:**
- Create: `src/core/version.ts`, `src/core/config/schema.ts`, `src/core/config/load.ts`
- Test: `test/core/version.test.ts`, `test/core/config/schema.test.ts`, `test/core/config/load.test.ts`

The old `src/core/compile/config.ts` and `rules.ts` stay in use until Task 10 switches the compiler over.

- [ ] **Step 1: Write the failing version test**

`test/core/version.test.ts`:
```ts
import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

import { isOlder, parseVersion, VERSION } from "../../src/core/version"

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
  expect(VERSION).toBe(pkg.version)
})

test("parseVersion reads X.Y.Z only", () => {
  expect(parseVersion("0.2.10")).toEqual([0, 2, 10])
  expect(parseVersion("v0.2.0")).toBeNull()
  expect(parseVersion("0.2")).toBeNull()
  expect(parseVersion("0.2.0-rc.1")).toBeNull()
})

test("isOlder compares numerically", () => {
  expect(isOlder("0.2.0", "0.10.0")).toBe(true)
  expect(isOlder("0.10.0", "0.2.0")).toBe(false)
  expect(isOlder("1.0.0", "1.0.0")).toBe(false)
  expect(isOlder("0.9.9", "1.0.0")).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/version.test.ts`
Expected: FAIL: cannot find module `../../src/core/version`.

- [ ] **Step 3: Implement version**

`src/core/version.ts`:
```ts
/** The running rulecast version. test/core/version.test.ts keeps it equal to package.json. */
export const VERSION = "0.0.0"

export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Whether `running` is older than `minimum`. Both must be X.Y.Z (the schema checks `minimum`). */
export function isOlder(running: string, minimum: string): boolean {
  const a = parseVersion(running)
  const b = parseVersion(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!
  }
  return false
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/version.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing schema tests**

`test/core/config/schema.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { configSchema, defaultConfig, overrideSchema, ruleSchema } from "../../../src/core/config/schema"

const DEFAULTS = {
  repos: [],
  minimumRulecastVersion: null,
  files: "",
  exclude: "^$",
  defaultStages: null,
  context: { mode: "inject", maxBytes: 32768 },
  maxMatchesPerRule: 10,
  timeouts: { editDeadlineMs: 350, verifyMs: 60000 },
  stopGate: { maxBlocks: 1 },
  llm: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    baseUrl: null,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    maxFilesPerVerify: 10,
  },
}

describe("configSchema", () => {
  test("applies defaults", () => {
    expect(configSchema.parse({ repos: [] })).toEqual(DEFAULTS)
    expect(defaultConfig()).toEqual(DEFAULTS)
  })

  test("maps every snake_case key to the config shape", () => {
    const config = configSchema.parse({
      minimum_rulecast_version: "0.2.0",
      files: "^src/",
      exclude: "^vendor/",
      default_stages: ["edit", "verify"],
      context: { mode: "read", max_bytes: 1000 },
      max_matches_per_rule: 3,
      timeouts: { edit_deadline_ms: 200, verify_ms: 5000 },
      stop_gate: { max_blocks: 2 },
      llm: {
        provider: "openai-compatible",
        model: "m",
        base_url: "http://localhost:11434/v1",
        api_key_env: "KEY",
        max_files_per_verify: 4,
      },
      repos: [
        { repo: "https://github.com/syv-ai/rulecast", rev: "v0.2.0", rules: [{ id: "generated-code" }] },
        { repo: "local", rules: [] },
      ],
    })
    expect(config).toEqual({
      repos: [
        { repo: "https://github.com/syv-ai/rulecast", rev: "v0.2.0", rules: [{ id: "generated-code" }] },
        { repo: "local", rules: [] },
      ],
      minimumRulecastVersion: "0.2.0",
      files: "^src/",
      exclude: "^vendor/",
      defaultStages: ["edit", "verify"],
      context: { mode: "read", maxBytes: 1000 },
      maxMatchesPerRule: 3,
      timeouts: { editDeadlineMs: 200, verifyMs: 5000 },
      stopGate: { maxBlocks: 2 },
      llm: {
        provider: "openai-compatible",
        model: "m",
        baseUrl: "http://localhost:11434/v1",
        apiKeyEnv: "KEY",
        maxFilesPerVerify: 4,
      },
    })
  })

  test("repos are required, keys are snake_case only, and unknown keys are rejected", () => {
    expect(configSchema.safeParse({}).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], maxMatchesPerRule: 5 }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], timeouts: { editDeadlineMs: 1 } }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [{ repo: "local" }] }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [{ repo: "local", rules: [], hooks: [] }] }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], minimum_rulecast_version: "v1" }).success).toBe(false)
    expect(configSchema.safeParse({ repos: [], default_stages: ["commit"] }).success).toBe(false)
  })

  test("repo entries keep their rules unparsed; rev rules are left to compile", () => {
    const config = configSchema.parse({
      repos: [
        { repo: "local", rev: "v1", rules: [{ anything: 1 }] },
        { repo: "https://x.test/y", rules: [] },
      ],
    })
    expect(config.repos).toEqual([
      { repo: "local", rev: "v1", rules: [{ anything: 1 }] },
      { repo: "https://x.test/y", rules: [] },
    ])
  })
})

describe("rule schemas", () => {
  const complete = {
    id: "api/no-client",
    name: "Components never call the API client",
    files: "^src/components/",
    types: ["tsx"],
    detect: { regex: { pattern: "x" } },
    message: "{{file}}",
  }

  test("a complete rule needs id and name; an override needs only id", () => {
    expect(ruleSchema.safeParse(complete).success).toBe(true)
    expect(ruleSchema.safeParse({ id: "a" }).success).toBe(false)
    expect(overrideSchema.safeParse({ id: "a" }).success).toBe(true)
    expect(overrideSchema.safeParse({ id: "a", files: "^app/", context: ["@AGENTS.md#errors"] }).success).toBe(true)
    expect(overrideSchema.safeParse({ files: "^app/" }).success).toBe(false)
  })

  test("applies no defaults, so overrides can merge over manifest rules", () => {
    expect(ruleSchema.parse({ id: "a", name: "A" })).toEqual({ id: "a", name: "A" })
  })

  test("reads every rule key", () => {
    const rule = ruleSchema.parse({
      id: "generated-code",
      alias: "generated-client",
      name: "Generated code",
      description: "Never edit generated files.",
      files: "^frontend/src/client/",
      exclude: "\\.test\\.ts$",
      types: ["ts"],
      types_or: ["ts", "tsx"],
      exclude_types: ["markdown"],
      stages: ["edit", "verify"],
      minimum_rulecast_version: "0.2.0",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
      context: ["@docs/generated.md", { path: "@docs/client.md#regenerating", mode: "read" }],
    })
    expect(rule.alias).toBe("generated-client")
    expect(rule.stages).toEqual(["edit", "verify"])
    expect(rule.context).toHaveLength(2)
  })

  test("rejects bad ids and aliases, bad stages, several detectors and unknown keys", () => {
    expect(ruleSchema.safeParse({ ...complete, id: "Api" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, alias: "Generated Client" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, stages: [] }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, stages: ["commit"] }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, detect: { path: {}, regex: {} } }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, entry: "ruff" }).success).toBe(false)
    expect(ruleSchema.safeParse({ ...complete, typesOr: ["ts"] }).success).toBe(false)
    expect(overrideSchema.safeParse({ id: "a", on: ["touch"] }).success).toBe(false)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run test/core/config/schema.test.ts`
Expected: FAIL: cannot find module `../../../src/core/config/schema`.

- [ ] **Step 7: Implement the schemas**

`src/core/config/schema.ts`:
```ts
import { z } from "zod"

import { referenceInputSchema } from "../references"

export const STAGES = ["touch", "edit", "verify"] as const
export type Stage = (typeof STAGES)[number]

export const RULE_ID = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

const idSchema = z.string().regex(RULE_ID, "must be lowercase segments separated by /")
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version like 0.2.0")
const stagesSchema = z.array(z.enum(STAGES)).nonempty()

/** Every rule key except id. No defaults: compileRule applies them after overrides are merged. */
const ruleKeys = {
  alias: idSchema.optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  files: z.string().optional(),
  exclude: z.string().optional(),
  types: z.array(z.string()).optional(),
  types_or: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  stages: stagesSchema.optional(),
  minimum_rulecast_version: versionSchema.optional(),
  severity: z.enum(["error", "warning"]).optional(),
  detect: z
    .record(z.unknown())
    .refine((value) => Object.keys(value).length === 1, "must name exactly one detector")
    .optional(),
  message: z.string().optional(),
  context: z.array(referenceInputSchema).optional(),
}

/** A config entry selecting a rule from a rule repo; every key but id overrides the manifest rule's. */
export const overrideSchema = z.object({ id: idSchema, ...ruleKeys }).strict()

/** A complete rule: an entry of a `repo: local` repo, or a manifest rule. */
export const ruleSchema = overrideSchema.extend({ name: z.string().min(1) })

export type RuleEntry = z.infer<typeof overrideSchema>

const repoSchema = z
  .object({
    repo: z.string().min(1),
    rev: z.string().min(1).optional(),
    /** Parsed rule by rule in compile, so one bad rule does not reject the config. */
    rules: z.array(z.unknown()),
  })
  .strict()

export const configSchema = z
  .object({
    repos: z.array(repoSchema),
    minimum_rulecast_version: versionSchema.optional(),
    files: z.string().default(""),
    exclude: z.string().default("^$"),
    default_stages: stagesSchema.optional(),
    context: z
      .object({
        mode: z.enum(["inject", "read"]).default("inject"),
        max_bytes: z.number().int().positive().default(32768),
      })
      .strict()
      .default({}),
    max_matches_per_rule: z.number().int().positive().default(10),
    timeouts: z
      .object({
        edit_deadline_ms: z.number().int().positive().default(350),
        verify_ms: z.number().int().positive().default(60000),
      })
      .strict()
      .default({}),
    stop_gate: z
      .object({ max_blocks: z.number().int().nonnegative().default(1) })
      .strict()
      .default({}),
    llm: z
      .object({
        provider: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
        model: z.string().default("claude-haiku-4-5-20251001"),
        base_url: z.string().nullable().default(null),
        api_key_env: z.string().default("ANTHROPIC_API_KEY"),
        max_files_per_verify: z.number().int().positive().default(10),
      })
      .strict()
      .default({}),
  })
  .strict()
  .transform((input) => ({
    repos: input.repos,
    minimumRulecastVersion: input.minimum_rulecast_version ?? null,
    files: input.files,
    exclude: input.exclude,
    defaultStages: input.default_stages ?? null,
    context: { mode: input.context.mode, maxBytes: input.context.max_bytes },
    maxMatchesPerRule: input.max_matches_per_rule,
    timeouts: { editDeadlineMs: input.timeouts.edit_deadline_ms, verifyMs: input.timeouts.verify_ms },
    stopGate: { maxBlocks: input.stop_gate.max_blocks },
    llm: {
      provider: input.llm.provider,
      model: input.llm.model,
      baseUrl: input.llm.base_url,
      apiKeyEnv: input.llm.api_key_env,
      maxFilesPerVerify: input.llm.max_files_per_verify,
    },
  }))

export type Config = z.output<typeof configSchema>
export type RepoEntry = Config["repos"][number]

export function defaultConfig(): Config {
  return configSchema.parse({ repos: [] })
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run test/core/config/schema.test.ts`
Expected: PASS (8 tests). If "rejects … unknown keys" fails for `ruleSchema`, check that `.extend()` kept `.strict()` (zod 3 carries the unknown-keys policy through `extend`); if it did not, call `.strict()` after `.extend(...)`.

- [ ] **Step 9: Write the failing load tests**

`test/core/config/load.test.ts`:
```ts
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  CONFIG_FILE,
  MANIFEST_FILE,
  parseConfig,
  readConfigData,
  readManifest,
  readYamlFile,
} from "../../../src/core/config/load"
import { createProject } from "../../helpers/project"

describe("readYamlFile", () => {
  test("parses YAML; a missing file and a syntax error are messages", async () => {
    const root = await createProject({ "a.yaml": "x: 1\n", "empty.yaml": "", "bad.yaml": "x: [" })
    expect(await readYamlFile(path.join(root, "a.yaml"))).toEqual({ ok: true, value: { x: 1 } })
    expect(await readYamlFile(path.join(root, "empty.yaml"))).toEqual({ ok: true, value: null })
    expect(await readYamlFile(path.join(root, "nope.yaml"))).toEqual({ ok: false, message: "nope.yaml not found" })
    const bad = await readYamlFile(path.join(root, "bad.yaml"))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toMatch(/^bad\.yaml: /)
  })
})

describe("config", () => {
  test("readConfigData reads .rulecast-config.yaml at the root", async () => {
    const root = await createProject({ [CONFIG_FILE]: "repos:\n  - repo: local\n    rules: []\n" })
    expect(await readConfigData(root)).toEqual({ ok: true, value: { repos: [{ repo: "local", rules: [] }] } })
    expect(await readConfigData(await createProject({}))).toEqual({
      ok: false,
      message: ".rulecast-config.yaml not found",
    })
  })

  test("parseConfig validates and names the file in messages", () => {
    const valid = parseConfig({ repos: [] })
    expect(valid.ok && valid.value.maxMatchesPerRule).toBe(10)
    expect(parseConfig({ repos: [], max_matches_per_rule: -1 })).toEqual({
      ok: false,
      message: expect.stringMatching(/^\.rulecast-config\.yaml: max_matches_per_rule: /),
    })
    expect(parseConfig(null)).toEqual({ ok: false, message: expect.stringMatching(/^\.rulecast-config\.yaml: /) })
  })
})

describe("readManifest", () => {
  test("reads a list of rules", async () => {
    const dir = await createProject({ [MANIFEST_FILE]: "- id: a\n  name: A\n" })
    expect(await readManifest(dir)).toEqual({ ok: true, value: [{ id: "a", name: "A" }] })
  })

  test("a missing manifest and a non-list are messages", async () => {
    expect(await readManifest(await createProject({}))).toEqual({
      ok: false,
      message: ".rulecast-rules.yaml not found",
    })
    const dir = await createProject({ [MANIFEST_FILE]: "rules: []\n" })
    expect(await readManifest(dir)).toEqual({ ok: false, message: ".rulecast-rules.yaml: must be a list of rules" })
  })
})
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm vitest run test/core/config/load.test.ts`
Expected: FAIL: cannot find module `../../../src/core/config/load`.

- [ ] **Step 11: Implement loading**

`src/core/config/load.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

import { errorMessage, formatZodError, isNotFound } from "../errors"
import { type Config, configSchema } from "./schema"

export const CONFIG_FILE = ".rulecast-config.yaml"
export const MANIFEST_FILE = ".rulecast-rules.yaml"

export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string }

/** Reads and parses a YAML file; an empty document is null. */
export async function readYamlFile(file: string): Promise<Loaded<unknown>> {
  const name = path.basename(file)
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (isNotFound(error)) return { ok: false, message: `${name} not found` }
    throw error
  }
  try {
    return { ok: true, value: parse(text) ?? null }
  } catch (error) {
    return { ok: false, message: `${name}: ${errorMessage(error)}` }
  }
}

/** The project's config data, not yet validated. */
export function readConfigData(root: string): Promise<Loaded<unknown>> {
  return readYamlFile(path.join(root, CONFIG_FILE))
}

export function parseConfig(data: unknown): Loaded<Config> {
  const result = configSchema.safeParse(data)
  if (!result.success) return { ok: false, message: `${CONFIG_FILE}: ${formatZodError(result.error)}` }
  return { ok: true, value: result.data }
}

/** A rule repo's manifest: a list of rules, each parsed later on its own. */
export async function readManifest(dir: string): Promise<Loaded<unknown[]>> {
  const loaded = await readYamlFile(path.join(dir, MANIFEST_FILE))
  if (!loaded.ok) return loaded
  if (!Array.isArray(loaded.value)) return { ok: false, message: `${MANIFEST_FILE}: must be a list of rules` }
  return { ok: true, value: loaded.value }
}
```

- [ ] **Step 12: Run the tests**

Run: `pnpm vitest run test/core/config test/core/version.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/rulecast/src/core/version.ts packages/rulecast/src/core/config/schema.ts packages/rulecast/src/core/config/load.ts packages/rulecast/test/core/version.test.ts packages/rulecast/test/core/config/schema.test.ts packages/rulecast/test/core/config/load.test.ts
git commit -m "feat: add the .rulecast-config.yaml and manifest schemas

Claude goes brr.. via Dash"
```

---

### Task 5: References resolve against a root

**Files:**
- Modify: `src/core/references.ts`, `src/core/detection/per-rule.ts` (`readSourceFile`), `src/core/types.ts` (`DeliveredReference`), `src/core/session/decide.ts`, `src/core/delivery/render-agent.ts`, `src/core/compile/compile.ts` (the `parseReference` call)
- Test: `test/core/references.test.ts`, `test/core/delivery/resolve.test.ts`, `test/core/session/decide-references.test.ts`, `test/core/delivery/render-agent.test.ts`

- [ ] **Step 1: Write the failing reference tests**

Replace the whole of `test/core/references.test.ts` with:
```ts
import { describe, expect, test } from "vitest"

import { parseReference, type ReferenceRoot, ReferenceSyntaxError } from "../../src/core/references"

const PROJECT: ReferenceRoot = { dir: "/project", label: null }
const REPO: ReferenceRoot = { dir: "/cache/repos/github.com_syv-ai_rulecast/v0.2.0", label: "syv-ai/rulecast@v0.2.0" }

describe("parseReference", () => {
  test("parses a whole-file string reference with the default mode", () => {
    expect(parseReference("@conventions/api.md", "inject", PROJECT)).toEqual({
      ref: "conventions/api.md",
      path: "conventions/api.md",
      anchor: null,
      mode: "inject",
    })
  })

  test("parses an anchor and an explicit mode", () => {
    expect(parseReference({ path: "@conventions/api.md#errors", mode: "read" }, "inject", PROJECT)).toEqual({
      ref: "conventions/api.md#errors",
      path: "conventions/api.md",
      anchor: "errors",
      mode: "read",
    })
  })

  test("object without mode uses the default", () => {
    expect(parseReference({ path: "@src/queries.ts" }, "read", PROJECT).mode).toBe("read")
  })

  test("normalises the path", () => {
    expect(parseReference("@./docs/../AGENTS.md#errors", "inject", PROJECT)).toMatchObject({
      ref: "AGENTS.md#errors",
      path: "AGENTS.md",
    })
  })

  test("a rule repo reference is labelled and has an absolute path in the repo", () => {
    expect(parseReference("@packages/rules-python/errors.md#services", "inject", REPO)).toEqual({
      ref: "syv-ai/rulecast@v0.2.0:packages/rules-python/errors.md#services",
      path: "/cache/repos/github.com_syv-ai_rulecast/v0.2.0/packages/rules-python/errors.md",
      anchor: "services",
      mode: "inject",
    })
  })

  test("rejects malformed references", () => {
    expect(() => parseReference("conventions/api.md", "inject", PROJECT)).toThrow(ReferenceSyntaxError)
    expect(() => parseReference("@", "inject", PROJECT)).toThrow(/has no path/)
    expect(() => parseReference("@conventions/api.md#", "inject", PROJECT)).toThrow(/empty anchor/)
    expect(() => parseReference("@src/queries.ts#exports", "inject", PROJECT)).toThrow(/only supported in .md and .mdx/)
  })

  test("rejects references that leave their root", () => {
    expect(() => parseReference("@../other/AGENTS.md", "inject", PROJECT)).toThrow(/leaves its root/)
    expect(() => parseReference("@docs/../../x.md", "inject", REPO)).toThrow(/leaves its root/)
    expect(() => parseReference("@/etc/passwd", "inject", PROJECT)).toThrow(/leaves its root/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/references.test.ts`
Expected: FAIL: the repo reference test gets a project-style result, and the "leaves its root" test does not throw (`ReferenceRoot` does not exist yet, which typecheck would also report).

- [ ] **Step 3: Implement roots**

Replace the whole of `src/core/references.ts` with:
```ts
import path from "node:path"
import { z } from "zod"

import type { ReferenceMode } from "./types"

export const referenceInputSchema = z.union([
  z.string(),
  z.object({ path: z.string(), mode: z.enum(["inject", "read"]).optional() }).strict(),
])

export type ReferenceInput = z.infer<typeof referenceInputSchema>

/** Where "@" paths resolve: the project, or a rule repo checked out in the cache. */
export interface ReferenceRoot {
  /** Absolute directory. */
  dir: string
  /** null for the project; the rule repo label ("syv-ai/rulecast@v0.2.0") for a rule repo. */
  label: string | null
}

export interface ReferenceSpec {
  /** Identity and display. Project: "docs/api.md#errors". Rule repo: "syv-ai/rulecast@v0.2.0:docs/api.md#errors". */
  ref: string
  /** Project references: repo-relative with forward slashes. Rule repo references: absolute path in the cache. */
  path: string
  anchor: string | null
  mode: ReferenceMode
}

export class ReferenceSyntaxError extends Error {}

export function parseReference(input: ReferenceInput, defaultMode: ReferenceMode, root: ReferenceRoot): ReferenceSpec {
  const raw = typeof input === "string" ? input : input.path
  const mode = typeof input === "string" ? defaultMode : (input.mode ?? defaultMode)
  if (!raw.startsWith("@")) throw new ReferenceSyntaxError(`reference "${raw}" must start with "@"`)
  const body = raw.slice(1)
  const hash = body.indexOf("#")
  const file = hash === -1 ? body : body.slice(0, hash)
  const anchor = hash === -1 ? null : body.slice(hash + 1)
  if (!file) throw new ReferenceSyntaxError(`reference "${raw}" has no path`)
  if (anchor === "") throw new ReferenceSyntaxError(`reference "${raw}" has an empty anchor`)
  if (anchor !== null && !/\.mdx?$/.test(file)) {
    throw new ReferenceSyntaxError(`anchors are only supported in .md and .mdx files: "${raw}"`)
  }
  const relative = path.posix.normalize(file)
  if (path.posix.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) {
    throw new ReferenceSyntaxError(`reference "${raw}" leaves its root`)
  }
  const suffix = anchor === null ? "" : `#${anchor}`
  if (root.label === null) return { ref: `${relative}${suffix}`, path: relative, anchor, mode }
  return { ref: `${root.label}:${relative}${suffix}`, path: path.join(root.dir, relative), anchor, mode }
}
```

In `src/core/compile/compile.ts` (the old compiler, replaced in Task 10), replace:
```ts
      spec = parseReference(input, config.context.mode)
```
with:
```ts
      spec = parseReference(input, config.context.mode, { dir: root, label: null })
```
and give `compileRule` the root: change its signature from
```ts
async function compileRule(
  data: RuleData,
  source: string,
  config: Config,
  registry: DetectorRegistry,
  read: (file: string) => Promise<string | null>,
): Promise<CompiledRule | string> {
```
to
```ts
async function compileRule(
  data: RuleData,
  source: string,
  config: Config,
  registry: DetectorRegistry,
  read: (file: string) => Promise<string | null>,
  root: string,
): Promise<CompiledRule | string> {
```
and its call from
```ts
    const result = await compileRule(parsed.data, file.source, config, registry, read)
```
to
```ts
    const result = await compileRule(parsed.data, file.source, config, registry, read, root)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/core/references.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Update the other callers of `parseReference` in tests**

In `test/core/delivery/resolve.test.ts`, add after the imports:
```ts
const PROJECT = { dir: "/project", label: null }
```
and add `, PROJECT` as the third argument of every `parseReference(...)` call in the file (six calls).

In `test/core/session/decide-references.test.ts`, replace:
```ts
const ref = (text: string, mode: "inject" | "read" = "inject") => parseReference(text, mode)
```
with:
```ts
const ref = (text: string, mode: "inject" | "read" = "inject") => parseReference(text, mode, { dir: "/project", label: null })
```

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for rule repo references**

Append inside `describe("reference resolver", ...)` in `test/core/delivery/resolve.test.ts`:
```ts
  test("resolves rule repo references from their absolute path", async () => {
    const root = await createProject({ "AGENTS.md": "# Project\n" })
    const repo = await createProject({ "docs/errors.md": "# Errors\n\n## Services\nRaise domain errors.\n" })
    const resolver = createReferenceResolver(root)
    const spec = parseReference("@docs/errors.md#services", "inject", { dir: repo, label: "acme/rules@v1" })
    expect(await resolver.resolve(spec)).toMatchObject({ found: true, content: "## Services\nRaise domain errors." })
    expect(await resolver.currentHash(spec.path, "services")).not.toBeNull()
  })
```

Append inside `describe("decide: references", ...)` in `test/core/session/decide-references.test.ts`:
```ts
  test("read references from a rule repo carry their absolute location", async () => {
    const repo = { dir: "/cache/repos/acme/v1", label: "acme/rules@v1" }
    const repoResolver = fakeResolver({ "/cache/repos/acme/v1/docs/state.md": "# State", "/cache/repos/acme/v1/big.md": "x".repeat(500) })
    const decision = await decide(
      input({
        resolver: repoResolver,
        findings: [
          violated("r1", [parseReference("@docs/state.md", "read", repo), parseReference("@big.md", "inject", repo)]),
        ],
      }),
    )
    expect(decision.delivery.references).toEqual([
      { ref: "acme/rules@v1:docs/state.md", state: "read", reason: "mode", location: "/cache/repos/acme/v1/docs/state.md" },
      { ref: "acme/rules@v1:big.md", state: "read", reason: "tooLarge", location: "/cache/repos/acme/v1/big.md" },
    ])
  })
```

Append inside `describe("renderAgentText", ...)` in `test/core/delivery/render-agent.test.ts`:
```ts
  test("read references with a location name the file to read", () => {
    const text = renderAgentText(
      {
        ...emptyDelivery(),
        touches: ["python/layering"],
        references: [
          { ref: "acme/rules@v1:docs/state.md", state: "read", reason: "mode", location: "/cache/acme/docs/state.md" },
          { ref: "acme/rules@v1:big.md", state: "read", reason: "budget", location: "/cache/acme/big.md" },
        ],
      },
      { maxMatchesPerRule: 10 },
    )
    expect(text).toBe(
      [
        "rulecast: conventions for the files you are working on",
        "",
        "--- acme/rules@v1:docs/state.md: read /cache/acme/docs/state.md before continuing ---",
        "--- acme/rules@v1:big.md: read /cache/acme/big.md before continuing (not included, too long for this message) ---",
      ].join("\n"),
    )
  })
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm vitest run test/core/delivery test/core/session/decide-references.test.ts`
Expected: FAIL: the resolver test finds nothing (`readSourceFile` joins the absolute path onto the project root), the decide test has no `location`, and the render test prints "read this". (TypeScript also rejects `location` until Step 8.)

- [ ] **Step 8: Implement locations**

In `src/core/detection/per-rule.ts`, replace:
```ts
/** Reads a repo-relative file; null when it no longer exists. */
export async function readSourceFile(cwd: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.join(cwd, file), "utf8")
```
with:
```ts
/** Reads a repo-relative (or absolute) file; null when it no longer exists. */
export async function readSourceFile(cwd: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(cwd, file), "utf8")
```

In `src/core/types.ts`, replace:
```ts
export interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string
  reason?: "mode" | "budget" | "tooLarge"
}
```
with:
```ts
export interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string
  reason?: "mode" | "budget" | "tooLarge"
  /** State "read" of a reference from a rule repo: the absolute path of the file to read. */
  location?: string
}
```

In `src/core/session/decide.ts`, add `import path from "node:path"` as the first import, and after the `ITEM_OVERHEAD` constant add:
```ts
/** Rule repo references have absolute paths; the agent needs that path to read them. */
function locationOf(spec: ReferenceSpec): { location?: string } {
  return path.isAbsolute(spec.path) ? { location: spec.path } : {}
}
```
Then replace:
```ts
    } else if (spec.mode === "read") {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "mode" })
    } else if (resolved.bytes > input.maxBytes) {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "tooLarge" })
```
with:
```ts
    } else if (spec.mode === "read") {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "mode", ...locationOf(spec) })
    } else if (resolved.bytes > input.maxBytes) {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "tooLarge", ...locationOf(spec) })
```
and replace:
```ts
      delivery.references[index] = {
        ref: resolved.spec.ref,
        state: "read",
        reason: "budget",
      } satisfies DeliveredReference
```
with:
```ts
      delivery.references[index] = {
        ref: resolved.spec.ref,
        state: "read",
        reason: "budget",
        ...locationOf(resolved.spec),
      } satisfies DeliveredReference
```

In `src/core/delivery/render-agent.ts`, replace:
```ts
    case "read":
      return reference.reason === "mode"
        ? [`--- ${reference.ref}: read this before continuing ---`]
        : [`--- ${reference.ref}: read this before continuing (not included, too long for this message) ---`]
```
with:
```ts
    case "read": {
      const what = reference.location === undefined ? "read this" : `read ${reference.location}`
      return reference.reason === "mode"
        ? [`--- ${reference.ref}: ${what} before continuing ---`]
        : [`--- ${reference.ref}: ${what} before continuing (not included, too long for this message) ---`]
    }
```

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run test/core`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/rulecast/src/core/references.ts packages/rulecast/src/core/detection/per-rule.ts packages/rulecast/src/core/types.ts packages/rulecast/src/core/session/decide.ts packages/rulecast/src/core/delivery/render-agent.ts packages/rulecast/src/core/compile/compile.ts packages/rulecast/test/core/references.test.ts packages/rulecast/test/core/delivery/resolve.test.ts packages/rulecast/test/core/session/decide-references.test.ts packages/rulecast/test/core/delivery/render-agent.test.ts
git commit -m "feat: resolve context references against the project or a rule repo

Claude goes brr.. via Dash"
```

Continue with `2026-09-19-rulecast-03b-cache-repos.md`.
