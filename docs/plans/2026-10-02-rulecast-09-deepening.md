# rulecast Plan 9 — Deepening Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two files the repository's history keeps returning to — `core/pipeline.ts` and `core/session/decide.ts` — stop being where everything meets. Detection, the baseline decision and the delivery decision each get a module that owns them, the plugin API stops leaking types it exports, the detector seam carries the properties the core currently branches on by name, and one live defect that silently disables rules is fixed.

**Approach:** Nine candidates from the architecture review of 2026-09-30, each verified first-hand before being planned. Eight are behaviour-preserving refactors with a measured constraint attached; one (Task 1) is a defect fix. Nothing here changes what rulecast delivers to an agent, so the 930-test suite plus two new golden corpora are the whole verification. Tasks 1–3 are independent and land first because they are cheap and certain. Tasks 4–11 are ordered by dependency, not by value.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: plan 8 is done. Task 3 was dropped during execution — see it for why. Task 11 is blocked on PR #7 (zod 3→4) and is the one task that may not land in this plan.

---

## The measurements this implements

Every candidate below was re-verified against the source on 2026-10-02 before being written down. Five of the review's supporting claims did not survive, and the corrected numbers are the ones used here. The three claims with a behavioural consequence were reproduced rather than argued:

| What was measured | Result |
|---|---|
| A deadline that passes while the event loop is blocked, in each detector | `path` and `regex` rethrow → recorded as a timeout. `ast-grep` returns a **rule error** → `pipeline.ts:417` appends `{t:"disabled"}` and sets `failed = true`, so the rule is off for the rest of the session. |
| `costOf` priced from inside the per-item loop, at 60k findings / 20k summaries | **13,610 ms** — the quadratic `decide-scale.test.ts` exists to catch. |
| `costOf` priced as a bounded unit, 20,000 calls | **8.5 ms**. Priced once per section: 9.5 ms. Whole delivery rendered once: 25 ms. |
| A type-only fixture importing `CompiledRule`'s field types from `src/index` | Fails today with `TS2305` for `ReferenceSpec`, `RuleExamples` and `Stage`. Two changed lines make it pass. |
| `rootsOf`, `sourceReader` across detectors | **Byte-identical** in both pairs, proven with `diff`. |
| Detector kinds named in the core | `"llm"` at 8 sites. `"path"` at `core/detection/proposal.ts:52` — so 9, not 8. |
| `warmableKinds()` with the shipped registry | `[]`. Both branches in `hook.ts` unreachable; `rulecast warm` prints "nothing to warm". |

Baseline to hold: 930 tests (922 passing, 8 skipped); edit hook p50 192 ms, p95 236 ms against a 500 ms budget.

**On reading `pnpm perf`:** it is sensitive to machine load and the absolute numbers are not comparable across runs. The same build measured p95 236 ms on an idle machine and p95 600 ms with a `max` of 1,058,163 ms — 17 minutes for one hook — at load average 28. A number worse than the baseline is not evidence of a regression on its own. Measure the parent commit back to back on the same machine, or do not claim anything.

## Decisions this plan implements

1. **The deadline fix ships alone and first.** It is the only live defect among the nine, it is one condition at four sites, and the shared-plumbing work it was bundled with (Task 6) is a much larger change with none of the urgency. `perRule` already has the correct predicate at `per-rule.ts:22` with a comment explaining it; the three hand-rolled batching detectors are missing it. Extract the predicate rather than copying it a fourth time.

2. **`timeoutMs` is not part of the detection context.** The pipeline varies it per event — `editDeadlineMs` on edit, `verifyMs` on verify (`pipeline.ts:406`). `commands/test.ts` can fix it in its local bundle only because it always verifies. So `detectionFor` carries `{ root, registry, settings, cacheFor, contextFor }` and every caller passes `{ event, selections, changes, read, timeoutMs }`.

3. **`doctor` overrides by spread, and that is an improvement.** `doctor.ts:199,201` deliberately substitutes `memoryCache()` and an empty `contextFor`, and says why. Spreading over `detectionFor(...)` makes that deviation visible as a deviation instead of hiding it among six hand-assembled wirings. Do not add options to `detectionFor` to express it.

4. **Stage one of `decide` does not return a `Delivery`.** Three things stop it: `trim` demotes a reference and needs `spec.path`, `spec.anchor` and `resolved.hash`, none of which is on `DeliveredReference`; `trim` filters findings by object identity at `decide.ts:396`; and `trim` produces context records. So assemble returns an `Assembled` carrying the delivery *and* its resolution metadata, and `trim` returns `{ delivery, context, omitted }`. Anything that tries to make the seam `Delivery → Delivery` will fail on the first reference it has to demote.

5. **`costOf` prices bounded units only.** Measured above: pricing a growing section from inside its own item loop costs 13.6 s where pricing a bounded unit costs 8.5 ms. This is the trick `measureRuleBlock` already uses — it renders one rule's block capped at `maxMatchesPerRule`, which is why the fill loop at `decide.ts:363–382` stays linear despite two renders per iteration. A `costOf` that takes a whole section and is called once is also fine; one called per item is not.

6. **`renderAgentText` cannot be the pricing primitive.** It returns `""` when there is no header and no warnings (`render-agent.ts:157`), so a section cannot be priced through it in isolation. The section builders have to come out first. This makes Task 10 larger than "delete five constants", and it is why Task 9 (goldens) comes before it.

7. **`baselineFor` returns records; the pipeline appends them.** All three `appendBaseline` calls are lock-free — `withLock` appears only in `commitSession` (`session.ts:48`). Safety rests on `appendRecords` writing every record in one `O_APPEND` call (`jsonl.ts:9`) and on `readBaseline` resolving conflicts first-wins, which makes concurrent appends commutative. The touch path's single append at `pipeline.ts:303` carries snapshots **and** their fingerprints together; split into two appends, a reader can see a fingerprint whose snapshot has not landed, and `pipeline.ts:333–337` says a fingerprint measured against the wrong baseline is worse than no fingerprint at all.

