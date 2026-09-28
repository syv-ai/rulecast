# rulecast Plan 8a — `scope: instance | container` Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule can declare whether its convention belongs to the *token* the detector matched or to the *container* the token sits in, and rulecast classifies its findings accordingly — so an edit that adds one `if` to an already-long route is reported as a new violation of `slim-routes`, and an edit anywhere inside a route that was already non-slim is not.

**Approach:** A new rule key `scope: instance | container`, defaulting to `instance` — today's behaviour. A `container` rule's baseline is not a set of changed lines but the set of container nodes that already violated the rule: rulecast records those ranges when it snapshots a file, and classifies a later match as pre-existing when a recorded range maps onto it through the same diff that produces the change set. No file content is stored and the edit path still runs each detector once.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: plan 7 is done. Independently shippable; `08b` and `08c` do not depend on it.

---

## Why this is a rule key and not a detector key

Spec §8 anticipated the feature under another name — *"a detector-declared `nonLocal` opt-in with cached fingerprints can be added later without breaking detectors"* — and put the opt-in on the detector. That is the wrong owner. `slim-routes` and `routes-never-call-crud` are both `ast-grep` rules over the same language and the same files; one is a property of a function and the other is a property of a call site, and no detector can tell them apart. The rule knows; nothing else does.

## The evidence this implements

Measured on 1,377 agent-written sites, precision / recall under three classification schemes:

| rule | report every match | changed lines only | before/after node flip |
|---|---|---|---|
| routes-never-call-crud | 0.60 / 0.98 | **1.00 / 0.58** | 1.00 / 0.27 |
| slim-routes | 0.62 / 0.82 | 0.59 / 0.26 | **0.76 / 0.15** |
| lifecycle | 0.58 / 0.57 | — | **0.94 / 0.16** |
| docstrings | 0.42 / 0.87 | — | **0.88 / 0.47** |

Neither scheme wins everywhere: the node flip *misses* a second `crud.` call added to a route that already had one (R 0.27 against 0.58). That is why this is a per-rule choice and not a change of default.

An `ast-grep` match's `endLine` is the whole matched node (`src/detectors/ast-grep/detector.ts:39`), so a container rule's match already spans any edit inside its container. Today's overlap test therefore scores a container rule like the "report every match" column — precision 0.62 for `slim-routes`. `container` moves it to the third column.

## Decisions this plan implements

1. **Fingerprints are recorded at `touch`, not recomputed at `edit`.** The alternative — store the before-content and run each container rule twice per edit — doubles the `ast-grep` work on the one path that has an agent blocked on it (§13: p95 220 ms against `edit_deadline_ms` 350 ms) and ends spec §8's *"No file content is stored"*. `touch` already reads the file to snapshot it, and the extra work is the container-scoped rules only, on one file. The edit path gains nothing but a lookup and a range mapping.

2. **No fingerprints means instance classification.** A file whose baseline came from the session-start commit rather than a snapshot, a rule whose fingerprint run hit the deadline, a file over `max_file_bytes` — each leaves no record, and a `container` rule then classifies exactly as it does today. This is the safe direction: instance classification over-reports (P 0.62) where the flip under-reports (R 0.15), and a missing baseline has always meant "treat it as new" (§8).

   An *empty* record is not a missing one. A container rule that ran at touch and matched nothing writes `ranges: []`, and every later match in that file is new — which is the flip the feature exists for.

3. **`llm` rules never get fingerprints.** The fingerprint run is a second evaluation of the rule, and for `llm` that is a second billed model call on every file the agent reads. §6 Consent makes that unacceptable as a side effect of opening a file. A `container` `llm` rule compiles and runs; it classifies as `instance`. Task 6 is where this is stated to the user.

4. **`verify` computes missing fingerprints on demand; `edit` does not.** `rulecast run --from-ref` is how a team gates a pull request, and it has no session and no snapshots, so without this every container rule degrades to instance exactly where it matters most. A verify has seconds (`verify_ms`, default 60 000) and already reads the base commit's content in `computeChanges`. An edit has 350 ms and skips this.

