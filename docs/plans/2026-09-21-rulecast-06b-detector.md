# rulecast Plan 6b — The `llm` detector Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `detect: { llm: { model: haiku, question: … } }` works end to end — one call per file and model, covering every llm rule that selected that file, with changed lines marked, grounding attached, answers cached, and a per-verify file budget that names what it skipped.

**Architecture:** `llm` is not a `perRule` detector: spec §6 batches per file across rules, like `linter` does per tool. Its `run` groups the selected rules into calls keyed by `(file, model)`, builds one prompt per call, asks the configured provider, and fans the answers back out to the rules that asked. Two layers sit under it and are tested on their own: `prompt.ts` turns a call into text (pure, no I/O), and `call.ts` wraps the provider with the content-addressed cache. The per-verify file budget lives in the **pipeline**, not the detector, because only the pipeline knows which files were edited most recently and only the pipeline can emit a warning.

**Tech Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: `2026-09-21-rulecast-06a-providers.md` is done. Continue with `2026-09-21-rulecast-06c-providers-catalog.md`.

---

## Decisions this plan implements

1. **One call per (file, model), not per file.** Spec §6 says one call per file because it assumed one project-wide model. With `model` on the rule (6a, Decision 1), two rules on the same file may want different models, and a call can only use one. Rules are therefore grouped by `file` then `model`; a file with three rules all on `haiku` is still one call. Spec §6 is updated to say so in 6c.

2. **Empty change set → skipped. Absent from `changes` → whole file, unmarked.** Spec §6's "files whose change set is empty are not sent" and "no marks and a whole-file judgement when the file has no change set" are two different states of the same map, and `DetectorRun.changes`'s own doc-comment already pins them: "File absent = no baseline, the whole file is new." The detector must apply the skip itself rather than lean on the pipeline, which only filters empty change sets for session verifies (`src/core/pipeline.ts:152-155`) — a `rulecast run --from-ref` or a contract-suite run reaches the detector unfiltered.

3. **Failures split the way spec §14 splits them.**

   | What happened | `DetectorResult` | Effect |
   |---|---|---|
   | No `claude` binary / no API key (`LlmUnavailableError`) | `{ rule: null, message }` | Every llm rule disabled for the session, **one** warning naming them (§14 row 3) |
   | Any other provider throw, unparseable answer, unmapped model alias | one error per rule in that call | Those rules disabled, others keep working (§14 rows 2 and 8) |
   | Abort | rethrown | The core records a deadline/timeout, not an error |

   This is the mirror image of `linter`, which never reports a whole-run error because one broken tool must not disable the other two. `llm` has a single provider for the whole run, so a missing provider genuinely is a failure of the run — and §14 asks for exactly one warning, which only `rule: null` produces.

4. **`match.text` is the file's own line, not the model's `text`.** Every other detector's `{{text}}` is the source that matched, and the file is the thing we actually have. The model is still asked for `text`, because quoting the line it means measurably improves which line number it reports, but the answer is used only to check the model against the file (Decision 5), never rendered. `endLine` is `line` and `column` is `1`: a model reports lines, not ranges.

5. **The answer is filtered against the file before it becomes findings.** A model will occasionally name a rule that was not in the call, a line past the end of the file, or a line it was told not to look at. None of these is an error worth disabling a rule over, and one of them — an unknown rule id — would become `detector reported unknown rule "x"`, a **whole-run** error in `src/core/detection/run.ts:88-93`, taking every llm rule down because one model hallucinated. So each answered finding is dropped, silently, when:
   - its `rule` was not one of the call's rules;
   - its `line` is below 1 or past the file's last line;
   - the call had marks and its `line` is not inside the rule's changed lines.

   Dropped findings go to nothing — there is no log sink in a detector run. The count is not surfaced; a model that answers about nothing real simply produces no findings, which is the correct outcome.