8. **The duplicated fingerprint merge needs a decision, not a move.** `pipeline.ts:358–363` overwrites unconditionally; `store.ts:70–74` keeps the first. It is harmless today only because `pipeline.ts:340` filters to files with no fingerprints and `recordFingerprints` emits one record per `(file, rule)` (`record.ts:95–98`). The shared merge takes the store's semantics — first wins — because that is the one the on-disk format already guarantees.

9. **The `llm` properties are not all booleans.** `init.ts:202–207` needs a sentence ("llm · haiku · sends file contents to your provider"), which is why the cast into a foreign config type exists. A `metered: boolean` would leave the cast in place. The property that removes it is a detector-supplied description.

10. **`warm` is left alone.** Originally planned as "narrow the seam on the adapter side", on the strength of both `hook.ts` warm branches being unreachable. They are unreachable only for the shipped registry: `test/commands/hook.test.ts:113` injects a detector that implements `warm` and asserts session-start warm-up, and it passes. So `warmup` is a working, tested trigger for any third-party detector with warm-up work, and removing it would remove behaviour rather than dead plumbing. Task 3 records the reversal.

11. **Candidate 08 is split, and only its first half is in scope.** `z.toJSONSchema` is a zod 4 API and the repo is on `3.25.76`, so the schema half waits for PR #7. The golden corpus has no such dependency and Task 10 needs it anyway.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- No module-level mutable state in `src/`.
- `pnpm perf` before Task 4 and after Tasks 5, 6 and 10: those touch the hook path. Hold p95 inside 500 ms and no worse than the 236 ms recorded above.
- `pnpm test:linux` before pushing Tasks 5 and 6 — they touch the baseline store on disk and the detector subprocess paths.
- lefthook runs biome (`--error-on-warnings`, with `--write`) and `pnpm typecheck` on commit, `pnpm test` on push. Never bypass them.
- Stage by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, stash, reset or checkout.
- Commit after every task, straight to `main`. Commit messages end with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`.
- **These are behaviour-preserving refactors except Task 1.** A test that changes is a finding, not a chore: stop and work out which side is wrong.
- **When a planned test fails, find the cause before changing the test.**

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/detection/per-rule.ts` | `pastDeadline(error, input)`: the one deadline predicate |
| `src/detectors/ast-grep/detector.ts` | Uses it at `:81`, `:99` |
| `src/detectors/linter/detector.ts` | Uses it at `:102`; `sourceReader` moves out |
| `src/detectors/llm/detector.ts` | Uses it at `:180`; `sourceReader` moves out |
| `src/index.ts` | `Stage`, `ReferenceSpec`, `RuleExample`, `RuleExamples`, `renderAgentText`, `RenderOptions`, the positions helpers |
| `test/plugin-api.ts` | **new.** The type-level guard: names every field of `CompiledRule` through the public entry point only |
| `src/core/types.ts` | `Detector` gains the metered/fingerprintable/whole-file properties |
| `src/core/detection/context.ts` | **new.** `DetectionContext`, `detectionFor(project, stateDir, resolver)` |
| `src/core/detection/run.ts` | `DetectionInput` takes the context plus what varies |
| `src/core/baseline/record.ts` | `FingerprintInput` takes the context; `fingerprintable` replaces the `"llm"` literal |
| `src/core/examples.ts` | `ExamplesInput` 7 fields → 3 |
| `src/commands/test.ts` | The local `Detection` interface deleted; uses `detectionFor` |
| `src/commands/doctor.ts` | Spreads over `detectionFor`; `metered` replaces the `"llm"` literal |
| `src/commands/init.ts` | The detector's own cost description replaces the cast |
| `src/core/baseline/stage.ts` | **new.** `baselineFor(event, session, context)` returning records plus `{ changes, fingerprints }` |
| `src/core/baseline/store.ts` | `mergeFingerprints`, shared with the pipeline |
| `src/core/delivery/render-agent.ts` | Section builders exported; `costOf` |
| `src/core/session/decide.ts` | `assemble` / `trim` / `gate`; the five constants deleted |
| `src/core/guard.ts` | Calls `assemble` and `trim`, not `decide` |
| `src/core/pipeline.ts` | Three wiring blocks and the baseline blocks leave |
| `src/core/detection/positions.ts` | Unchanged; re-exported |
| `src/core/detection/per-file.ts` | **new.** The batching counterpart to `perRule`, plus `repoRelative`, `sourceReader`, `runTool` |
| `src/detectors/command/results.ts` | `repoRelative`/`rootsOf` move out |
| `src/detectors/linter/tools.ts` | `relativeTo`/`rootsOf` move out |
| `test/goldens/delivery/` | **new.** `*.delivery.json` → `*.expected.txt` |
| `test/goldens/classification/` | **new.** `(baseline, current, rule)` → `new \| preexisting` |
| `test/core/delivery/goldens.test.ts` | **new.** Walks both corpora |
| `docs/specs/2026-09-15-rulecast-design.md` | §6, §13, §16, §17 |
| `docs/plans/2026-09-15-rulecast-00-index.md` | Plan 9's row |

---

## Task 1: a deadline that passes is a timeout, not a rule error

**Files:** modify `src/core/detection/per-rule.ts:7-29` · modify `src/detectors/ast-grep/detector.ts:80-103` · modify `src/detectors/linter/detector.ts:101-106` · modify `src/detectors/llm/detector.ts:177-183` · test `test/detectors/deadline.test.ts`