5. **The compile check is what compilation can actually see.** `scope: container` on a rule with no `detect` is a diagnostic — there is nothing to classify. Whether a *pattern* matches a container node rather than a token is not knowable at compile time: `ast-grep` resolves node kinds against the parsed file, not the rule object. `rulecast test` (plan 8c) is where an author finds out, because it has real files to match against. Do not invent a heuristic here.

6. **Detectors are not told about `scope`.** `DetectorRun` is unchanged and `changes` still means changed lines. A detector that tried to diff-scope its own patterns would reintroduce the second error in the table above — the one the baseline exists to avoid — and spec §6 already says the baseline is the core's job.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- No module-level mutable state in `src/`.
- `pnpm perf` before the last task and after it: this plan touches the edit path.
- `pnpm test:linux` before pushing — this plan touches the baseline store on disk.
- lefthook runs biome (`--error-on-warnings`, with `--write`) and `pnpm typecheck` on commit, `pnpm test` on push. Never bypass them.
- Stage by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, stash, reset or checkout.
- Commit after every task, straight to `main`. Commit messages end with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`.
- **When a planned test fails, find the cause before changing the test.**

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/config/schema.ts` | `scope` in `ruleKeys` |
| `src/core/compile/rule.ts` | `CompiledRule.scope`; the `scope` without `detect` diagnostic |
| `src/core/baseline/changes.ts` | `diffLines`: one diff producing both the changed ranges and a before→after `LineMap` |
| `src/core/baseline/fingerprint.ts` | **new.** `Fingerprint`, `mapRange`, `isNewContainer` |
| `src/core/baseline/store.ts` | The `fingerprint` record; `BaselineState.fingerprints` |
| `src/core/baseline/baseline.ts` | `ChangeSet.map`; `classify(match, rule, changes, fingerprints)` replacing `isNew` |
| `src/core/baseline/record.ts` | **new.** `recordFingerprints`: run the container rules of a file and turn the matches into records |
| `src/core/types.ts` | `ChangeSet` gains `map` |
| `src/core/pipeline.ts` | Fingerprints on `touch`; on-demand fingerprints on `verify`; `classify` at the classification site |
| `src/index.ts` | Exports the new types |
| `test/core/baseline/changes.test.ts` | The line map |
| `test/core/baseline/fingerprint.test.ts` | Range mapping and container classification |
| `test/core/baseline/store.test.ts` | Fingerprint records round-trip, first-writer-wins |
| `test/core/pipeline-container.test.ts` | **new.** touch → edit → verify with a container rule, end to end |
| `test/core/compile/rule.test.ts` | The `scope` diagnostic and the default |
| `docs/specs/2026-09-15-rulecast-design.md` | §4 rule keys, §8 Classification, §13, §17 |
| `agents/reference/rule-format.md` | `scope` in the rule-key reference |

---

## Task 1: `scope` compiles

**Files:** modify `src/core/config/schema.ts:16-35` · modify `src/core/compile/rule.ts:22-37,96-122,138-152` · test `test/core/compile/rule.test.ts`

**Behaviour:** `scope: instance | container` parses as a rule key and as an override key, reaches `CompiledRule.scope`, and defaults to `"instance"`. `scope` on a rule with no `detect` is the diagnostic `scope needs detect: there is nothing to classify`. Nothing else changes: every existing rule compiles to `scope: "instance"` and behaves as before.

- [ ] Add `scope: z.enum(["instance", "container"]).optional()` to `ruleKeys` in `schema.ts`. It is inside `ruleKeys`, so `overrideSchema` picks it up and a config entry can override a manifest rule's scope.
- [ ] Add `scope: RuleScope` to `CompiledRule` in `rule.ts`, where `export type RuleScope = "instance" | "container"`. Set it from `data.scope ?? "instance"` in the returned object.
- [ ] In the `else` branch of `compileRule` (the no-detector branch, `rule.ts:116-122`), return `"scope needs detect: there is nothing to classify"` when `data.scope !== undefined`.
- [ ] Write the failing tests first: a rule with `scope: container` compiles and carries it; a rule with no `scope` compiles to `instance`; a touch rule with `scope` is a diagnostic; `scope: sideways` is a schema error naming the key.
- [ ] Verify: `pnpm vitest run test/core/compile/rule.test.ts` → passes; `pnpm typecheck` → clean.
- [ ] Commit.

## Task 2: one diff, two products

