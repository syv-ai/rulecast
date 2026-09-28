# rulecast Plan 8b — `run --all-files` as an adoption backlog

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rulecast run --all-files` answers the question a team adopting a rule actually has — *how much of this do we already owe, and where* — instead of printing a wall of findings and a count of errors. The absolute size of the backlog, per rule and per file, becomes the headline number, and `--format json` publishes it so it can be tracked over time.

**Approach:** Presentation only. `Finding.status` is already `"new" | "preexisting"`, `Delivery.preexistingSummary` already sits alongside `findings`, and `--all-files` already has no baseline, so every violation in the repository is already in the delivery. What is missing is a summary that names the stock rather than the rate, a `--summary` flag for when the per-finding lines are noise, and wording in the per-edit delivery that stops calling the backlog "not blocking" as if that were the end of it.

**Stack:** Node ≥ 20.12, TypeScript 5, vitest.

Prerequisite: plan 7 is done. Independent of `08a` and `08c`.

---

## The evidence this implements

Route handlers calling the DB layer directly, on `main`, in one real codebase:

| date | violating / total |
|---|---|
| 2026-01-15 | 61 / 80 |
| 2026-06-01 | 58 / 143 |
| 2026-09-25 | 57 / 194 |

The **rate** fell from 76% to 29%. The **count** did not move while the codebase nearly tripled. New code mostly complies; the old violations were never remediated, only diluted. A team watching the rate would believe it was fixing the problem.

It compounds: edits to files that already followed the rule almost never broke it (2%), against 37% in files that mostly did not. A cleaned file is roughly self-maintaining, so the unit of remediation is a whole file, and per-edit enforcement re-fights divergent files indefinitely while never reaching the stock.

**Caveat to carry into the output, not just this document:** 2% is one rule across 19 files, and clean files may simply be simpler ones. The causal direction is suggested, not established. So the summary says *"a file that already follows a rule rarely breaks it"* and does not promise a mechanism.

## Decisions this plan implements

1. **The headline is a count, never a percentage.** A rate is exactly the number that made the codebase above look like it was improving. The summary prints violations and the files they are in; it never divides one by the other.

2. **`--all-files` prints the summary; `--summary` prints only the summary.** Two separate needs: someone adopting a rule wants the shape of the problem, and someone in CI wants the list. `--all-files` gives both, summary last so it is what is left on screen. `--summary` suppresses the per-finding lines for the adoption conversation, and is allowed with any file selection.

3. **The summary is computed in the formatter, from the delivery.** No new field on `Delivery` and no change to the pipeline: `findings` plus `preexistingSummary` is everything the summary needs. Spec §12 already says `--format json` is a named projection rather than a serialised `Delivery`, and this plan keeps that — `backlog` is added to the JSON explicitly.

4. **The per-edit wording changes, the per-edit behaviour does not.** The hook cannot count the repository's backlog inside `edit_deadline_ms` (§13), and must not try. What it can do is stop describing the pre-existing set as "not blocking" — which reads as *ignore this* — and name the command that shows the whole of it. Pre-existing findings still never block, and the exit codes are untouched.

## Conventions

As plan 8a: pnpm workspace, `packages/rulecast/`, vitest, biome + typecheck on commit, full suite on push, commit after every task straight to `main`, messages ending with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`. This plan touches no filesystem behaviour, so `pnpm test:linux` is a courtesy rather than a requirement.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/adapters/cli/backlog.ts` | **new.** `summarise(delivery)` → the backlog model; `renderBacklog(summary)` → the text |
| `src/adapters/cli/format.ts` | `terminal` appends the summary; `json` gains `backlog`; `FormatOptions` gains `backlog` and `findings` |
| `src/commands/run.ts` | `--summary`; passing the flags into `formatDelivery` |
| `src/commands/usage.ts` | `--summary` in the help for `run` |
| `src/core/delivery/render-agent.ts:171-177` | The pre-existing wording |
| `src/adapters/cli/format.ts:36-38` | The same wording in the terminal format |
| `src/index.ts` | Exports `summarise`, `BacklogSummary` |
| `test/adapters/cli/backlog.test.ts` | **new.** The model and the rendering |
| `test/commands/run.test.ts` | `--all-files` prints it, `--summary` suppresses the findings, `--format json` carries it |
| `test/commands/help.test.ts` | The usage text gains `--summary` |
| `test/core/delivery/render-agent.test.ts` | The new pre-existing wording |
| `docs/specs/2026-09-15-rulecast-design.md` | §11, §12 (CLI), §17 |
| `README.md` | The adoption section |

---

## Task 1: the backlog model

**Files:** create `src/adapters/cli/backlog.ts` · test `test/adapters/cli/backlog.test.ts`

**Behaviour:** A delivery becomes a summary: per rule, how many violations and in how many files; per file, how many violations; and the totals. Counts respect `Finding.count`, which merges repeats of the same message in the same file. Pre-existing summaries count too — with `--all-files` there are none, but with `--from-ref` they are most of the backlog.

```ts
export interface BacklogSummary {
  rules: { rule: string; violations: number; files: number }[]   // violations desc, then rule asc
  files: { file: string; violations: number }[]                  // violations desc, then file asc
  totalViolations: number
  totalFiles: number
}