**Behaviour:** An error raised after `input.deadlineAt` has passed is rethrown, so the core records a timeout — logged on edit, retried at the next verify — rather than a rule error, which disables the rule for the whole session (§14). Today the three detectors that hand-roll their own `run` check only `input.signal.aborted`, which is still false when the work blocked the event loop, so `ast-grep` turns a deadline overrun into a silently disabled rule and a changed exit code.

```ts
/**
 * Whether this error is the clock rather than the rule. The signal alone cannot tell them apart:
 * synchronous work keeps its own abort timer from ever firing, so the wall clock is the authority.
 */
export function pastDeadline(error: unknown, input: Pick<DetectorRun<unknown>, "signal" | "deadlineAt">): boolean
```

- [x] Extract the condition at `per-rule.ts:22` into the exported `pastDeadline`, keeping its comment — it is the explanation for all four call sites. `perRule` calls it.
- [x] Replace `if (input.signal.aborted) throw error` with `if (pastDeadline(error, input)) throw error` at `ast-grep/detector.ts:81` and `:99`, `linter/detector.ts:102`, and `llm/detector.ts:180`.
- [x] Unit-test `pastDeadline`: a `DeadlineError` whatever the clock says; an aborted signal; a passed wall clock with the signal still open (the case the signal cannot see, and the reason the predicate exists); an ordinary error inside the deadline.
- [x] End-to-end on `ast-grep`, the one reachable case: a run with `deadlineAt` already past, the signal not aborted and a `read` that throws must reject rather than return a `DetectorResult` carrying the error. Red before the fix, green after.
- [x] Companion case: with `deadlineAt` in the future, the same failure is still a rule error. The fix must not turn ordinary failures into timeouts.
- [x] Verify: `pnpm vitest run test/detectors/deadline.test.ts` → 6 passed; `pnpm test` → 936 tests, 928 passing; `pnpm typecheck` → clean.
- [x] Commit.

**Corrected while executing.** This task was planned as "a table over all six detectors", which is wrong: the six do not share a failure path, so the table would have asserted a uniformity that does not exist. `regex` does not wrap `input.read` in a try/catch at all (`regex.ts:115`), so a read failure leaves it as a whole-run error by design; `llm` skips a file it cannot read rather than erroring; `linter` and `llm` only reach their catch through a subprocess or an HTTP call, which is not hermetic to force (§15). So the test is the predicate as a unit plus `ast-grep` end to end — the one case that is both reachable and hermetic. `linter` and `llm` share the corrected predicate and are covered by their own contract suites; their exposure was always latent, because they await and the signal is therefore accurate.

## Task 2: close the plugin API, with a guard that cannot regress

**Files:** modify `src/index.ts:12-19` · modify `src/internal.ts:19` · create `test/plugin-api.ts`

**Behaviour:** Every type named by a field of `CompiledRule` is nameable from `@syv-ai/rulecast`, and so is the renderer every adapter needs for `Adapter.format`. A type-level fixture fails `pnpm typecheck` if that stops being true. §16's promise — internal shapes change without a major — becomes checkable instead of conventional.

- [x] Promote from `core/config/schema`: `RuleExample`, `RuleExamples`, `Stage`, alongside the `RuleScope` already there. `RuleExample` has to come too — `RuleExamples` is defined in terms of it.
- [x] Promote `ReferenceSpec` from `core/references`.
- [x] Promote `renderAgentText` and `RenderOptions` from `core/delivery/render-agent`, and `lineStarts`, `positionAt`, `offsetAt` from `core/detection/positions`. Leave the `renderAgentText` export in `internal.ts` as well: `scripts/` imports it from there and `/internal` carries no promise either way.
- [x] Create `test/plugin-api.ts`: a type-only module importing *only* from `../src/index`, declaring a `CompiledRule`, and assigning each of its fields to an explicitly named type. No `describe`, no `test` — `tsconfig.json` includes `test`, so `tsc --noEmit` is the assertion and lefthook already runs it pre-commit. Head it with a comment saying what breaks it and why that matters.
- [x] Verify: `pnpm typecheck` → clean. Then confirm the guard bites: removed `ReferenceSpec` from `src/index.ts`, saw `test/plugin-api.ts(30,3): error TS2305`, put it back.
- [x] Verify the built surface too: `pnpm build`, then check `dist/index.d.ts` names `Stage`, `ReferenceSpec` and `RuleExamples`. They were absent from *both* entry points before this task; all nine promoted names are now present.
- [x] Commit.

**A pre-existing test said the opposite, and it was right to.** `test/smoke.test.ts:34-52` asserts that `renderAgentText` is on `./internal` and *not* on the package entry, with a comment saying a move between the two is a deliberate decision and that the test exists to catch a drift. It caught this one. The decision stands, and the reason is stronger than the review's: the context budget is computed **against** this renderer — `decide` measures with `measureRuleBlock` and trims to `adapter.maxContextChars` — so an adapter that renders a `Delivery` its own way receives text trimmed to a budget computed for a different renderer. `renderAgentText` is not a convenience, it is what the budget means, and both in-repo adapters already call it. So `Adapter.format` is expected to wrap it rather than replace it, and the smoke test now asserts that positively instead of forbidding it. The other eleven names in that list are rulecast driving itself and stay internal.

## Task 3: narrow the warm seam to the detector side — **dropped**

**Dropped on 2026-10-02, after the work was done and reverted.** The decision rested on a premise that was wrong, and the implementation is what proved it.

The verification reported that both warm branches in `hook.ts` were unreachable. That is true only of the **shipped** registry: no builtin detector implements `warm`, so `warmableKinds()` returns `[]`. But `test/commands/hook.test.ts:113` injects a `slow` detector that does implement `warm` and asserts that a `session-start.startup` payload warms it — and it passes. The branch is reachable for any third-party detector with warm-up work, and it is tested.