**Files:** modify `src/core/baseline/changes.ts` · modify `src/core/types.ts:47-50` · modify `src/core/baseline/baseline.ts:31-38` · test `test/core/baseline/changes.test.ts`

**Behaviour:** The Myers diff that produces changed line ranges also produces a map from a *before* line number to the line it now occupies in the *after* file. `computeChanges` puts the map on the `ChangeSet`. Existing change-set behaviour is byte-for-byte unchanged.

```ts
/** Unchanged runs, in order: before line `beforeStart` is now after line `afterStart`. */
export interface LineMap {
  runs: { beforeStart: number; afterStart: number; count: number }[]
  /** Lines in the after file, so a before line past every run maps to the end. */
  afterLines: number
}

export interface DiffResult {
  changed: [number, number][]
  map: LineMap
}

export function diffLines(before: Uint32Array, after: Uint32Array): DiffResult
```

- [ ] Rename `changedLines` to `diffLines` and have it return both products from the single `diffArrays` walk it already does. An unchanged part appends a run; an added or removed part advances the relevant cursor only. Keep the existing `mark` behaviour for `changed` exactly as it is, including the deletion case.
- [ ] Add `mapLine(map: LineMap, line: number): number`: the run containing `line` gives `afterStart + (line - beforeStart)`; a line inside a removed stretch gives the `afterStart` of the next run; a line past every run gives `afterLines + 1`. It never returns null — a deleted container maps to where it used to be, which is what an overlap test wants.
- [ ] `ChangeSet` gains `map: LineMap`. `computeChanges` sets it from `diffLines`; the `fileHash` equality shortcut builds the identity map (one run covering the whole file).
- [ ] Tests: insertion at the top shifts every later line; a deletion in the middle pulls later lines up; a replacement of equal length maps identically; an unchanged file maps every line to itself; a line inside a deleted run maps to the line that replaced it; the existing `changedLines` cases still produce the same ranges through `diffLines`.
- [ ] Verify: `pnpm vitest run test/core/baseline` → passes.
- [ ] Commit.

## Task 3: fingerprint records in the baseline store

**Files:** modify `src/core/baseline/store.ts` · test `test/core/baseline/store.test.ts`

**Behaviour:** `baseline.jsonl` can carry, per file and rule, the line ranges that rule matched in the file's baseline content. Records are first-writer-wins per `(file, rule)`, like snapshots. An absent record and an empty one are different: absent means never measured, empty means measured and clean.

```ts
type BaselineRecord =
  | { t: "start"; commit: string | null }
  | { t: "snapshot"; file: string; fileHash: number; lines: string }
  | { t: "fingerprint"; file: string; rule: string; ranges: [number, number][] }

export interface BaselineState {
  started: boolean
  startCommit: string | null
  snapshots: Map<string, Snapshot>
  /** file → rule → the ranges that rule matched at baseline. */
  fingerprints: Map<string, Map<string, [number, number][]>>
}
```

- [ ] Add the record variant, `fingerprintRecord(file, rule, ranges)`, and the `fingerprints` map to `BaselineState` and `readBaseline`. Ranges are plain JSON: a container rule matches a handful of nodes per file, so the base64 packing snapshots need is not worth the opacity.
- [ ] First-writer-wins per `(file, rule)`: a second record for the same pair is ignored.
- [ ] Tests: a round trip through `appendBaseline`/`readBaseline`; an empty `ranges` array survives and is distinguishable from no record; first-writer-wins; a file with fingerprints for two rules; a store containing only `start` and `snapshot` records still reads (old sessions).
- [ ] Verify: `pnpm vitest run test/core/baseline/store.test.ts` → passes.
- [ ] Commit.

## Task 4: container classification

**Files:** create `src/core/baseline/fingerprint.ts` · modify `src/core/baseline/baseline.ts:42-46` · test `test/core/baseline/fingerprint.test.ts`

**Behaviour:** Given a match, its rule's scope, the file's change set and the file's baseline fingerprints, rulecast says `new` or `preexisting`. An `instance` rule is classified by line overlap, exactly as today. A `container` rule with a fingerprint record is new only when no recorded range, mapped into the current file's line space, overlaps the match. A `container` rule with no record falls back to line overlap.

