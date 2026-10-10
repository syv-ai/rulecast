# rulecast Plan 11 — Edits Outside the Edit Tools Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A file an agent changes with Bash (`sed -i`, a Python rewrite, a `>` redirect) is checked like one it changes with `Edit`: findings right after the call, a Stop gate that covers it, and `refuse_write` that catches it.

**Approach:** Before and after each Bash call, rulecast records the working tree's state (what `git status` lists, with each path's mtime and size). What changed during the call is the agent's, and runs through the existing `edit` event. At session start it records the same state and snapshots the files already dirty, so a Bash-edited file is judged against its pre-session content. At Stop it sweeps for changes no call explains, and checks them without letting them block. A protected file changed by Bash is reported at once, and blocks Stop until reverted.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: plan 10 is done.

---

## The gap this closes

Measured on `main` at `27897e7` (2026-10-10):

| Where | What happens to a Bash edit |
|---|---|
| `adapters/claude-code/settings.ts:19-21` | Hooks are installed for `Edit\|Write` only. No hook fires on `Bash`. |
| `core/pipeline.ts:294-299` | Stop verifies `work.edited`, which only `PostToolUse` edit events append to. A file changed only through Bash is never verified in the session. |
| `core/guard.ts:46` | `refuse_write` judges an `Edit`/`Write` intent. A protected file rewritten with `sed` is never refused, reported or blocked. |
| spec §8 Snapshots | A file with no snapshot falls back to the session-start commit. An agent that reads with `cat` takes no snapshot, so the user's uncommitted lines in that file would count as the agent's. |
| README, spec §12 | Neither says any of this. |

Git hooks and CI (plan 10) catch it after the session. This plan catches it inside the session.

## Decisions this plan implements

Decided by the user on 2026-10-10, in a brainstorm:

1. **Attribution is per tool call.** The working-tree state is recorded before each Bash call and compared after it. Changes during the call are the agent's. Changes between calls (the user's editor, a formatter, a dev server) are not.
2. **A call during which `HEAD` moved is a git operation, not an edit** (commit, checkout, pull, rebase, stash pop). No edit event runs; the new state becomes the reference.
3. **Watched tools: Bash, plus a sweep.** Changes that no call explains (a background job the agent started, a formatter, the user's own edits) are checked as swept files. They are found in two places: at each `shell-before`, which compares with the agent's latest recorded state before taking its own, so changes in the gap between two calls are never folded into the next call; and at Stop, for the changes since the last call.
4. **Swept files report and never block.** The agent sees their findings as changed outside its tool calls, to fix if a process it started made them. The user's own edits can never trap the agent.
5. **`refuse_write` under Bash is caught after the call.** The agent is told at once and told to revert. Stop blocks while the finding is new, whatever the rule's severity. The user gets a notice. The revert advice depends on the file: `git checkout -- <file>` for a file clean at session start, "undo only your change" for one that had uncommitted work.
6. **Session start records the tree and snapshots the dirty files**, so a Bash-edited file is judged against its pre-session content even when the agent read it with `cat`.

Decided in planning:

7. **The core stays agent-neutral.** The tree state, the comparison and the sweep live in core (`core/session/tree.ts`). An adapter maps its shell tool to two events, `shell-before` and `shell-after`, and its session start to `start`. Codex and Cursor adapters reuse it.
8. **A before-call state is paired with its after-call by `tool_use_id`** when the payload carries one (Task 1 verifies), so subagents running Bash at the same time do not read each other's state. Without an id, the after-call compares with the agent's latest recorded state, else the session's latest (a subagent's first call), else there is no reference: the call records its state and runs no edit event (a session started before this plan was installed).
9. **Cost decides between two hooks and one.** The measure is what the before-call hook *adds*: its p95 minus the p95 of a hook process that does nothing (a `prompt` event, which reads stdin, compiles the config and exits). Spec §13 puts that floor near 80 ms. The limit is 150 ms added, on a large repository. Task 2 measures `treeState` alone; Task 9 measures the whole hook against the floor. If either exceeds the limit, the plan falls back to the after-call hook alone, comparing with the agent's latest recorded state (the brainstorm's third option): Tasks 4 and 6 drop `shell-before`, and changes in the gap between calls are then attributed to the next call, which the user accepted as that option's cost.
10. **Nothing is guessed from the command text.** A `PreToolUse` hook cannot know what a shell command will write; parsing `sed -i` and `>` would refuse harmless commands and miss others.