6. **The cache key is the whole call, hashed.** Spec §6: "hash of file content, change set, model, and the ids, configs and grounding content of the rules in the call." Implemented as `sha256` over a canonical JSON of exactly that, plus the **provider name** — the same alias resolves to a different model for a different provider, so a project that switches from `claude-code` to `anthropic` must not read the old answers. The cached value is the provider's `LlmFinding[]`, before filtering, so Decision 5's rules can change without invalidating every cached answer. The cache is `input.cache`, which the pipeline backs with `<stateDir>/cache/llm` (`src/core/detection/cache.ts`).

7. **The budget is the pipeline's job.** Spec §6: "At most `llm.max_files_per_verify` files per verify, most recently edited first; skipped files are named in a warning." A detector cannot emit a warning — `DetectorResult` has findings and errors and nothing else — and it has no idea which file was edited most recently. The pipeline has both: `view.work.edited` is documented as "unique, least recently edited first" (`src/core/session/state.ts:16`), so reversing it gives the order spec §6 asks for. `applyFileBudget` is written kind-agnostic and called for `"llm"`, the same way `run --no-llm` already passes `skipDetectorKinds: new Set(["llm"])` from `src/commands/run.ts:139` — the core does not hardcode the string, its callers do.

8. **Grounding sends resolved reference content regardless of delivery mode.** Spec §6 is explicit: "for rules with `grounding: true`, the rule's resolved references regardless of their delivery mode". `DetectorRuleInput.context` is already exactly that — `runPipeline`'s `contextFor` resolves every spec and hands over `{ ref, content }` with no regard for `inject` vs `read` (`src/core/pipeline.ts:167-175`). So grounding is a filter on a list the detector is already given, not new plumbing. `grounding` defaults to `true`, as the spec's example shows.

## Conventions

Identical to plan 6a — read that plan's Conventions section. In particular: **no test in `pnpm test` may call a real model**, tests get their own `RULECAST_HOME`, and every task ends in a commit straight to `main`.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/detectors/llm/schema.ts` | `model`, `question`, `grounding` |
| `src/detectors/llm/prompt.ts` | A call → the prompt text (pure) |
| `src/detectors/llm/call.ts` | Cache key, cache read/write, the provider call |
| `src/detectors/llm/detector.ts` | Grouping into calls, error mapping, answer → `Match[]` |
| `src/detectors/index.ts` | Registers it |
| `src/core/detection/budget.ts` | `applyFileBudget` |
| `src/core/pipeline.ts` | Applies the budget on verify and warns about what it skipped |
| `test/detectors/llm/schema.test.ts` | Config validation |
| `test/detectors/llm/prompt.test.ts` | Prompt text: marks, grounding, multiple rules |
| `test/detectors/llm/call.test.ts` | Cache hits and misses, key sensitivity |
| `test/detectors/llm/detector.test.ts` | Grouping, skipping, filtering, error mapping |
| `test/detectors/fixtures.ts` | The `llm` contract fixture |
| `test/core/detection/budget.test.ts` | `applyFileBudget` |
| `test/core/pipeline-llm.test.ts` | The budget and its warning through the pipeline |
| `test/detectors/path.test.ts:32` | The built-in kind list gains `llm` |

---

## Task 1: The `llm` config schema

**Files:** create `src/detectors/llm/schema.ts` · test `test/detectors/llm/schema.test.ts`

**Behaviour:** `{ model: "haiku", question: "…" }` parses with `grounding: true`; a config without `model` or without `question` is rejected.

- [ ] Write the failing test: both keys required and non-empty, `grounding` defaults to `true`, an unknown key is rejected, `model: ""` and `question: "   "` are rejected.
- [ ] Implement:

  ```ts
  import { z } from "zod"

  export const llmSchema = z
    .object({
      /** An alias from src/detectors/llm/models.ts, or the provider's own model name (plan 6a, Decision 2). */
      model: z.string().trim().min(1),
      question: z.string().trim().min(1),
      /** Send the rule's resolved context references with the question. */
      grounding: z.boolean().default(true),
    })
    .strict()

  export type LlmConfig = z.infer<typeof llmSchema>
  ```