So removing `warmup` from `AdapterInput` does not delete dead plumbing. It deletes a working trigger: a third-party detector implementing `warm` is warmed at session start today and would not be afterwards, leaving only `rulecast warm` run by hand and the deadline re-arm at `hook.ts:52-53`. One test would have been deleted rather than updated, which is the signal that the change was removing behaviour.

**Kept as it stands:** `AdapterInput.warmup`, `hook.ts:38-41`, `hook.ts:52-53`, `Detector.warm`, `warmDetectors`, `warmableKinds`, `rulecast warm`. The cost is one boolean a future adapter sets; the benefit is that a detector with `warm` works without the adapter author doing anything. §13 specifies the machinery and §17 still names its intended first consumer.

The open question is unchanged and is a product question, not a code one: whether §17's persisted project model is still wanted. Nothing in this plan depends on the answer.

## Task 4: one detection context

**Files:** create `src/core/detection/context.ts` · modify `src/core/detection/run.ts:15-27` · modify `src/core/baseline/record.ts:9-32` · modify `src/core/examples.ts:45-52` · modify `src/commands/test.ts:92-98,185-191` · modify `src/commands/doctor.ts:192-204` · modify `src/core/pipeline.ts:286-300,344-357,396-407` · modify `src/core/guard.ts:67-79` · test `test/core/detection/context.test.ts`

**Behaviour:** One module answers "detection, for this project": the registry, the settings, how a detector reads its cache and how a rule's context is resolved. Every caller passes only what varies per run. `DetectionInput` goes from 10 fields to 5 plus the context; `FingerprintInput` from 13 to 8; `ExamplesInput` from 7 to 3. Nothing behavioural changes.

```ts
export interface DetectionContext {
  root: string
  registry: DetectorRegistry
  settings: DetectorSettings
  cacheFor(kind: string): Cache
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
}

/** The context a project's detector runs share. `timeoutMs` is not here: it varies per event. */
export function detectionFor(
  project: CompiledProject,
  /** Not on CompiledProject: the registry is an input to `compile`, not part of its result. */
  registry: DetectorRegistry,
  stateDir: string,
  resolver: ReferenceResolver,
): DetectionContext
```

- [x] Create `context.ts`. `cacheFor` is `diskCache(detectorCacheDir(stateDir, kind))`; `contextFor` is `resolveRuleContext(resolver, rule.context)`; `settings` is `{ llm: project.config.llm }`; `root` is `project.root`. This is the closure written out six times and the `settings` literal written out seven.
- [x] `DetectionInput` becomes `{ detection: DetectionContext; event; selections; changes; read; timeoutMs }`. Update `runDetection` to read the five context fields through it.
- [x] `FingerprintInput` likewise: `{ detection; files; rules; disabled; read; event; timeoutMs; source; ceiling? }`. `recordFingerprints` reaches `registry` through `input.detection`.
- [x] `ExamplesInput` becomes `{ detection; rule; timeoutMs }` — `root` comes from the context. Check the scratch-directory comment at `examples.ts:46` still reads correctly.
- [x] **Delete the local `Detection` interface at `commands/test.ts:92-98`** and the object at `:185-191`; use `detectionFor`. This is the module the review found invented by accident, and it collides by name with `init/detect.ts:25`. Both call sites already spread it, so they need `{ ...detection }` replaced by `detection` and `timeoutMs` passed alongside.
- [x] `doctor.ts` spreads its two deliberate overrides over the context: `{ ...detectionFor(project, stateDir, resolver), cacheFor: () => memoryCache(), contextFor: async () => [] }`. Keep both comments — they are the reason the override exists. Note `doctor` has no `resolver` today; build one with `createReferenceResolver(project.root)` or thread the one it has.
- [x] `pipeline.ts`: build the context once after `createReferenceResolver` at `:220` and pass it at all three sites (`:286-300`, `:344-357`, `:396-407`). `guard.ts` takes a `DetectionContext` on `GuardInput` instead of `config`, `registry`, `stateDir` and `resolver` — check what else in `guardWrite` still needs `config` (it does, for `maxFileBytes`, `refuseGate`, `context.maxBytes`, `stopGate`, `maxMatchesPerRule`) and keep that.
- [x] Test that the context is assembled once and shared: a `detectionFor` unit test asserting `cacheFor("regex")` points inside `detectorCacheDir(stateDir, "regex")` and that `contextFor` resolves a rule's references through the given resolver. The real coverage is the existing suite — nothing behavioural changed.
- [x] Verify: `pnpm test` → 940 tests, 932 passing; `pnpm typecheck` → clean.
- [x] Verify perf as an A/B, because the machine was at load average 14–28 and the 236 ms baseline was measured idle. Same machine, back to back: parent commit p50 363 ms / **p95 491 ms**; with this task p50 273 ms / **p95 357 ms**. Faster, which is the expected direction — the context is built once per pipeline instead of allocating fresh closures at each of six call sites.
- [x] Commit.

**Two things the compiler found that the plan had wrong.** `detectionFor` cannot take `(project, stateDir, resolver)`: the registry is an input to `compile`, not part of `CompiledProject`, so it is a fourth parameter. And `guard.ts` still needs `resolver` of its own — the context exposes only `contextFor`, while the delivery decision resolves references itself, which is a different consumer of the same resolver. `GuardInput` therefore carries both `detection` and `resolver`, and says why.

## Task 5: the baseline stage

**Files:** create `src/core/baseline/stage.ts` · modify `src/core/baseline/store.ts:61-77` · modify `src/core/pipeline.ts:197-213,268-305,307-366` · test `test/core/baseline/stage.test.ts`