Out of scope: other tools (MCP, `NotebookEdit`), changes made after Stop, refusing a shell command before it runs.

## Conventions

As plan 10's. In short: pnpm workspace, the CLI in `packages/rulecast/`, `pnpm vitest run <path>` relative to that package, no module-level mutable state, a rule key is four changes, the renderer prices its own output, goldens change only on purpose (Tasks 6 and 8), `pnpm perf` back to back against the parent commit, `pnpm test:linux` before pushing Tasks 2, 5, 6 and 7 (git, the filesystem, mtimes), stage by exact path, commit after every task straight to `main`, messages end with `Via [syv-ai/dash](https://github.com/syv-ai/dash)`. When a planned test fails, find the cause before changing the test.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/session/tree.ts` | **new.** `TreeState`, `treeState(root)`, `treeChanges(before, after)`: the working tree as git sees it, and what changed between two states |
| `src/core/types.ts` | `EventKind` gains `start`, `shell-before`, `shell-after`; `Event.toolUseId`; `Delivery.via`, `Delivery.swept` and `Delivery.refused` |
| `src/core/session/state.ts` | Work records `tree`, `swept`; `edited` gains `via` |
| `src/core/pipeline.ts` | `start`, `shell-before`, `shell-after` events; the Stop sweep |
| `src/core/session/decide.ts` | `gate()`: swept files never block, shell `refuse_write` findings always do; agent wording for shell and swept files |
| `src/core/delivery/render-agent.ts` | Headings for "changed by your Bash command" and "changed outside your tool calls"; refuse advice |
| `src/core/session/oversight.ts` | Notice: a protected file changed by Bash |
| `src/core/baseline/stage.ts` | Snapshots of the files dirty at session start |
| `src/adapters/claude-code/parse.ts` | Bash payloads → `shell-before` / `shell-after`; SessionStart → `start` |
| `src/adapters/claude-code/settings.ts` | Hook groups for Bash |
| `src/commands/doctor.ts` | Says which hooks are missing, not only "not installed" |
| `scripts/perf-fixture.ts`, `scripts/perf.ts` | A Bash-call scenario |
| `test/payloads/claude-code/*.json` | Recorded Bash payloads |
| `README.md`, `agents/reference/rule-format.md`, `docs/specs/2026-09-15-rulecast-design.md` | §7, §8, §9, §12, §13; `refuse_write` wording |

## One owner per rule

| Rule | Owner | Everyone else |
|---|---|---|
| What the working tree's state is, and which paths changed between two states | `treeState` and `treeChanges` in `core/session/tree.ts` | pipeline's `start`, `shell-*` and Stop sweep call them |
| Whether a call was a git operation (`HEAD` moved) | `treeChanges` (it returns `gitOperation`) | pipeline acts on it |
| Which state a new state is compared with | `referenceState(work, agent, toolUseId?)` in `core/session/state.ts` | pipeline (`shell-before` for the gap, `shell-after` for the call, Stop for the sweep) |
| Which files are the agent's, which are swept | `WorkState.edited` (with `via`) and `WorkState.swept` in `state.ts` | `gate()`; the pipeline copies them onto `Delivery.via` / `Delivery.swept`, which is all the renderer reads |
| What blocks Stop | `gate()` in `core/session/decide.ts` | — |
| Whether a file was dirty at session start (revert advice) | the `start` tree record, read through `dirtyAtStart(work, file)` in `state.ts` | the pipeline calls it and puts the answer on `Delivery.refused`; the renderer and `notices` read that |
| The hook groups an adapter installs | `hookGroups` in `adapters/claude-code/settings.ts` | install, uninstall, doctor |

## What this plan deletes

