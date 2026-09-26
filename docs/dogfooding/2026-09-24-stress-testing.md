# Stress testing rulecast

**Date:** 2026-09-24 · **Machine:** Apple M3 Pro, Node v24.9.0 · **rulecast:** `2533d3b` plus the fixes below · **Harness:** `pnpm stress`, 20 scenarios

The design review said where the code looked thinnest. This is what happened when it was pushed
there: large repositories, hostile input, parallel hooks on one session, and long agent sessions.

**Three hangs and one crash, all fixed.** One finding is a design question and is reported, not
decided. The numbers below are this machine's.

## The harness

`packages/rulecast/scripts/stress/`, modelled on `scripts/bench/`. Each scenario runs **in its own
process under a watchdog**, which is the whole design: the defect class being hunted is work that
blocks its own event loop, and a harness that ran scenarios in-process would hang on exactly the
thing it exists to find. A wedged scenario is a result — `hung` — not a wedged run.

Outcomes are `ok`, `violated` (ran, but a check failed), `crashed` and `hung`. `pnpm stress` exits
non-zero when anything but `ok` appears, and writes `stress/results.json` and a self-contained
`stress/index.html` (gitignored: the numbers belong to the machine that ran them).

`test/scripts/stress.test.ts` tests the harness itself, including a fixture scenario that really
does block its event loop, because a harness that silently measured nothing would report every
scenario green and look like the best possible result. The first version of this harness made
precisely that mistake — four green scenarios, zero findings, because every fixture file was
committed and unchanged, so every match classified as `preexisting` and never reached the delivery.

## What broke

### 1. The delivery is quadratic in one rule's matches — a hang on ordinary input

**The worst finding, and the one no lead predicted**, because it needs no hostile input at all: an
ordinary pattern on a large generated or minified file.

`decide.ts` and `render-agent.ts` grouped findings by rule with
`map.set(id, [...(map.get(id) ?? []), finding])`, rebuilding the whole array once per finding. Every
other phase is linear; this one is not:

| File | Matches | `matchAll` | `positionAt` | `isNew` | **Whole pipeline** |
|---|---|---|---|---|---|
| 0.5 MB | 16,074 | 3 ms | 2 ms | 1 ms | **368 ms** |
| 1 MB | 31,494 | 9 ms | 3 ms | 2 ms | **1,916 ms** |
| 2 MB | 62,335 | 19 ms | 5 ms | 3 ms | **5,945 ms** |
| 8 MB | ~262,000 | — | — | — | **never finished inside a 60 s watchdog** |

Against a 350 ms edit deadline, which cannot preempt it — the work is synchronous (§13).