**Behaviour:** One module answers "what is the baseline for this event", returning the records to append and the pair `classify` already takes. The pipeline appends; the stage does not. Three mutable locals leave `pipeline.ts`, and the fingerprint merge exists once.

```ts
export interface BaselineResult {
  /** To append, in this order, in ONE appendBaseline call. */
  records: BaselineRecord[]
  changes: BaselineChanges
  fingerprints: ReadonlyMap<string, ReadonlyMap<string, [number, number][]>>
}

export async function baselineFor(
  event: Event,
  state: BaselineState,
  files: readonly string[],
  detection: DetectionContext,
  limits: { editDeadlineMs: number; verifyMs: number; maxFileBytes: number },
): Promise<BaselineResult>
```

- [ ] Add `mergeFingerprints(into, records)` to `store.ts` and have `readBaseline` use it. It takes the store's semantics — **first wins** (Decision 8) — which is a behaviour change for `pipeline.ts:358-363` only in a case that cannot currently arise, because `:340` filters to files with no fingerprints and `recordFingerprints` emits one record per `(file, rule)`. Assert that in a test rather than leaving it to a reader.
- [ ] Move the touch block (`pipeline.ts:268-305`) into `baselineFor`: snapshot the files that have none, then `recordFingerprints` over the ones snapshotted, returning snapshot records **before** fingerprint records in one array. The order is load-bearing (Decision 7) — say so in a comment on the return type.
- [ ] Move the verify gap-filling (`:338-366`) in too, returning its records rather than appending them.
- [ ] Move `computeChanges` and the empty-change-set filter (`:326-331`) in; `baselineFor` returns `changes`.
- [ ] `pipeline.ts` keeps exactly one `appendBaseline(session.dir, result.records)` per event, and `classify` is called with `result.changes` and `result.fingerprints`.
- [ ] Tests: the touch path returns snapshots before fingerprints in one array; a file already snapshotted produces no second snapshot record; a verify with `baseCommit` set returns no snapshots; `mergeFingerprints` keeps the first record for a `(file, rule)` pair and a second is ignored; an empty `ranges` record is still distinguishable from an absent one.
- [ ] Verify: `pnpm vitest run test/core/baseline` → passes; `pnpm test` → passes; `pnpm test:linux` → passes; `pnpm perf` → p95 no worse than 236 ms.
- [ ] Commit.

## Task 6: the detectors' shared frame

**Files:** create `src/core/detection/per-file.ts` · modify `src/detectors/command/results.ts:29-47` · modify `src/detectors/linter/tools.ts:44-61` · modify `src/detectors/linter/detector.ts:14-25,45-56` · modify `src/detectors/llm/detector.ts:28-39` · modify `src/detectors/llm/providers/cli.ts:20-28` · modify `src/index.ts` · test `test/core/detection/per-file.test.ts`

**Behaviour:** The three helpers four detectors hand-roll exist once, on the plugin API, so a sixth detector starts with plumbing rather than a blank file. `repoRelative` and `sourceReader` were byte-identical copies; the subprocess-tolerating-a-nonzero-exit shape was written three times. No detector's output changes.

- [ ] Create `per-file.ts` with: `repoRelative(file, cwd)` — the `command` version, which is the superset (it handles the `file://` scheme that SARIF emits; a linter never emits one, so the branch is inert there); `sourceReader(cwd)`, lifted verbatim; and `runTool(command, args, options)` carrying the `maxBuffer: 64 * 1024 * 1024` and the nonzero-exit tolerance, with the comment explaining why a nonzero exit is normal.
- [ ] Delete `repoRelative`/`rootsOf` from `command/results.ts` and `relativeTo`/`rootsOf` from `linter/tools.ts`. `linter` calls `repoRelative(file, root)` where it called `relativeTo(roots, file)`; the roots array it precomputed is now internal to the helper. Keep the comment at `results.ts:27` — reword it, since it no longer points at a second copy.
- [ ] Delete both `sourceReader` definitions and import the shared one.
- [ ] Route `linter/detector.ts:45-56`, `command/detector.ts:63`, and `llm/providers/cli.ts` through `runTool`. Check each one's exit-code handling against what `runTool` does before deleting it: these are three similar shapes, not three identical ones.
- [ ] Export `repoRelative`, `sourceReader` and `runTool` from `src/index.ts`, next to `perRule`, and add them to `test/plugin-api.ts`.
- [ ] Tests: `repoRelative` over an absolute path under a symlinked root, a `file://` URI, a relative path, and a path outside the root; `sourceReader` reads a file once for two calls and returns null for a missing one; `runTool` returns output for exit 0 and for a tolerated nonzero exit, and throws for a missing binary.
- [ ] Verify: `pnpm vitest run test/detectors test/core/detection` → passes; `pnpm test` → passes; `pnpm test:linux` → passes; `pnpm perf` → p95 no worse than 236 ms.
- [ ] Commit.

## Task 7: what makes a detector special goes on the interface

**Files:** modify `src/core/types.ts:149-166` · modify `src/core/pipeline.ts:376,441` · modify `src/core/baseline/record.ts:57` · modify `src/core/detection/proposal.ts:51-58` · modify `src/commands/doctor.ts:181` · modify `src/commands/init.ts:173,202-207` · modify `src/commands/test.ts:202` · modify `src/commands/run.ts:146` · modify `src/detectors/llm/detector.ts` · modify `src/detectors/path.ts` · test `test/core/detection/registry.test.ts`

**Behaviour:** The core asks the registry instead of comparing a string. `"llm"` disappears from eight core sites and `"path"` from `proposal.ts:52`, so a second metered detector costs zero core edits. §6's consent rule becomes a declaration rather than a grep. The cast through another module's config type goes away.