- The spec's "changed through another tool" as an unexplained case in §8: Task 10 replaces it with the shell path and the sweep.
- Nothing in code: the `Edit`/`Write` path stays as it is. The new path joins it at the `edit` event.

---

## Task 1: record real Bash payloads

**Files:** create `test/payloads/claude-code/pre-tool-use.bash.json`, `post-tool-use.bash.json`, `post-tool-use-failure.bash.json`, `post-tool-use.bash.background.json`, `post-tool-use.bash.subagent.json` · modify `test/payloads/claude-code/README.md`

**Behaviour:** The plan rests on facts only a live session can settle, as G3 did in plan 10. Record them before writing code.

- [x] In a scratch project with a logging hook (a `command` that appends stdin to a file) on `PreToolUse`, `PostToolUse` and `PostToolUseFailure` for `Bash`, run a live Claude Code session that: runs a succeeding command; a failing one (`false`); a `sed -i` edit; a background command (`run_in_background`); a subagent's Bash call.
- [x] Record each payload, with the session id and paths scrubbed as the existing payloads are.
- [x] Answer, in the README, with the Claude Code version: does a failing command fire `PostToolUse`, `PostToolUseFailure` or both? Does every payload carry `tool_use_id`, the same on Pre and Post? What does a background call's `PostToolUse` carry, and when does it fire? Does a subagent's carry `agent_id`?
- [x] Update Decisions 8 and 9 if an answer differs from what they assume, before Task 4.
- [x] Commit.

**Recorded (2026-10-10, Claude Code 2.1.296, headless `claude -p`):** a failing command fires `PostToolUseFailure` only (so it maps to `shell-after` too); every Bash payload carries `tool_use_id`, the same on Pre and Post; a background call's `PostToolUse` fires at launch with `backgroundTaskId`, and nothing fires when the job ends (the sweep covers it); a subagent's payloads carry `agent_id`. Decisions 8 and 9 stand unchanged.

## Task 2: the working tree's state, and what changed

**Files:** create `src/core/session/tree.ts` · test `test/core/session/tree.test.ts`

**Behaviour:** `treeState(root)` returns what git lists as changed or untracked, with each path's mtime and size, and `HEAD`. `treeChanges(before, after)` returns the paths that changed between two states, or says the interval was a git operation.

```ts
export interface TreeState {
  head: string | null
  /** Repo-relative path → [mtimeMs, size]; absent from the map means clean (or ignored). */
  entries: Record<string, [mtimeMs: number, size: number]>
}

/** null outside a git repository, or when git fails: the caller stays silent (Decision 9's fallback is cost, not failure). */
export async function treeState(root: string): Promise<TreeState | null>

export function treeChanges(
  before: TreeState,
  after: TreeState,
): { gitOperation: true } | { gitOperation: false; files: string[] }
```