- [ ] Verify: `pnpm vitest run test/detectors/llm/schema.test.ts` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/schema.ts packages/rulecast/test/detectors/llm/schema.test.ts && git commit`

## Task 2: The prompt

**Files:** create `src/detectors/llm/prompt.ts` · test `test/detectors/llm/prompt.test.ts`

**Behaviour:** a call's rules, source and change set become one deterministic block of text. No I/O, so the test asserts the exact string.

- [ ] Write the failing test, asserting the full text for three cases: one rule with marks; two rules, one grounded and one not; one rule with no change set.
- [ ] Implement:

  ```ts
  export interface PromptRule {
    id: string
    question: string
    /** Resolved references, already filtered by `grounding` (plan 6b, Decision 8). */
    grounding: { ref: string; content: string }[]
  }

  export interface PromptCall {
    file: string
    source: string
    /** null: no baseline — judge the whole file, with no marks (plan 6b, Decision 2). */
    changedLines: [number, number][] | null
    rules: PromptRule[]
  }

  export function buildPrompt(call: PromptCall): string
  ```

  The exact layout, which the test pins (the outer fence here is four backticks; the prompt's own
  file fence is three):

  ````
  Check the file below against each rule. Report every line that breaks a rule.

  Answer with JSON only: {"findings": [{"rule": "<rule id>", "line": <number>, "text": "<the line>", "reason": "<why>"}]}
  Report nothing when a rule is not broken. Use the rule ids exactly as given.
  Only lines marked with ">" were changed. Report findings on those lines only.

  ## Rules

  ### api/no-client-in-components
  Does this component import the generated API client?

  Reference — docs/api-access.md#frontend-data-flow:
  """
  Components never talk to the API directly.
  """

  ### api/thin-routes
  Does this route do more than parse input, call a service, and return the result?

  ## File: frontend/src/components/UserList.tsx

  ```
      1  import { getUsers } from "@/client"
  >   2
  >   3  export function UserList() {
  ```
  ````

  Rules for the layout:
  - the "Only lines marked" line is present only when `changedLines !== null`; when it is `null` the line reads `Judge the whole file.`
  - line numbers are right-aligned in a field as wide as the last line number, then two spaces, then the line verbatim
  - a changed line is prefixed `> `, an unchanged one `  `
  - a rule with no grounding has no `Reference —` block; each reference gets its own block, in the order `context` gave them
  - the file is wrapped in a three-backtick fence. A **source line that is itself a fence** would close it early, so `buildPrompt` widens its fence to one backtick more than the longest backtick run in the source — pin this in the test with a fixture whose source contains a markdown code block
- [ ] Verify: `pnpm vitest run test/detectors/llm/prompt.test.ts` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/prompt.ts packages/rulecast/test/detectors/llm/prompt.test.ts && git commit`

## Task 3: The cached call

**Files:** create `src/detectors/llm/call.ts` · test `test/detectors/llm/call.test.ts`

**Behaviour:** `askCached` returns the provider's findings, having asked at most once for a given call; a second identical call reads the cache and the provider is not entered.

- [ ] Write failing tests with a counting fake provider and a `memoryCache()`:
  - two identical calls → provider entered once, same findings both times
  - changing the file content, the changed lines, the model, the provider name, a rule id, a rule's `question`, or a grounding reference's content each → provider entered again
  - changing a rule's *order* in the call → **not** a new key (the rules are sorted by id before hashing, so `{a,b}` and `{b,a}` are one call)
  - a provider throw is not cached: the next call enters the provider again
- [ ] Implement:

  ```ts
  export interface CallKeyInput {
    file: string
    source: string
    changedLines: [number, number][] | null
    provider: LlmProviderName
    model: string
    rules: { id: string; config: LlmConfig; grounding: { ref: string; content: string }[] }[]
  }

  export function callKey(input: CallKeyInput): string   // sha256 hex over canonical JSON
  export async function askCached(
    provider: LlmProvider,
    cache: Cache,
    key: string,
    request: LlmRequest,
  ): Promise<LlmFinding[]>
  ```

  `callKey` sorts `rules` by `id` and serialises each as `{ id, config, grounding }`; `config` is the parsed `LlmConfig`, whose keys zod emits in a stable order. `askCached` reads `cache.get<LlmFinding[]>(key)`, returns a hit as-is, otherwise calls `provider.ask(request)` and writes the result before returning it. **Only successes are written** — an error must not be cached, or a transient failure sticks until the cache is cleared.
- [ ] Verify: `pnpm vitest run test/detectors/llm/call.test.ts` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/call.ts packages/rulecast/test/detectors/llm/call.test.ts && git commit`

## Task 4: The detector

**Files:** create `src/detectors/llm/detector.ts` · modify `src/detectors/index.ts` · modify `test/detectors/path.test.ts:32` · test `test/detectors/llm/detector.test.ts`

**Behaviour:** `llmDetector.run(…)` with a stub `claude` in the fixture produces findings attributed to the right rules, and each failure mode lands in the right half of `DetectorResult`.

- [ ] Write failing tests, all against a fixture project with `stubAgentCli` from `test/helpers/llm.ts`:
  - **declaration**: `kind === "llm"`, `captures(config)` is `["reason"]`, `events(config)` is `["verify"]`
  - **one call covers several rules**: two rules on the same file and model → the stub was spawned once (assert on `stubArgv`/`stubStdin` existing once, or have the stub append rather than overwrite) and the prompt names both rule ids
  - **two models are two calls**: two rules on the same file, `haiku` and `sonnet` → two spawns, each prompt naming only its own rule
  - **empty change set is skipped**: a file with `changedLines: []` → the provider is never entered and there are no findings
  - **absent from `changes` is sent unmarked**: the prompt contains `Judge the whole file.` and no `>` marks
  - **findings map to matches**: `match.file` is the rule's file, `match.line` the answered line, `match.endLine === match.line`, `match.column === 1`, `match.text` is that line of the file verbatim (**not** the model's `text` — give the stub a deliberately wrong `text` and assert the file's line wins), `match.captures` is exactly `{ reason }`
  - **filtering** (Decision 5): a stub answering with an unknown rule id, a line past the end of the file, and a line outside the changed range produces no findings **and no errors**
  - **missing binary** → `errors` is `[{ rule: null, message }]` and `findings` is empty
  - **unparseable answer** → one error per rule of that call, `rule` non-null, and a second rule using a working model still reports its findings
  - **unmapped alias**: provider `openai-compatible`, `model: "haiku"` → a per-rule error naming the alias and the provider
  - **abort**: an aborted signal rejects rather than returning errors
- [ ] Implement `run`:
  1. `const provider = providerByName(input.settings.llm.provider)` — wrap in try/catch; an `LlmUnavailableError` here is a whole-run error before any file is read.
  2. Read each distinct file across all rules once, through a memoising reader like `src/detectors/linter/detector.ts:15-25`. A file that no longer exists is dropped.
  3. Build the call groups: for each rule, for each of its files, skip when `input.changes.get(file)?.changedLines.length === 0`; otherwise add the rule to the group keyed `${file}\u0000${rule.config.model}`.
  4. For each group, resolve the model (`resolveModel`); `null` → a per-rule error for that group's rules, and move on.
  5. Build the prompt, the cache key, and `askCached`. `Promise.all` over groups, each group in its own try/catch, rethrowing when `input.signal.aborted`.
  6. `LlmUnavailableError` from any group → **one** `{ rule: null, message }` for the whole result, and drop everything else. Any other throw → one error per rule in that group.
  7. Filter and map the answers to matches per Decision 5, attributing each to the single rule it names.
- [ ] Register it in `src/detectors/index.ts` (append, after `linterDetector`) and add `"llm"` to the expected kind list in `test/detectors/path.test.ts:32`.
- [ ] Verify: `pnpm vitest run test/detectors/llm/detector.test.ts test/detectors/path.test.ts` → passes; `pnpm typecheck` → passes.
- [ ] `git add` the two `src/` files and the two tests, then `git commit`

## Task 5: The contract fixture

**Files:** modify `test/detectors/fixtures.ts` · verify `test/detectors/contract.test.ts` (no change)

**Behaviour:** the `llm` detector passes the exported detector contract suite, like the other five, with no network and no cost.

- [ ] Add the fixture. `contract.test.ts`'s first test — "every built-in detector has a contract fixture" — fails until it is there, which is the red step.

  ```ts
  llm: {
    files: { "app/a.py": PY },
    prepare: (root) => stubAgentCli(root, "claude", { broken: ["broken-model"] }),
    config: { model: "haiku", question: "Does this function swallow an exception?" },
    matching: ["app/a.py"],
    // A model the stub answers with unparseable output: a per-rule failure, not a whole-run one.
    failing: { config: { model: "broken-model", question: "Anything." }, matching: ["app/a.py"] },
  },
  ```

  Two things make this work, and both are worth understanding before changing it:
  - the contract runs with `changes: new Map()`, so `app/a.py` is *absent* rather than empty — it is sent as a whole-file judgement and the contract's "must produce at least one finding" case is satisfiable (Decision 2). An empty-change-set fixture would produce nothing and fail the suite.
  - the contract's failing case asserts a per-rule error and **no** `rule: null` error, which is why the failing config uses a bad *model* (unparseable answer → per-rule, Decision 3) rather than a missing binary (whole-run).
- [ ] No change to `test/helpers/llm.ts` is needed: `stubAgentCli` already rewrites the envelope's rule id to the first `### <id>` heading in the prompt it was given (plan 6a, Task 6), so it answers about `a`, `b`, `good` and `bad` without a recording per test.
- [ ] Verify: `pnpm vitest run test/detectors/contract.test.ts` → every case passes for all six detectors.
- [ ] `git add packages/rulecast/test/detectors/fixtures.ts && git commit`

## Task 6: The per-verify file budget

**Files:** create `src/core/detection/budget.ts` · test `test/core/detection/budget.test.ts`

**Behaviour:** given selections, a kind, a maximum and a recency order, the kind's selections keep at most `maxFiles` distinct files, the most recently edited ones, and the dropped files come back so the caller can name them.

- [ ] Write failing tests:
  - under the limit → the selections come back identical (same object identity is not required, same contents are) and `skipped` is empty
  - over the limit → exactly `maxFiles` distinct files survive, chosen in `recent` order
  - a file not in `recent` at all (a `rulecast run --all-files`, where nothing was "edited") sorts after every file that is, in the selections' own order — so the budget still cuts deterministically with no session
  - a selection left with no files is dropped from the result entirely, matching `selectDetectorRules`'s own invariant that a selection always has at least one file
  - selections of other kinds are untouched, whatever the limit
  - `maxFiles` larger than the number of files → nothing skipped
- [ ] Implement:

  ```ts
  /**
   * Spec §6: at most `maxFiles` files per verify for one detector kind, most recently edited
   * first. Lives here and not in the detector because only the pipeline knows edit recency and
   * only the pipeline can warn (plan 6b, Decision 7).
   *
   * `recent` is most-recently-edited first; files missing from it keep their order and come last.
   */
  export function applyFileBudget(
    selections: Selection[],
    kind: string,
    maxFiles: number,
    recent: readonly string[],
  ): { selections: Selection[]; skipped: string[] }
  ```
- [ ] Verify: `pnpm vitest run test/core/detection/budget.test.ts` → passes.
- [ ] `git add packages/rulecast/src/core/detection/budget.ts packages/rulecast/test/core/detection/budget.test.ts && git commit`

## Task 7: The budget in the pipeline

**Files:** modify `src/core/pipeline.ts:156-160` · test `test/core/pipeline-llm.test.ts`

**Behaviour:** a verify with more llm-selected files than `llm.max_files_per_verify` checks only the most recently edited ones and delivers a warning naming the rest.

- [ ] Write the failing test in a new `test/core/pipeline-llm.test.ts`: a project with one llm rule, `llm: { max_files_per_verify: 2 }`, a stub `claude`, a session in which four matching files were edited in a known order, then a verify. Assert that the two most recently edited files were the ones asked about (read the stub's recorded stdin), and that `delivery.warnings` contains one entry naming the other two.
- [ ] In `runPipeline`, after `selections` is built and before `runDetection`:

  ```ts
  let selections = selectDetectorRules(…)
  const skippedByBudget: string[] = []
  if (event.kind === "verify") {
    const recent = [...view.work.edited].reverse()   // work.edited is least-recently-edited first
    const budgeted = applyFileBudget(selections, "llm", config.llm.maxFilesPerVerify, recent)
    selections = budgeted.selections
    skippedByBudget.push(...budgeted.skipped)
  }
  ```

  and after `runDetection` returns, when `skippedByBudget.length > 0`, push a warning:

  ```ts
  warnings.push({
    key: `llm-budget:${skippedByBudget.join(",")}`,
    text: `llm rules checked ${config.llm.maxFilesPerVerify} files; ${skippedByBudget.length} were not checked: ${skippedByBudget.join(", ")}. Raise llm.max_files_per_verify or run rulecast run --files on them.`,
  })
  ```

  The budget is **not** `failed`: skipping files to stay inside a budget the project set is normal operation, not a rulecast failure, so the exit code is unaffected.
- [ ] `selections` becomes a `let`; keep the existing `.filter(…)` for `skipDetectorKinds` and `onlyRules` where it is, so `--no-llm` removes the rules before the budget ever sees them.
- [ ] Verify: `pnpm vitest run test/core/pipeline-llm.test.ts` → passes; `pnpm test` → everything passes.
- [ ] `git add packages/rulecast/src/core/pipeline.ts packages/rulecast/test/core/pipeline-llm.test.ts && git commit`

---

## End-to-end verification

From the repository root:

- [ ] `pnpm test` → all tests pass, still 5 skipped. `pnpm typecheck`, `pnpm lint` → clean.
- [ ] `pnpm test:perf` → p95 still under the 500 ms gate and in the same range as plan 5's 229–358 ms. `llm` is `verify`-only, so it must not appear in an edit event at all; if the number moved, something is running or importing it eagerly.
- [ ] A real end-to-end run against a scratch project, using the machine's own Claude Code and costing about a cent:

  ```sh
  cd "$(mktemp -d)" && git init -q && mkdir -p app
  cat > .rulecast-config.yaml <<'EOF'
  llm: { provider: claude-code, max_files_per_verify: 10 }
  repos:
    - repo: local
      rules:
        - id: no-print
          name: Services do not print
          files: ^app/
          detect:
            llm:
              model: haiku
              question: Does this file write to stdout instead of using the logger? Report each offending line.
          message: "{{file}}:{{line}} prints to stdout. {{reason}}"
  EOF
  printf 'def get(id):\n    print("fetching", id)\n    return id\n' > app/a.py
  git add -A && git commit -qm init
  RULECAST_HOME="$PWD/.cache" node <path-to>/packages/rulecast/dist/cli.js run --all-files --format terminal
  ```

  Expected: one error finding on `app/a.py:2` whose message ends with a `reason` in the model's words, and exit code 1.
- [ ] Run it a second time unchanged: the cache means no `claude` process is spawned (watch with `ps`, or time it — the second run should be an order of magnitude faster) and the same finding is reported.
- [ ] `ls ~/.cache/rulecast` → absent.
- [ ] `git log --oneline` → seven commits on top of 6a, one per task.