export function summarise(delivery: Delivery): BacklogSummary
export function renderBacklog(summary: BacklogSummary, options: { topFiles: number }): string
```

- [ ] Write the failing tests first: two rules across three files with repeats produce the right per-rule and per-file counts; `totalFiles` counts distinct files with at least one violation, not the sum of the per-rule file counts; a delivery with only `preexistingSummary` entries still produces a summary; an empty delivery produces zeroes and renders as `no violations`.
- [ ] `renderBacklog` prints a rule table, then the worst `topFiles` files, then the two sentences the evidence supports and no more:
  - `This is the stock, not a rate. Enforcement on edits does not reduce it.`
  - `Remediate a file at a time: a file that already follows a rule rarely breaks it.`
- [ ] Columns are aligned by padding, single-space separated, in the style of the existing `terminal` finding lines. No box drawing, no colour.
- [ ] Verify: `pnpm vitest run test/adapters/cli/backlog.test.ts` → passes.
- [ ] Commit.

## Task 2: `--all-files` prints it, `--summary` isolates it

**Files:** modify `src/adapters/cli/format.ts:7-9,13-54,62-75,107-118` · modify `src/commands/run.ts:15-83,121-145` · modify `src/commands/usage.ts` · test `test/commands/run.test.ts` · test `test/commands/help.test.ts`

**Behaviour:** `rulecast run --all-files` prints the findings and then the backlog summary. `rulecast run --summary` prints the summary alone, with any file selection. `--format json` carries a `backlog` object whichever flags were given. Exit codes are unchanged: `--summary` still exits 1 on a new error finding.

- [ ] `FormatOptions` gains `backlog: boolean` (append the summary) and `findings: boolean` (print the per-finding lines). `terminal` honours both; `agent`, `sarif` ignore both; `json` always includes `backlog`, because a consumer that did not ask for it can ignore a key and one that wanted it cannot conjure it.
- [ ] `parseRunArgs` gains `summary: boolean` from `--summary`. `--summary` with `--format sarif` is a `UsageError` naming both — SARIF has no place to put it and silently ignoring a flag is how people lose trust in a tool.
- [ ] `executeRun` passes `{ backlog: run.allFiles || run.summary, findings: !run.summary }`.
- [ ] `usage.ts`: `--summary   print only the backlog summary` under `run`.
- [ ] Tests, against the existing fixture repo: `--all-files` output ends with the summary and still lists findings; `--summary` output has no finding lines and the same exit code as the same run without it; `--from-ref` with `--summary` counts pre-existing findings; `--format json --all-files` parses and `backlog.totalViolations` matches the findings; `--summary --format sarif` exits 2 with the usage message.
- [ ] Verify: `pnpm vitest run test/commands` → passes.
- [ ] Commit.

## Task 3: stop calling the backlog "not blocking"

**Files:** modify `src/core/delivery/render-agent.ts:171-177` · modify `src/adapters/cli/format.ts:36-38` · test `test/core/delivery/render-agent.test.ts` · test `test/core/session/decide-findings.test.ts`

**Behaviour:** The pre-existing block in both renderings is headed as a backlog and names the command that shows all of it. The character cost is bounded — this is inside the §9 budget — so it is one heading line, not a paragraph, and it appears only when there is at least one pre-existing summary.

- [ ] Replace `pre-existing (not blocking): <rule> ×N in <file>` with a heading line `backlog in files you touched (not from your edit):` followed by the existing `<rule> ×N in <file>` lines, and a closing line `see all of it: rulecast run --all-files --summary`.
- [ ] The heading and the closing line are two items in the same list the budget already measures. Check the §9 accounting in `decide.ts:341-351` still charges for what is printed: if the two new lines are not charged, a delivery at the budget's edge overflows. Charge them with the first summary.
- [ ] Update the golden `Delivery` renderings in the session scenario tests.
- [ ] Verify: `pnpm vitest run test/core` → passes; `pnpm test` → passes.
- [ ] Commit.

## Task 4: document it

**Files:** modify `docs/specs/2026-09-15-rulecast-design.md:602-628,656-675,829-836` · modify `README.md`

- [ ] §11 Delivery rendering: the pre-existing block's new shape.
- [ ] §12 CLI: `--summary` in the `run` flags; `backlog` in the `--format json` projection.
- [ ] §17: `run --all-files` as an adoption backlog in the 0.2 row.
- [ ] `README.md`: a short adoption section — point a rule at a repository with `rulecast run --all-files --summary`, read the count not the rate, fix a file at a time. Include the 61/80 → 57/194 table; it is the whole argument in four numbers.
- [ ] Verify: `pnpm test` → passes.
- [ ] Commit.

---

## End-to-end verification

1. `pnpm test` → no failures. `pnpm typecheck` → clean.
2. In a repository with a catalog rule enabled:
   - `rulecast run --all-files --summary` → a rule table, a worst-files list, a total, and the two sentences. No finding lines.
   - `rulecast run --all-files` → findings, then the same summary.
   - `rulecast run --all-files --format json | jq .backlog.totalViolations` → a number matching the finding count.
   - `rulecast run --summary` with nothing staged → `no violations`, exit 0.
3. Edit a file with pre-existing violations through the Claude Code hook and confirm the delivery says `backlog in files you touched` and points at `rulecast run --all-files --summary`.