**Fixed** by appending in place, in `decide.ts`, `render-agent.ts`, `adapters/cli/format.ts` (the
`rulecast run --all-files` path, where a whole repository's findings arrive at once) and
`detection/run.ts`. The 8 MB file now completes in **1.0 s**; 45,000 matches in one file went from
**3,552 ms to 305 ms**.

Regression test: `test/core/session/decide-scale.test.ts`. It asserts a time limit, which is
unusual and deliberate — the defect is only visible as a curve, and an assertion on the output
alone passed throughout. Verified failing (5.8 s and 5.6 s against a 4 s bound) before the fix.

### 2. A synchronous detector could not be preempted by its own deadline

The review's strongest lead, confirmed on both paths and worse than described.

`run.ts` enforces the deadline with `Promise.race([detector.run(…), deadline])`, where `deadline`
resolves from a `setTimeout`. A timer only fires when the event loop is free, and `regex` ran
`text.matchAll(…)` synchronously. So `(a+)+$` against thirty `a`s **never finished inside a 30 second
watchdog** on the edit path or on the `PreToolUse` guard, where it holds up the agent's write.

Two separate defects, both fixed:

- **The deadline was not even reported.** When the blocked detector finally returned, its promise
  settled in a microtask — which runs *ahead* of the queued abort timer — so it won the race and a
  6.8 second run was recorded as a clean, on-time one: `deadlineMissed` empty, nothing logged, no
  background warm-up. `run.ts` now decides by wall clock.
- **Nothing could interrupt the matching.** `vm.Script#runInContext` takes a `timeout`, and V8
  interrupts a running regex for it. `regex` now matches inside it, bounded by the remaining
  deadline. `vm` is not being used as a sandbox and nothing here pretends otherwise — the timeout is
  the only thing borrowed.

Measured cost: **~54 µs per call**, so every pattern for one file goes in a single call. That matters
— per rule per file, a 500-rule project over 200 files would have paid it 100,000 times, 5.4 seconds
of pure overhead. Driving regex by file rather than by rule also stopped it reading the same file
once per rule, and `many-rules` got **faster than before the fix: 7.2 s → 3.9 s**.

**Hot-path cost, measured interleaved** (two separate runs cannot be compared on this machine): the
vm call adds **47 µs per regex detector run** on the perf fixture's shape — 12 rules over one
300-line file — which is 0.02% of a 204 ms edit hook, against the 11 file reads the same change
removes. `pnpm perf` on the branch: **p50 204 ms, p95 224 ms, 55% under the 500 ms budget**, at load
average 8.6.

The interrupt lands a moment *before* the deadline, so asking the clock afterwards gives the wrong
answer by a millisecond and silently disables a working rule. Hence `DeadlineError` as a type:
§14 makes a deadline miss and a rule error mean very different things.

`(a+)+$` now returns in **387 ms against a 350 ms deadline** on the edit path and **353 ms** on the
guard. Regression test: `test/core/pipeline-backtracking.test.ts` — which before the fix could not
be timed out even by vitest, the same failure shape as the `/proc` hang that once cost six-hour CI
runs.

**`ast-grep` is not covered by this.** It parses in native code, which `TerminateExecution` does not
interrupt. A 2.6 MB TypeScript file takes 762 ms — fine on a verify, over the edit deadline, and now
correctly *reported* as a deadline miss (`deadlineMissed=[ast-grep]` after 570 ms) rather than
delivered late. Bounding it would need a different mechanism; scenario `ast-grep-huge-file` holds
the measurement.

### 3. A corrupt session store crashed the hook

§14 says a store that cannot be read runs the invocation without session state and warns.
`pipeline.ts` caught only `LockTimeoutError`, so the other half of that same table row —
`CorruptStoreError` — was thrown straight out of the hook.

`core/jsonl.ts` tolerates an unparseable *last* line, because only a crash mid-append can leave one.
A half-written record anywhere else is a `CorruptStoreError`, which is reachable from `readBaseline`,
`openSession` and `commitSession`.

**Fixed**: all three now degrade to running without session memory, with the warning §14 specifies.
Dropping the session also stops anything more being appended to a store whose shape is no longer
understood. Regression test: `test/core/pipeline-corrupt-store.test.ts`.

## What held

Everything else, including all four of the review's remaining leads.

| Scenario | Result |
|---|---|
| `large-repo` — 5,000 files, 300 changed, one verify | 4.6 s, no failure |
| `many-rules` — 500 rules × 200 files | compile 41 ms, verify 3.6 s, 160 findings |
| `parallel-hooks` — 16 hooks at once on one session id | 16/16 completed, **0 lock fallbacks**, all 16 edits in the work log |
| `jsonl-append-race` — 64 concurrent appenders | **512 of 512 records survive**, store stays parseable |
| `stale-lock` — a lock left behind by a killed hook | waits its 2 s, then delivers without session memory and says so |
| `compaction-mid-edit` — 3 resets interleaved with 12 edits | 15 events, none threw |
| `subagents` — main plus 8 subagents committing together | none threw |
| `long-session` — 400 turns | **no growth**: last 20 turns are 0.86× the first 20, p95 19 ms, stores 34 KiB |
| `binary-and-encodings` — NUL bytes, lone surrogate, BOM, CRLF, a 2 MB single line, emoji | 8 findings, sane 1-based lines, no rule disabled |
| `broken-configs` — 9 malformed configs incl. a 5 MB pattern and 400-deep nesting | every one a diagnostic, never an exception; slowest 20 ms |
| `awkward-paths` — spaces, quotes, þorn, 日本語, a 200-char name, a leading dash | all 9 matched |
| `llm-provider-missing` — 12 llm rules, no provider binary | **1 warning for 12 rules**, 38 ms, `failed=true`. §14 honoured |
| `llm-file-budget` — 40 files against `max_files_per_verify` 10 | the cut is named once, not per file |

The session model in particular came out well: 400 turns with flat per-event cost and 34 KiB of
store is not a model that degrades over a working day.

## The one design question — for you to decide

**Warnings are unbounded and charged before anything else, so they can crowd findings out entirely.**

This is the review's lead 2, now measured exactly. `decide.ts` starts the budget at
`HEADER_OVERHEAD + sum(warnings)` and never drops a warning. `pipeline.ts` pushes one per failed
detector and one per compile diagnostic.

With **80 broken rules and one working rule that fires**:

- 80 warnings, **13,500 characters against a 9,000-character budget**
- the working rule's finding is **dropped whole** (`omitted.rules: 1`)
- **the agent receives 80 "this rule is broken" warnings and zero findings**

The stop gate no longer misreads this — `fd498c7` fixed that, and it reads the classified findings —
but the delivery itself still collapses to warnings and nothing else.

80 broken rules is not a normal project. It is not far-fetched either: a rule repo pinned to a rev
that has moved, or a `minimum_rulecast_version` bump, can invalidate many rules at once, and that is
exactly the moment the remaining working rules matter most.

The options, none taken:

1. **Cap warnings** at some count, with "…and N more (run `rulecast validate`)".
2. **Summarise** them: one line per source — "12 rules in `repo@rev` failed to compile".
3. **Charge them after the floor**, so a rule that fired always outranks a rule that is broken.
4. **Leave it**, on the grounds that a project with 80 broken rules should be fixing them first.

My read is (2) then (3): the agent cannot act on 80 individual compile errors mid-session, and the
finding it *can* act on is the thing being lost. But this changes what the budget means, which the
handoff put off limits, so it is yours.

Scenario `warning-flood` holds the measurement and will keep failing until this is decided — which
is the intended state, not an oversight.

## Smaller things noticed, not changed

- **`decide.ts` measures matches past `max_matches_per_rule`.** The review's lead 3. Confirmed still
  true and still load-bearing; the `Math.min` guard is commented as such. No other caller measures
  past the cap, so nothing else is affected.
- **The edit deadline bounds detection, not the work after it.** An 8 MB file now completes in 1.0 s
  against a 350 ms deadline: matching is bounded, but the change set, the position mapping and the
  delivery for a quarter-million matches are not. Worth knowing before trusting the deadline as a
  wall-clock guarantee.
- **`state.ts:58` rebuilds the accessed-file list per record** — the same copy-on-append shape as
  finding 1, bounded by distinct files per agent rather than by matches. It did not show up in the
  400-turn session and was left alone.

## Running it

```sh
pnpm stress                       # all 20 scenarios, ~40 s, exits non-zero on any finding
pnpm stress catastrophic          # substring filter, for working on one
```

No scenario calls a model or opens a socket. The `llm` scenarios drive the provider-unavailable and
file-budget paths with no agent CLI on `PATH`, so they stay hermetic and free.