```ts
export interface Detector<Config> {
  // …kind, schema, captures, events, guards, run, warm, check as today
  /** Costs money or latency per file: never preselected (§6), never fingerprinted, budgeted per event. */
  metered?: boolean
  /** What one rule of this kind costs, for init's consent line. null = nothing worth saying. */
  cost?(config: Config): string | null
  /** Most files this detector may be given in one event; null = unlimited. */
  maxFilesPerEvent?(settings: DetectorSettings): number | null
  /** A match is the whole file rather than a range in it, so any write to it is evidence. */
  wholeFile?: boolean
}
```

- [x] Add the four properties. `metered`, `cost` and `maxFilesPerEvent` go on the `llm` detector; `wholeFile: true` goes on `path`. Every other detector declares none, exactly as with `guards`.
- [x] `pipeline.ts:376`: the file budget asks the registry which kinds are metered and what each allows, instead of naming `"llm"` and reading `config.llm.maxFilesPerVerify`. `applyFileBudget` already takes a kind — it can now be driven from a list.
- [x] `pipeline.ts:441`: the timeout hint's extra sentence comes from the detector, not from `kind === "llm"`. A detector with no hint gets the plain message.
- [x] `record.ts:57`: `!metered` replaces `kind !== "llm"`. The comment at `record.ts:42-44` is the reason and should now read as being about metered detectors generally.
- [x] `proposal.ts:52`: `isInserted` takes the detector (or a `wholeFile` boolean) rather than a kind string. This is the ninth kind-literal in the core and the review missed it.
- [x] `doctor.ts:181`, `test.ts:202`: `metered` replaces the literal. `run.ts:146`: `--no-llm` still names `llm` — it is a user-facing flag, and that is the right place for the name. Leave it, and say so in a comment.
- [x] `init.ts:173`: `metered` replaces the literal. `init.ts:202-207`: `hintFor` calls `detector.cost?.(rule.detector.config)` and the cast `(rule.detector.config as { model?: string }).model` is **deleted**. The `llm` detector's own `cost` builds "llm · haiku · sends file contents to your provider".
- [x] Tests: a fake metered detector in the registry is never preselected by `init`, never fingerprinted, and is budgeted — all without the string `"llm"` in the test. That is the assertion that proves the seam closed.
- [x] Verify: `grep -rn '"llm"' src/ | grep -v '^src/detectors/llm/'` returns only `run.ts:146`; `pnpm test` → passes; `pnpm typecheck` → clean.
- [x] Commit.

**Corrected while executing.** Three departures from the interface sketched above, each forced by a message the core prints:

- `maxFilesPerEvent(settings): number` became **`fileBudget(settings): { max, setting }`**. The over-budget warning ends "Raise llm.max_files_per_verify", and a number alone cannot name the setting that raises it. With the setting declared beside the number, the `llm` warning is byte-identical to before and `pipeline-llm.test.ts` passes unchanged.
- A fifth property, **`timeoutHint?: string`**, carries the timeout warning's "(an llm rule on a large file can need 120000 or more)". The plan said the sentence should come from the detector without naming where.
- **`doctor`'s skip line changed wording**, from "llm rules are not dry-run (a model call costs money)" to "llm rules are not dry-run (each run costs money)". Once the core asks `metered` instead of comparing the kind, it can no longer know the run is a *model* call. `doctor.test.ts` was updated with a comment saying why; this is the one user-visible change in the task.

`pipeline-deadline.test.ts` had a test that faked a detector *named* `"llm"` to get the timeout hint — the exact name-keyed behaviour this task removes. It now fakes one called `hinted` that declares a hint, plus a one-line assertion that the real `llm` detector declares the field-trial wording.

`test/core/detection/metered.test.ts` is the proof the seam closed: a detector called `paid` is budgeted, warned about under its own setting, and never fingerprinted, with no kind name in the code. Its fingerprint test was mutated (the `metered` check in `record.ts` replaced by `true`) and failed as it should; a third test shows the same rule *is* fingerprinted without the declaration, so the second is not vacuous.

`grep -rn '"llm"' src/ | grep -v '^src/detectors/llm/'` → only `commands/run.ts:146`, the user-facing `--no-llm` flag, now commented as the one deliberate exception. 974 tests, 966 passing.


## Task 8: the golden corpus

**Files:** create `test/goldens/delivery/` · create `test/goldens/classification/` · create `test/core/delivery/goldens.test.ts`

**Behaviour:** The renderer's output and §8's classification have recorded expectations as data, not as hand-written TypeScript tables. A reimplementation has something to conform to, and Task 10 gets the safety net it needs before the cost model moves.

- [x] `test/goldens/delivery/`: one `*.delivery.json` per case with its `*.expected.txt`. Cover at least — an empty delivery; one new error finding; findings of two rules with templates; a delivery at the budget's edge with `omitted.rules > 0` and an `overflowPath`; a backlog block with summaries and `omitted.preexisting`; every `DeliveredReference` state (`full`, `pointer`, `read` with each `reason`, `missing`); warnings with and without the "…and N more" line; a `stop: "block"`.
- [x] `test/goldens/classification/`: one JSON per case holding baseline content, current content, the rule's `scope` and the expected `new | preexisting`. Cover the four cases that leave no fingerprint record (no snapshot, deadline, size ceiling, metered) and the known recall cost — a second violation added to an already-violating container is pre-existing.
- [x] `goldens.test.ts` walks both directories with `test.each`, so adding a case is adding a file. A mismatch prints a diff, not a boolean.
- [x] Write a `README.md` in `test/goldens/` saying what these are for and how to add a case — these outlive the TypeScript, which is the point.
- [x] **Generate nothing from the implementation.** Each expectation is written by hand or copied from a run that was read and agreed to. `test/adapters/contract.test.ts:21-23` already explains why self-recorded expectations pin stability rather than correctness; do not add a fifth corpus with that flaw.
- [x] Verify: `pnpm vitest run test/core/delivery/goldens.test.ts` → 30 passed. Then break the renderer by one character, confirm a golden fails, revert: changing the backlog heading's colon to a semicolon failed `backlog` and `one-of-each`.
- [x] Mutate `classify` too, not only the renderer: flip `<=` to `<` on the overlap test's upper bound and `>=` to `>` on its lower bound, one at a time.
- [x] Commit.