```ts
export function classify(
  match: Match,
  scope: RuleScope,
  rule: string,
  changes: ReadonlyMap<string, ChangeSet>,
  fingerprints: ReadonlyMap<string, ReadonlyMap<string, [number, number][]>>,
): "new" | "preexisting"
```

- [ ] Move `isNew` into `fingerprint.ts` as the instance path, keeping its current behaviour (no change set for the file → `new`).
- [ ] `mapRange(map, [start, end])` → the range in after-space, via `mapLine` on both ends.
- [ ] The container path: `new` unless some mapped baseline range overlaps `[match.line, match.endLine]`. Absent record (`fingerprints.get(file)?.has(rule) !== true`) → the instance path. No change set for the file → `new`, as instance does.
- [ ] Tests, written first, each as a small table of ranges rather than real files: a route that violated before and still does after an unrelated edit inside it → `preexisting` (this is the case the plan exists for); a route that was clean and now violates → `new`; a *second* violation added to a route that already violated → `preexisting` (the known recall cost, asserted so nobody "fixes" it by accident); an empty record → every match `new`; no record → falls back to overlap; insertions above the container shift the recorded range so it still matches; a container whose baseline range was deleted outright does not swallow an unrelated later match.
- [ ] Verify: `pnpm vitest run test/core/baseline/fingerprint.test.ts` → passes.
- [ ] Commit.

## Task 5: recording fingerprints at `touch`

**Files:** create `src/core/baseline/record.ts` · modify `src/core/pipeline.ts:254-265,333-337` · test `test/core/pipeline-container.test.ts`

**Behaviour:** When a `touch` event snapshots a file, rulecast also runs the project's `container`-scoped detector rules that match that file over the file's current content and appends a fingerprint record per rule — including an empty one for a rule that matched nothing. On a later `edit` or `verify`, a `container` rule's findings are classified against those records. `llm` rules are never run for fingerprints. The whole thing is bounded by `edit_deadline_ms` and `max_file_bytes`; whatever does not finish writes no record and so falls back to instance.

```ts
export interface RecordInput {
  root: string
  files: readonly string[]   // the files snapshotted in this event
  rules: readonly CompiledRule[]
  disabled: ReadonlySet<string>
  registry: DetectorRegistry
  // …the same read / cacheFor / contextFor / settings the pipeline gives runDetection
  timeoutMs: number
  maxFileBytes: number
}

/** One record per (file, rule) attempted, including empty ones. Never throws. */
export async function recordFingerprints(input: RecordInput): Promise<BaselineRecord[]>
```