- [x] `treeState`: `git status --porcelain=v1 -z --untracked-files=all` (renames give both paths), then `lstat` each path. A path that no longer exists has size `-1`.
- [x] `treeChanges`: `head` differs → `gitOperation: true`. Otherwise a path is changed when it is in one map and not the other, or its `[mtime, size]` differs. Sorted.
- [x] Tests: an edit to a clean file, an edit to an already dirty file (same status, new mtime), a new untracked file, a deleted file, a revert to clean, a commit (`HEAD` moved), an ignored file (never listed), a rename.
- [x] **Measure:** `treeState` p50/p95 over 50 runs on this repository and on a large one (clone `microsoft/vscode` at depth 1 into the job's tmp, with 0 and with 50 dirty files). Record the numbers in this task. If the large repository's p95 exceeds 150 ms, apply Decision 9's fallback.
- [x] Verify: `pnpm vitest run test/core/session/tree.test.ts` → pass. `pnpm test:linux test/core/session/tree.test.ts` → pass (mtime resolution differs on Linux). Commit.

**Measured (2026-10-10, macOS, load ~5, 50 runs in process):** this repository p50 19 ms, p95 22 ms. `microsoft/vscode` at depth 1 (20,300 files): with a single `git status --untracked-files=all`, p95 155–159 ms with 0 or 50 dirty files, over the limit. The untracked scan is most of it (`status -uno` 31 ms, `ls-files --others` 110 ms), so `treeState` runs tracked changes (`status --porcelain=v2 --branch -uno`) and untracked files (`ls-files --others`) as parallel processes: p50 133–136 ms, p95 142–149 ms. Under the limit with little room; Task 9 measures the whole hook against the floor and decides. **Deviation:** porcelain v2 instead of v1, because its `--branch` header gives `HEAD` without another process.

## Task 3: session records for the tree, shell edits and swept files

**Files:** modify `src/core/session/state.ts` · test `test/core/session/state.test.ts`

**Behaviour:** The work store remembers each recorded tree state, which files the agent changed through a shell, and which files the Stop sweep found.

```ts
// New WorkRecord variants:
| { t: "tree"; phase: "start" | "before" | "after" | "stop"; agent: string; toolUseId?: string; state: TreeState }
| { t: "swept"; file: string }
// Changed:
| { t: "edited"; file: string; via?: "shell" }
```

- [x] `WorkState` gains `latestTree: Map<agent, TreeState>` (the last `tree` record of any phase for that agent, in store order: the store is append-only, so record order is time order), `sessionLatestTree: TreeState | null` (the last of any agent), `beforeTrees: Map<toolUseId, TreeState>`, `startTree: TreeState | null`, `swept: string[]`, and `editedVia: Map<string, "tool" | "shell">`. A file edited by any tool leaves `swept`.
- [x] `referenceState(work, agent, toolUseId?)`: with an id, the `before` state recorded under it; otherwise, or when there is none, `latestTree.get(agent)`; else `sessionLatestTree`; else null.
- [x] Tests: the ordering across phases (`before`, then `after`, then `stop`: the latest is the `stop` state); two agents interleaved; a missing id.
- [x] `dirtyAtStart(work, file)`: whether the `start` state lists the file.
- [x] Old stores without these records read as before.
- [x] Verify: `pnpm vitest run test/core/session/state.test.ts` → pass. Commit.

## Task 4: events and the Claude Code mapping

**Files:** modify `src/core/types.ts:3,27-41` · modify `src/adapters/claude-code/parse.ts` · modify `src/adapters/claude-code/settings.ts:14-27` · modify `src/testing/adapter-contract.ts` · modify `src/commands/doctor.ts` · tests `test/adapters/claude-code/parse.test.ts`, `test/adapters/claude-code/settings.test.ts`, `test/commands/install.test.ts`, `test/commands/doctor.test.ts`

**Behaviour:** `EventKind` gains `start`, `shell-before` and `shell-after`; `Event` gains `toolUseId?`. Claude Code's Bash payloads map to the shell events, and SessionStart `startup`/`resume` to `start` (keeping warm-up). `install` adds the Bash hooks; an install from plan 10 is upgraded in place.

- [x] parse: the Bash branch comes before `fileTool` is parsed (it requires `tool_input.file_path`, which a Bash payload lacks). Add `tool_use_id` to the `common` schema, optional. `PreToolUse` with `tool_name: "Bash"` → `shell-before`; `PostToolUse` (and `PostToolUseFailure`, if Task 1 found it fires for a failed command) with `Bash` → `shell-after`. `files` is empty; `toolUseId` from the payload. Use the Task 1 payloads as fixtures.
- [x] SessionStart `startup` and `resume` → a `start` event, `warmup` unchanged.
- [x] `hookGroups`: `PreToolUse` `Bash` (5 s), `PostToolUse` `Bash` (5 s; it can run an edit event), and `PostToolUseFailure` `Bash` if Task 1 says so. `mergeHooks` adds groups missing from an older install and reports them in `added`.
- [x] `doctor`: an install missing some groups says `hooks for Bash missing; run rulecast install`, not "not installed".
- [x] Until Tasks 5 and 6 handle them, `runPipeline` returns an empty delivery for `start`, `shell-before` and `shell-after`, the way it does for `prompt`. Any `switch` on `EventKind` elsewhere (typecheck finds them) treats them as producing no output. The contract test's fixtures stay valid.
- [x] Verify: the four test files above → pass. Commit.

**Done with two additions:** `Event.failed` marks a `shell-after` from `PostToolUseFailure`, because Claude Code takes that hook's `additionalContext` only under its own `hookEventName`; and `hookState` reports the groups a partial install is missing, so `install` upgrades that file in place instead of writing a second copy into the shared settings.

## Task 5: session start records the tree and snapshots the dirty files

**Files:** modify `src/core/pipeline.ts:189-215` · modify `src/core/baseline/stage.ts` · test `test/core/pipeline-shell.test.ts` (new)

**Behaviour:** A `start` event writes the baseline's `start` record (as the first event of any kind does today), a `tree` record with phase `start`, and snapshots of the dirty files that any rule matches. A file the agent later changes with Bash, having only `cat`-ed it, is classified against its pre-session content.

- [x] `start`: `treeState(root)`; on null, nothing more (one warning per session, key `tree-unavailable`, "rulecast cannot see the working tree here; edits made with Bash are checked only by git hooks and CI").
- [x] Snapshots through `touchRecords` in `baseline/stage.ts`, which already does first-writer-wins: a `resume` never replaces a snapshot. At most 200 dirty files, and only within `timeouts.edit_deadline_ms` (SessionStart's hook timeout is 5 s): files past either limit get no snapshot and fall back to the session-start commit as today, logged once with the count.
- [x] Tests: a dirty file snapshotted at start; a clean file not snapshotted (the commit fallback is exact); a resumed session keeps its first snapshot; outside git, a single warning and no records.
- [x] Verify: `pnpm vitest run test/core/pipeline-shell.test.ts` → pass. `pnpm perf` against the parent: the edit hook is unchanged (measured in Task 9, back to back against `4de580b`). Commit.

## Task 6: a Bash call's changes go through the edit event

**Files:** modify `src/core/pipeline.ts` · modify `src/core/delivery/render-agent.ts` · tests `test/core/pipeline-shell.test.ts`, `test/goldens/delivery/shell-edit.*`

**Behaviour:** `shell-before` records the tree state. `shell-after` compares it with the reference state (Task 3), and runs the existing `edit` path on the changed files that a rule matches, with `edited` records marked `via: "shell"`. The agent text names the trigger.

- [x] `shell-before`: take `now = treeState(root)`; compare with `referenceState(work, agent)` (no id: the gap since the agent's last state); a git operation or no reference sweeps nothing; otherwise append `swept` records for the matched changed files not already in `edited`. Then append a `before` tree record with the `toolUseId`. No output: swept findings are reported at Stop (Task 7), and this hook must stay within Decision 9's limit.
- [x] `shell-after`: `treeChanges(referenceState(work, agent, toolUseId), now)`. No reference: append the `after` state and return nothing. A git operation: the same. Otherwise append the `after` state and run the edit path on `relevant(files)`, exactly as `PostToolUse` `Edit` does: deadline, overflow and budget unchanged.
- [x] `Delivery` gains `via?: "shell"`, set by the pipeline for a `shell-after` delivery. Render: the title says `changed by your Bash command` instead of naming an edit. The wording is a constant in `render-agent.ts`, priced by `deliveryCost` there, never in `decide.ts`. Golden `shell-edit`.
- [x] Tests, each through `runPipeline` in a git fixture: `sed -i` style rewrite of a clean file (finding, new); a Python rewrite of a dirty-at-start file (only the agent's lines are new); a `>` redirect creating a file; a deleted file (no detector run, no crash); `git checkout` of another branch (no edit event); `git commit` during the call (no edit event); a codemod across 40 files (the edit deadline delivers what finished and points at the rest); a call that changes no matched file (no output); a `shell-after` with no reference at all (no output, its state recorded); a file the user changes between two calls, then a call that changes another file (the user's file is swept, not the call's).
- [x] Verify: the tests above and `pnpm vitest run test/core/delivery/goldens.test.ts` → pass. `pnpm test:linux test/core/pipeline-shell.test.ts`. Commit.

## Task 7: the Stop sweep, and what blocks

**Files:** modify `src/core/pipeline.ts:291-335` · modify `src/core/session/decide.ts:484-493` · modify `src/core/delivery/render-agent.ts` · tests `test/core/pipeline-shell.test.ts`, `test/core/session/decide-shell.test.ts` (new), `test/goldens/delivery/swept.*`

**Behaviour:** At a Stop, the pipeline compares the tree with the agent's latest recorded state. Files that changed and no call explains are recorded as `swept`, verified with the rest, and reported under their own heading. Their findings never block.

- [x] Stop (and `SubagentStop`): `treeChanges(referenceState(work, agent), now)`; not a git operation → `swept` records for the matched files not already in `edited` (by any agent); append a `stop` tree record. Verify `edited ∪ swept`. A subagent's Stop therefore also reports the main agent's gap changes as swept; they never block, so that is noise at worst, and it is said in the spec.
- [x] `gate()` takes the swept set and ignores findings in swept files. (Shell `refuse_write` is Task 8.)
- [x] `Delivery` gains `swept?: string[]`, set by the pipeline. Render: findings in those files under `changed outside your tool calls (fix them if a process you started made them; they do not block)`, after the agent's own. Priced in `render-agent.ts`. Golden `swept`.
- [x] Tests: a background job that writes a violation after its call → reported at Stop, Stop allowed; the same write followed by another Bash call that changes nothing (swept by that call's `shell-before`) → reported at Stop, Stop allowed; the user's edit between calls → the same; a file in both `edited` and changed again between calls → stays the agent's and blocks; no tree (outside git) → Stop verifies `edited` as today.
- [x] Verify: the three test files → pass. Commit.

**Done with one addition:** Claude Code's Stop hook reaches the agent only by blocking, so on an allowed Stop the swept findings go to the user as a `systemMessage`; on a blocked one they are in the agent's reason under their heading. The budget groups findings by block (rule, swept or not), so a rule with findings on both sides is priced as the two blocks it prints.

## Task 8: `refuse_write` under Bash

**Files:** modify `src/core/session/decide.ts` · modify `src/core/delivery/render-agent.ts` · modify `src/core/session/oversight.ts` · tests `test/core/pipeline-shell.test.ts`, `test/core/session/oversight.test.ts`, `test/goldens/delivery/shell-refused.*`

**Behaviour:** A finding of a `refuse_write` rule in a file changed through Bash is told at once with revert advice, blocks Stop while it is new whatever the rule's severity, and gives the user one notice.

- [x] `gate()`: a new finding whose rule has `refuseWrite` and whose file has `editedVia === "shell"` blocks, at any severity. The stop-block cap applies as for any block.
- [x] `Delivery` gains `refused?: { file: string; rule: string; dirtyAtStart: boolean }[]`: the pipeline fills it for each new finding of a `refuseWrite` rule in a file with `editedVia === "shell"`, calling `dirtyAtStart(work, file)`. The renderer and `notices` read only that.
- [x] Render: the rule's message and section, and `This file is protected; revert your change.` followed by `git checkout -- <file>` when `dirtyAtStart` is false, or `It had uncommitted changes before this session: undo only your change, not the whole file.` when true. Golden `shell-refused`.
- [x] `notices`: `rulecast: the agent changed a protected file with Bash: <file> (<rule>)`, keyed once per file and rule, with the existing `noticed` records.
- [x] Tests: a `path` rule on `src/client/` with `refuse_write`, file changed by Bash → told at once, Stop blocks, the user gets the notice; reverted with `git checkout` → the next Stop allows; a dirty-at-start protected file → the "undo only your change" advice; the same file changed by `Edit` → the existing guard path, unchanged.
- [x] Verify: the three test files → pass. Commit.

## Task 9: what it costs

**Files:** modify `scripts/perf-fixture.ts` · modify `scripts/perf.ts`

**Behaviour:** `pnpm perf` reports the Bash hooks next to the edit hook: `shell-before` p50/p95, `shell-after` with a one-file change, and the floor (a `prompt` event). `shell-after` is held to the 500 ms budget; `shell-before` to Decision 9's limit, 150 ms over the floor. Exceeding it triggers Decision 9's fallback, recorded as a deviation.

- [x] Fixture: the existing 30-rule project in a git repository with 20 dirty files; 50 calls each.
- [x] Verify: `pnpm perf` → all within budget, recorded in the index row. Commit.

**Measured (2026-10-10, macOS, load 7–9):** back to back, the edit hook at `4de580b` p50 188 ms, p95 202 ms; with this plan p50 189 ms, p95 213 ms (204 in an earlier run): unchanged within noise. Bash hooks on the fixture (20 dirty files): before p50 105 ms, p95 121 ms; after p50 230 ms, p95 282 ms; floor p50 95 ms, p95 114 ms, so before adds 7 ms. On `microsoft/vscode` (one rule, 30 calls, alternating with the floor): before p95 204 ms against a floor of 69 ms, **135 ms added, under the 150 ms limit: no fallback.** Starting the tree read before compiling the config was tried and measured no faster (p95 204 ms both ways); it was not kept.

## Task 10: docs

**Files:** modify `README.md` · modify `agents/reference/rule-format.md` · modify `docs/specs/2026-09-15-rulecast-design.md` · run `pnpm readme`

- [ ] README: what rulecast checks during a session ("files the agent changes, with its edit tools or with Bash"); the `refuse_write` section says it refuses edit-tool writes before they happen and catches shell writes right after.
- [ ] rule-format: `refuse_write` the same way.
- [ ] Spec: §7 the three event kinds; §8 session-start snapshots of dirty files, and the "another tool" case rewritten; §9 tree records, the sweep, `gate()`'s two new rules; §12 the hook table's Bash rows and the payload facts from Task 1; §13 the Bash hook budget.
- [ ] Verify: `pnpm readme --check`; `pnpm test`. Commit.

## Task 11: changeset, index, review

**Files:** create `.changeset/plan-eleven-shell-edits.md` · modify `docs/plans/2026-09-15-rulecast-00-index.md`

- [ ] Minor changeset, leading with what changes for a user: Bash edits are now checked during the session, and `refuse_write` catches them.
- [ ] Index row for plan 11 with status, perf numbers and deviations.
- [ ] End-to-end verification below, `pnpm test:linux` (full), and a fresh-context review of the diff against this plan.
- [ ] Commit and push.

---

## End-to-end verification

In a scratch git project with `rulecast install` run from a `pnpm pack` of this build, a rule `no-print` (`regex`, error) on `app/`, and a `refuse_write` `path` rule on `src/client/`:

1. A live Claude Code session: ask the agent to add a `print(` to `app/a.py` using only `sed`. The `PostToolUse` output carries the finding headed `changed by your Bash command`; Stop blocks.
2. Ask it to fix the file with Python. Stop allows.
3. Ask it to rewrite `src/client/api.ts` with `sed`. It is told the file is protected and to run `git checkout -- src/client/api.ts`; Stop blocks; the user sees the notice. After the revert, Stop allows.
4. While the agent works, edit `app/b.py` yourself to add a `print(`. At Stop it is reported as changed outside the agent's tool calls, and Stop is not blocked by it.
5. Have the agent run `git stash && git stash pop`. No edit event is reported.
6. A file with your uncommitted lines that the agent changes via Bash, having read it with `cat`: only the agent's lines are new.
7. `rulecast doctor` on a plan-10 install: `hooks for Bash missing; run rulecast install`. After `install`: ok.
8. `pnpm test`, `pnpm typecheck`, `pnpm test:linux`, `pnpm perf` back to back against the parent: the edit hook unchanged, the Bash hooks within budget.

## Open

- Overlapping Bash calls from two subagents attribute a change made in the overlap to both. The pairing by `tool_use_id` (Decision 8) keeps their reference states apart, but the files changed in the overlap are seen by both.
- MCP tools and `NotebookEdit` that write files are swept at Stop (reported, never blocking) rather than watched per call.