**What it delivered:** 14 delivery cases and 14 classification cases. 970 tests, 962 passing.

**What it found.** Both `classify` mutations — an off-by-one at either end of the container overlap test — passed the first version of this corpus *and* all 74 existing tests in `test/core/baseline`, `test/core/pipeline-container.test.ts` and `test/commands/run.test.ts`. No test anywhere put a match exactly on a container's boundary line. `container-boundary-first-line` and `container-boundary-last-line` were added for it, and each now catches exactly its own mutation. The classification expectations were written from §8's wording before running anything, and all twelve original ones agreed with the implementation on the first run.

**One planned case was dropped.** The plan asked for a `stop: "block"` delivery. `renderAgentText` never reads `stop` — it is the adapter that turns it into a block (`claude-code/adapter.ts:78`) — so that golden would have been byte-identical to the same delivery without it, asserting nothing. It belongs in the adapter's tests, which already cover it.

## Task 9: assemble, trim, gate

**Files:** modify `src/core/session/decide.ts:155-420` · modify `src/core/guard.ts:94-111` · modify `src/core/pipeline.ts:447-488` · test `test/core/session/decide-stages.test.ts`

**Behaviour:** Three functions where there was one. `assemble` builds the whole delivery and the metadata the budget needs; `trim` cuts it to a limit; `gate` reads what was *found*. The gate cannot see the trimmed delivery, so the subtlety that is a comment at `decide.ts:399-401` becomes a signature. The guard calls the first two and stops passing placeholders.

```ts
/** Everything the budget needs, including what a DeliveredReference cannot carry. */
export interface Assembled {
  delivery: Delivery
  /** References given full content, with the spec and hash trim needs to demote or record them. */
  candidates: { index: number; resolved: Extract<ResolvedRef, { found: true }> }[]
  /** Findings with status "new": what the gate asks about. */
  fresh: ClassifiedFinding[]
  unwarned: { key: string; text: string }[]
  context: ContextRecord[]
}

export function assemble(input: AssembleInput): Promise<Assembled>
export function trim(assembled: Assembled, limits: TrimLimits): { delivery: Delivery; overflow: Delivery | null; context: ContextRecord[] }
export function gate(fresh: ClassifiedFinding[], work: WorkState, agent: string, maxBlocks: number): { stop: Delivery["stop"]; work: WorkRecord[] }
```

- [ ] Split at the existing seams: `assemble` is `:156-212`, `trim` is `:214-397`, `gate` is `:399-417`. The untrimmed delivery already exists as `complete` at `:222` — it becomes part of what `assemble` hands over.
- [ ] `trim` returns new values rather than mutating. Two things have to change to make that work, both named in Decision 4: it needs `candidates` for `locationOf(spec)` and for the `{t:"delivered"}` records, and the identity filter at `:396` (`kept.get(rule)?.includes(finding)`) must become index-based.
- [ ] Keep `decide(input)` as a thin composition of the three, so nothing outside has to change in this task. `pipeline.ts` keeps calling it.
- [ ] `guard.ts:94-111` calls `assemble` then `trim` and passes neither `touches`, `agentRead`, `warnings`, `context` nor `stopGate`. Keep the comment at `:101-103` — it explains the empty context, which is now expressed by not having the parameter.
- [ ] Preserve the gate's two early returns (`:413`, `:415`): a `"allow"` discards the context records trim produced, and a `"capReached"` keeps the overflow. That ordering is load-bearing — the gate decides whether trim's records count.
- [ ] Tests: `gate` cannot be given a trimmed delivery (a type-level assertion in `test/plugin-api.ts` style, or simply no parameter that could carry one); `trim` called twice on the same `Assembled` returns equal results, which proves it no longer mutates its input; the guard's call passes four arguments, not thirteen.
- [ ] Verify: `pnpm vitest run test/core/session` → passes; the goldens from Task 8 → pass unchanged; `pnpm test` → passes.
- [ ] Commit.

## Task 10: the renderer prices its own output

**Files:** modify `src/core/delivery/render-agent.ts` · modify `src/core/session/decide.ts:45-58,240-358` · test `test/core/delivery/cost.test.ts`

**Behaviour:** One module knows what a delivery costs. The five hand-tuned constants and the copied `BACKLOG_HEADING` go away; the trim stage asks the renderer. The invariant — a rendered delivery fits its budget — is enforced by the module that produces the output.