- [ ] `recordFingerprints` selects with `selectDetectorRules(rules, "edit", files, disabled)` filtered to `rule.scope === "container"` and `rule.detector.kind !== "llm"`, applies `applySizeCeiling` the way the edit path does, and calls `runDetection` with `changes` empty and `event: "edit"`. Group the resulting matches by `(file, rule)` and emit a record for every `(file, rule)` pair the run *attempted* — a rule that timed out or was size-skipped emits nothing.
- [ ] Return early with `[]` when no rule in the project has `scope: "container"`. This is the common case and it must cost one array scan, not a detector run.
- [ ] In `pipeline.ts`, inside the existing `event.kind === "touch"` block, build the snapshot records as now, then append `recordFingerprints` output in the same `appendBaseline` call. Use `config.timeouts.editDeadlineMs` and `config.maxFileBytes`.
- [ ] At the classification site (`pipeline.ts:333-337`) call `classify(match, rule.scope, rule.id, changes, baseline.fingerprints)`.
- [ ] Test end to end through the pipeline, with an `ast-grep` container rule on a fixture file: `touch` a file holding an already-violating container → `edit` it elsewhere inside that container → no new finding, one pre-existing summary; `touch` a clean file → `edit` it so the container now violates → one new finding; the same pair with `scope` omitted → both report new (today's behaviour, unchanged); a project with no container rule takes no fingerprint run (assert on the record count in `baseline.jsonl`).
- [ ] Verify: `pnpm vitest run test/core/pipeline-container.test.ts` → passes; `pnpm test` → passes; `pnpm perf` → p95 still inside the budget, and note the number in the commit message.
- [ ] Commit.

## Task 6: `verify` fills in what it is missing

**Files:** modify `src/core/baseline/record.ts` · modify `src/core/pipeline.ts:278-290` · test `test/core/pipeline-container.test.ts` · test `test/commands/run.test.ts`

**Behaviour:** On a `verify` event, a file with a baseline but no fingerprint record for a container rule gets one computed from the baseline content — the session-start commit, or `--from-ref`'s merge base — before classification. So `rulecast run --from-ref main` classifies container rules by the flip rather than by overlap. These records are computed in memory; a verify with a session also appends them, so the next event reuses them.

- [ ] Add `fingerprintsFromText(input, texts: Map<file, string>)`, taking the baseline content directly rather than reading from disk — `runDetection`'s `read` is a function, so pass one that serves `texts`.
- [ ] In `pipeline.ts`, in the `verify` branch after `computeChanges`, collect the files that have a change set, lack a fingerprint for at least one container rule, and whose baseline content is reachable (`fileAtCommit(root, fallbackCommit, file)`), and fill them in. Use `config.timeouts.verifyMs`, not the edit deadline — a verify has seconds (Decision 4).
- [ ] `computeChanges` already fetches that content for the fallback path; lift it so the file is read from git once per event, not twice.
- [ ] Tests: `rulecast run --from-ref <ref>` over a fixture where the base commit already violates a container rule and the branch edits inside it → no findings; the same where the branch's edit makes a clean container violate → one finding; an edit event does *not* fill fingerprints in (assert the record count, so the edit path stays one pass).
- [ ] Verify: `pnpm vitest run test/commands/run.test.ts test/core/pipeline-container.test.ts` → passes; `pnpm perf` → unchanged.
- [ ] Commit.

## Task 7: document it

**Files:** modify `docs/specs/2026-09-15-rulecast-design.md:286-305,488-497,829-836` · modify `agents/reference/rule-format.md`

**Behaviour:** The spec describes `scope` as a rule key, replaces §8's `nonLocal` note with what was actually built, and records the `python/thin-routes` recommendation the handoff asked to be written down rather than acted on.

- [ ] §4 Rule keys: a `scope` entry — `instance` (default) classifies a finding by whether it touches a changed line; `container` classifies it by whether the container it matched already violated the rule at the baseline. One sentence on when to reach for it: the convention is a property of the enclosing function or component, not of the token.
- [ ] §8 Classification: replace the "Known miss … `nonLocal` opt-in with cached fingerprints" paragraph with the fingerprint mechanism, the record format, the four cases that leave no record (no snapshot, deadline, size ceiling, `llm`), and the recall cost of the flip — a second violation added to an already-violating container is pre-existing.
- [ ] §8 Storage: the `fingerprint` record alongside `start` and `snapshot`. Keep the *"No file content is stored"* sentence: it is still true, and it is the reason this design was chosen over the second-pass one.
- [ ] §13: one line saying the fingerprint run is on the `touch` path and the edit path still runs each detector once.
- [ ] §17: in the 0.2 row, `scope: instance | container`. Add a line recording that **`python/thin-routes` measured P 0.99 / R 0.90 as an `ast-grep` pattern under the catalog's wording and P 0.70 / R 0.84 under a stricter one** — evidence for converting it from `llm`, on one codebase, not acted on.
- [ ] `agents/reference/rule-format.md`: `scope` in the key reference, with the `slim-routes` example.
- [ ] Verify: `pnpm test` → passes (the docs tests check that agent-doc links resolve).
- [ ] Commit.

---

## End-to-end verification

From the repository root, against the fixture project the pipeline tests use:

1. `pnpm test` → 846+ tests, no failures.
2. `pnpm typecheck` → clean.
3. `pnpm perf` → p95 inside the 500 ms budget, and no worse than the 220 ms recorded before this plan. A project with no `container` rule must measure identically; one with a container `ast-grep` rule pays on `touch` and not on `edit`.
4. `pnpm test:linux` → passes. This plan writes new records to `baseline.jsonl`.
5. Manually, in a scratch repository with a `slim-routes` container rule: read a file with an already-long route, add a line to it, and confirm the hook reports nothing; then shorten a different route to compliance, add enough to it to break the rule, and confirm the hook reports exactly that one.