- [ ] Factor the section builders out of `renderAgentText` so each can be called alone: `header`, the rule block (already `ruleBlock`), the backlog block, `referenceLines`, the warnings block, the overflow block. `renderAgentText` composes them and its output must be byte-identical — the Task 8 goldens are what proves it.
- [ ] Add `costOf`, priced in **bounded units only** (Decision 5): a fixed cost per section that prints at all, and a per-item cost for one item. Never a whole growing section from inside its own loop. Put the measurement in the doc comment — 8.5 ms versus 13,610 ms is the reason the signature is shaped this way, and the next person will otherwise simplify it back.
- [ ] Delete `ITEM_OVERHEAD`, `HEADER_OVERHEAD`, `OVERFLOW_NOTICE`, `REFERENCE_OVERHEAD` and `BACKLOG_HEADING` from `decide.ts`. `BACKLOG_HINT` is already imported from `render-agent` — the heading beside it was a byte-for-byte copy of `render-agent.ts:179`, which is the whole case for this task.
- [ ] `trim` charges through `costOf`. Keep the two-pass floor, the warning share and the per-rule fill loop exactly as they are: the loop's `maxMatchesPerRule` bound at `:367-371` is what keeps it linear and its comment explains why.
- [ ] Tests: `costOf` of each section equals the length of that section rendered alone; a delivery trimmed to a limit renders to at most that limit, asserted over the Task 8 golden corpus at several limits rather than only 900; and keep a scale assertion — 60,000 findings with 20,000 pre-existing summaries stays under 4 s, which is the regression the 13.6 s measurement predicts.
- [ ] Verify: `pnpm vitest run test/core/delivery test/core/session` → passes; the goldens → pass **unchanged**, which is the proof the renderer's output did not move; `pnpm test` → passes; `pnpm perf` → p95 no worse than 236 ms.
- [ ] Commit.

## Task 11: JSON Schema from the zod schemas — blocked

**Files:** create `scripts/schema.ts` · create `schema/rulecast-config.schema.json` · modify `package.json` · test `test/scripts/schema.test.ts`

**Behaviour:** The config format exists as data, so an editor completes `.rulecast-config.yaml` and a reimplementation has the defaults — 350 ms, 1 MiB, 60,000 ms, 32,768 bytes — and every `.strict()` in a form that is not TypeScript.

**Blocked:** `z.toJSONSchema` is a zod 4 API and the repo is on `3.25.76`. Do not start this task until PR #7 lands. Do not add `zod-to-json-schema` as an interim — a second schema library on the critical path of every hook costs more than the feature is worth before 1.0.

- [ ] *(after PR #7)* `scripts/schema.ts` emits JSON Schema from `configSchema` and the per-detector schemas, and writes it to `schema/`.
- [ ] *(after PR #7)* Commit the generated file and add a test asserting it matches a fresh generation, so drift is a failing test rather than a stale artifact.
- [ ] *(after PR #7)* Reference it from the README and from `agents/reference/`, and add `$schema` to the generated config in `init`.

## Task 12: document it

**Files:** modify `docs/specs/2026-09-15-rulecast-design.md` · modify `docs/plans/2026-09-15-rulecast-00-index.md` · modify `docs/conventions.md`

**Behaviour:** The spec says what was built, §17's claim about recorded contracts becomes true for three of four rather than two, and the plan index carries plan 9.

- [ ] §6 Contract: the `metered`, `cost`, `maxFilesPerEvent` and `wholeFile` properties alongside `guards`, and one line saying the core branches on declarations rather than on kind names.
- [ ] §13: the deadline contract is honoured by one predicate, named. State the defect that was fixed — an error raised past the deadline used to disable the rule for the session — because that is the kind of thing that gets reintroduced.
- [ ] §16: the plugin API is closed and a type-level guard holds it closed. Name `test/plugin-api.ts`.
- [ ] §17: the recorded-contracts row moves from two of four to three of four. The config schema is the one still outstanding, and it is blocked on zod 4 — say so, with the PR number.
- [ ] §13 or §17, whichever holds the warm note: `warmup` stays on the adapter interface, and why — the session-start trigger is tested and works for any detector that implements `warm`, so what is missing is a shipped consumer, not the machinery.
- [ ] `docs/conventions.md`: a new section on pricing bounded units, pointing at `costOf`. This is the convention most likely to be silently undone, and the repository's own rules can point at it.
- [ ] Plan index: plan 9's row, with the measurement that motivated it and the perf number after it.
- [ ] Verify: `pnpm test` → passes (the docs tests check agent-doc links resolve).
- [ ] Commit.

---

## End-to-end verification

From the repository root:

1. `pnpm test` → 930+ tests, no failures, and the two golden corpora pass **unchanged** from the commit that introduced them. That is the proof the eight refactors preserved behaviour.
2. `pnpm typecheck` → clean, including `test/plugin-api.ts`.
3. `pnpm perf` → p95 inside the 500 ms budget and no worse than the 236 ms recorded before this plan. Tasks 4, 5, 6 and 10 all touch the hook path.
4. `pnpm test:linux` → passes.
5. `pnpm build`, then confirm `dist/index.d.ts` names `Stage`, `ReferenceSpec` and `RuleExamples`, and that a scratch project importing only `@syv-ai/rulecast` can declare an `Adapter` and a `Detector` without reaching for `/internal`.
6. `grep -rn '"llm"' packages/rulecast/src/ | grep -v '^packages/rulecast/src/detectors/llm/'` → only `commands/run.ts:146`, the user-facing flag.
7. `node packages/rulecast/dist/cli.js run --all-files` on this repository → the four local rules still behave as they did, and `rulecast doctor` reports every detector ok.
8. Manually, in a scratch repository with an `ast-grep` rule over a large generated file: force the edit deadline low enough that the detector overruns, and confirm the hook logs a missed deadline and the rule still runs at the next event — rather than disabling it for the session, which is what Task 1 fixes.

## Open

- **Task 11 is blocked** on PR #7 (zod 3→4). Everything else in this plan is independent of it.
- The `--against` limitation recorded in plan 8d still stands: it measures the stock, not the incidence. The `no-direct-reads` defect fixed in `268407a` was a live example — it measured zero because the pattern was blind, not because the code was clean.
- `timeouts.verify_ms` defaults to 60 s and a measured `llm` call took 89 s. Still open, still the user's decision; §17's 0.2 row has the three options.
