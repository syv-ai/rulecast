# rulecast Plan 8c — `rulecast test`, authoring-time rule scoring

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule author finds out whether a rule works *before* enabling it on a repository: inline good/bad examples that `rulecast test` runs, and a dry fire over real files that says how many violations the rule would produce and in how many files. The `react/no-inline-style` case — 131 true-by-definition findings nobody would keep, discovered only after adoption — becomes a number the author sees while drafting.

**Approach:** An `examples` rule key holding `good` and `bad` cases, each a path and a body. `rulecast test` materialises them into a temporary directory and runs the rule through the ordinary verify path, so every detector kind works and nothing about detection is special-cased for testing. `rulecast test RULE_ID --against <paths>` runs the same rule over real files and reports the spread. Both are hermetic apart from the detectors the rule itself names.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: plan 7 is done. Independent of `08a` and `08b`, though `08a`'s `scope` is one of the things `rulecast test` is the place to check.

This is the 0.2 row's *"rule tests (inline good/bad examples run by `rulecast test`)"* (spec §17).

---

## The evidence this implements

1. **Tier membership depends on the wording, not the convention.** The same convention produced a pattern scoring P 0.99 / R 0.90 under the catalog's wording and P 0.70 / R 0.84 under the owner's stricter one. A catalog cannot fix tiers once, and *"this needs an `llm`"* cannot be decided once. Rule drafting should attempt a pattern, measure it against examples, and fall back to `llm` only on failure — which is a change to `agents/DRAFT-RULES.md`, in Task 6, not only to the CLI.

2. **Two authoring-time reasons not to ship a rule, both cheap to detect.** Nobody breaks it: 8 of 15 conventions had under 25 violations in ~1,300 sites. Or nobody agrees what breaks it: two frontier runs agreed at κ 0.51 and 0.27 on the two conventions most in need of judgement. A convention two careful readers cannot apply the same way is a preference, not a rule.

   **This plan builds the first and not the second.** κ needs two independent labelling passes over a real corpus by a model, which costs money, is not hermetic, and cannot run in `pnpm test` (§15). What `--against` gives instead is the *volume* signal, which catches both failure modes from opposite ends — a rule that fires three times in a repository nobody is breaking, and a rule that fires 131 times because it is true by definition.

## Decisions this plan implements

1. **Examples run through the real verify path.** `rulecast test` writes each example to a temporary directory, compiles a project containing just that rule, and runs the same pipeline `rulecast run` does. The alternative — handing the content straight to `detector.run` — would work only for the three detectors with `guards: true` and would quietly not test `linter`, `command` or `llm` rules, which are the ones an author is least sure about.

2. **An example declares its path.** `files`, `exclude`, the type tags and `ast-grep`'s language selection are all functions of the path. An example without one would be testing a different rule than the one that will run. `path` is required; there is no default worth guessing.

3. **A bad example must produce at least one finding; a good example must produce none.** Not an exact count: a pattern that matches a violation twice is not a failure, and pinning the count makes every example brittle against a detector change. An author who wants a count uses `--against`.

4. **`rulecast test` never calls a model unless the rule is an `llm` rule.** No consent problem — running a rule's own examples is the author asking for exactly that — but `rulecast test` with no arguments over a project with `llm` rules would be a surprise bill. So bare `rulecast test` skips `llm` rules with a line saying so, and `rulecast test <llm-rule-id>` runs them. This matches `run --no-llm` being opt-out and `init` being opt-in (§6 Consent).

5. **Examples are part of the rule, so they ship in the manifest.** A catalog rule's examples are the executable half of its documentation, and a consumer who overrides `files` or the pattern needs them to check the override. `pnpm manifest` carries them through.

6. **`--against` reports, it never fails.** There is no threshold that is right for every rule: 131 findings is a disaster for `no-inline-style` and a normal Tuesday for a migration rule. It exits 0 whatever it finds, and prints the two numbers plus the per-file spread that tells the author which of the two failure modes they are looking at.

## Conventions

As plan 8a: pnpm workspace, `packages/rulecast/`, vitest, biome + typecheck on commit, full suite on push, commit after every task straight to `main`, messages ending with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`.

**`pnpm test:linux` before pushing.** `rulecast test` creates and removes a temporary directory and runs detectors inside it; that is exactly the class of change the Linux run exists to catch (§15, the `/proc` case).

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/config/schema.ts` | `examples` in `ruleKeys` |
| `src/core/compile/rule.ts` | `CompiledRule.examples`; the examples-without-`detect` diagnostic |
| `src/core/examples.ts` | **new.** `runExamples`: materialise, run, score. The whole mechanism, so the command is only I/O |
| `src/commands/test.ts` | **new.** The `test` command: argument parsing, output, exit code |
| `src/commands/main.ts` | `test` in the `switch` |
| `src/commands/usage.ts` | The `test` usage block |
| `src/commands/validate.ts` | `validate` reports a rule with no examples as a warning, not an error |
| `packages/rules-*/rules.yaml` | Examples for every catalog rule |
| `packages/rulecast/scripts/generate-manifest.ts` | Carry `examples` into `.rulecast-rules.yaml` |
| `agents/DRAFT-RULES.md` | The attempt-a-pattern-then-measure flow |
| `agents/reference/rule-format.md` | The `examples` key |
| `src/index.ts` | Exports `runExamples`, `ExampleResult` |
| `test/core/examples.test.ts` | **new.** The runner, per detector kind |
| `test/commands/test.test.ts` | **new.** The command, its output and its exit codes |
| `test/commands/help.test.ts` | The usage text gains `test` |
| `test/catalog.test.ts` | Every catalog rule's examples pass |
| `docs/specs/2026-09-15-rulecast-design.md` | §4, §12 (CLI), §15, §17 |

---

## Task 1: the `examples` rule key

**Files:** modify `src/core/config/schema.ts:16-35` · modify `src/core/compile/rule.ts:22-37,96-122,138-152` · test `test/core/compile/rule.test.ts`

**Behaviour:** A rule can declare examples, they survive compilation, and a rule with examples and no `detect` is a diagnostic.

```yaml
examples:
  good:
    - path: app/api/routes/users.py
      code: |
        @router.get("/users")
        async def list_users(service: UserService) -> list[User]:
            return await service.list_users()
  bad:
    - path: app/api/routes/users.py
      code: |
        @router.get("/users")
        async def list_users(db: Session) -> list[User]:
            return await crud.list_users(db)
```

```ts
export interface RuleExample {
  path: string
  code: string
}
export interface RuleExamples {
  good: RuleExample[]
  bad: RuleExample[]
}
```

- [ ] Schema: `examples: z.object({ good: z.array(exampleSchema).default([]), bad: z.array(exampleSchema).default([]) }).strict().optional()`, where an example is `{ path: z.string().min(1), code: z.string() }`. In `ruleKeys`, so an override can replace them.
- [ ] `CompiledRule.examples: RuleExamples | null`, `null` when the key is absent — distinct from present-and-empty, which `validate` and `test` report differently.
- [ ] Diagnostic in the no-detector branch: `examples need detect: there is nothing to run them against`.
- [ ] Diagnostic when an example's `path` does not match the rule's own `files`/`exclude`/type filters: `example path "<path>" does not match this rule's files`. This is the mistake that makes an example silently pass, and `rule.matches(path)` already answers it at compile time.
- [ ] Tests: examples compile and round-trip; absent is `null`; present-and-empty is not `null`; a touch rule with examples is a diagnostic; a `bad` example whose path the rule excludes is a diagnostic naming the path.
- [ ] Verify: `pnpm vitest run test/core/compile/rule.test.ts` → passes.
- [ ] Commit.

## Task 2: running examples

**Files:** create `src/core/examples.ts` · test `test/core/examples.test.ts`

**Behaviour:** Given a compiled rule and a detector registry, run its examples and report which passed. Each example becomes one file in a temporary directory; the rule runs against it as a `verify` with no baseline, so every finding is new. A `bad` example passes when it produced at least one finding, a `good` example when it produced none.

```ts
export interface ExampleOutcome {
  kind: "good" | "bad"
  index: number
  path: string
  passed: boolean
  /** The findings it produced, for the failure report. Empty for a passing good example. */
  findings: Finding[]
}

export interface ExampleResult {
  rule: string
  outcomes: ExampleOutcome[]
  /** Of the bad examples, how many produced a finding. */
  recall: { matched: number; total: number }
  /** Of every example that produced a finding, how many were bad ones. */
  precision: { correct: number; total: number }
  /** The rule declared no examples. */
  missing: boolean
  /** Skipped because it is an llm rule and no rule id was named (Decision 4). */
  skipped: boolean
}

export async function runExamples(input: {
  rule: CompiledRule
  registry: DetectorRegistry
  stateDir: string
  settings: DetectorSettings
  timeoutMs: number
}): Promise<ExampleResult>
```

- [ ] Materialise into `fs.mkdtemp` under `os.tmpdir()`, one directory per rule, with a minimal `.rulecast-config.yaml` holding just that rule as a `repo: local` entry. Remove it in a `finally`, including when a detector threw.
- [ ] Run one example per pipeline invocation, not all of them at once: a `bad` example must be attributable, and batching them into one run would let a finding in example 1 mask a miss in example 3.
- [ ] Precision and recall are counted over the example set exactly as defined above. With a handful of examples these are crude; they are the numbers the author is trying to move, and `--against` is where volume is measured.
- [ ] Tests, one per detector kind so the "every detector works" claim is real: a `regex` rule with one good and one bad example; a `path` rule; an `ast-grep` rule; a `command` rule (a stub script in the fixture's `node_modules/.bin`); a `linter` rule using oxlint, which is a real devDependency (§15). No `llm` test calls a model — use the stub agent CLI from `test/helpers/llm.ts`.
- [ ] Tests for the failure paths: a bad example that produces nothing is `passed: false` with empty findings; a good example that produces a finding is `passed: false` and carries the finding so the report can print the line; a detector that errors surfaces as a failure with its message, not as a thrown exception; the temporary directory is gone afterwards.
- [ ] Verify: `pnpm vitest run test/core/examples.test.ts` → passes.
- [ ] Commit.

## Task 3: the `test` command

**Files:** create `src/commands/test.ts` · modify `src/commands/main.ts` · modify `src/commands/usage.ts` · test `test/commands/test.test.ts` · test `test/commands/help.test.ts`

**Behaviour:** `rulecast test [RULE_ID]` runs the examples of every rule in the project, or of one rule. Exit 0 when every example passed, 1 when any failed, 2 when rulecast itself failed. Rules with no examples are listed at the end as a reminder, and do not fail the run.

```
rulecast test

  python/no-httpexception-in-services   4/4   P 1.00  R 1.00
  python/thin-routes                    5/6   P 0.83  R 1.00
      good[1] app/api/routes/users.py — fired at line 3
        async def list_users(service: UserService) -> list[User]:
  react/no-inline-style                 skipped (llm; name the rule to run it)

  no examples: generated-code, python/layering

  1 of 3 rules failed
```

- [ ] Parse `[RULE_ID]`; an unknown id is a `UsageError` naming `rulecast validate`, matching `run`.
- [ ] Bare `rulecast test` skips `llm` rules with the `skipped` line; a named `llm` rule runs (Decision 4).
- [ ] A failing good example prints the example index, the path, the line it fired at and that line's source. A failing bad example prints the index and the path and `no finding`. That is the whole failure report — an author needs the site, not a diff.
- [ ] `usage.ts` gains a `test` block: `rulecast test [RULE_ID]   run each rule's inline examples`.
- [ ] Tests, against a fixture project: all-pass exits 0; one failing good example exits 1 and names it; one failing bad example exits 1 and names it; a project with no examples at all exits 0 and lists the rules; a named rule runs only that rule; an unknown rule id exits 2; `llm` skipping and naming.
- [ ] Verify: `pnpm vitest run test/commands/test.test.ts test/commands/help.test.ts` → passes.
- [ ] Commit.

## Task 4: `--against`, the volume check

**Files:** modify `src/commands/test.ts` · test `test/commands/test.test.ts`

**Behaviour:** `rulecast test RULE_ID --against <path…>` runs the rule over real repository files and reports how many violations it would produce and how they are spread, so an author sees a rule that nobody breaks and a rule that everybody breaks before enabling either. It exits 0 whatever it finds.

```
rulecast test react/no-inline-style --against frontend/src

  131 violations in 40 of 212 matching files

  frontend/src/components/Table.tsx          14
  frontend/src/components/Form.tsx           11
  …and 38 more files

  A rule this common is usually true by definition rather than a convention.
  A rule with almost no violations is usually not worth an agent's context.
```

- [ ] `--against` takes one or more paths, defaulting to the whole repository when given with no value is not possible — require at least one path, as `--files` does.
- [ ] Reuse `selectFiles`-style resolution from `src/commands/run.ts`: a directory expands to the files under it that the rule's filters match. Report `matching files` as the denominator, not every file walked — a rule scoped to `routes/` is not diluted by the rest of the repository.
- [ ] Print the two closing sentences verbatim, both of them, always. They are the two failure modes and an author reading one number needs to know which end they are near. Do not compute a verdict: there is no threshold that is right for every rule (Decision 6).
- [ ] `--against` requires a `RULE_ID`; without one it is a `UsageError`.
- [ ] Tests: a fixture with a rule firing in 3 of 10 matching files reports `3` and `10`; a rule firing nowhere reports `0` and still exits 0; `--against` with no rule id exits 2; a path outside the project exits 2 with the message `run` gives.
- [ ] Verify: `pnpm vitest run test/commands/test.test.ts` → passes.
- [ ] Commit.

## Task 5: examples for the catalog

**Files:** modify `packages/rules-general/rules.yaml` · modify `packages/rules-python/rules.yaml` · modify `packages/rules-react/rules.yaml` · modify `packages/rulecast/scripts/generate-manifest.ts` · regenerate `.rulecast-rules.yaml` · test `test/catalog.test.ts`

**Behaviour:** Every catalog rule with a `detect` carries at least one good and one bad example, they pass, and they ship in the generated manifest. This is the first real use of the feature and the first chance for it to find something.

- [ ] `generate-manifest.ts` carries `examples` through. Check the staleness test still passes after regenerating.
- [ ] Add examples rule by rule. Where an example fails, **the rule is wrong, not the example** — investigate before adjusting either, and record what was found in the commit message. Plans 5 and 6 each turned up real defects this way.
- [ ] `test/catalog.test.ts` runs `runExamples` over every rule in every `packages/rules-*/rules.yaml` and asserts every outcome passed, and that every rule with a `detect` has at least one of each. This is the regression net: a catalog rule whose pattern is tightened later cannot silently stop matching.
- [ ] Verify: `pnpm manifest` → `.rulecast-rules.yaml` regenerated, staleness test green; `pnpm vitest run test/catalog.test.ts` → passes; `pnpm test` → passes.
- [ ] Commit.

## Task 6: teach the drafting flow to measure

**Files:** modify `agents/DRAFT-RULES.md` · modify `agents/reference/rule-format.md` · modify `docs/specs/2026-09-15-rulecast-design.md:207-260,656-696,772-788,829-836`

**Behaviour:** The drafting prompt stops asking an agent to decide a rule's tier up front and starts asking it to try, measure and fall back. This is the finding with the widest reach in this plan: tier membership depends on the wording, so no catalog and no prompt can fix it once.

- [ ] `agents/DRAFT-RULES.md`: replace whatever tells the agent to pick a detector with the loop — draft the convention's wording; write two good and two bad examples from real code in the repository; attempt a `regex` or `ast-grep` pattern; run `rulecast test <id>`; if an example fails, revise the pattern once; if it still fails, move the rule to `llm` and say in the rule's `description` that a pattern was tried. Then `rulecast test <id> --against <the directory it is scoped to>` and report both numbers to the user before writing the rule into the config.
- [ ] Say why, in one line the agent can act on: the same convention scored P 0.99 under one wording and P 0.70 under a stricter one, so the tier is a property of the sentence, not of the convention.
- [ ] `agents/reference/rule-format.md`: the `examples` key, with the `path` requirement and the at-least-one-finding semantics.
- [ ] Spec §4: `examples` in the rule keys. §12: the `test` command in the CLI table. §15: `test/catalog.test.ts` in the testing list, and a line stating that `rulecast test` in `pnpm test` never reaches a model. §17: move *"rule tests (inline good/bad examples run by `rulecast test`)"* from the 0.2 scope row to done, and add the κ measurement as an explicitly deferred piece with the reason (money, not hermetic).
- [ ] Verify: `pnpm test` → passes, including the agent-doc link check.
- [ ] Commit.

---

## End-to-end verification

1. `pnpm test` → no failures. `pnpm typecheck` → clean. `pnpm test:linux` → passes.
2. `pnpm rulecast test` from the repository root over the catalog fixture → every rule passes, exit 0.
3. Break one catalog pattern deliberately → `rulecast test` exits 1 and names the example and the line. Restore it.
4. `rulecast test react/no-inline-style --against frontend/src` in a React repository → a violation count, a file spread and the two sentences, exit 0.
5. Draft one new rule end to end by following `agents/DRAFT-RULES.md` as written, with no help from this plan, and confirm the flow produces a rule with passing examples and a reported `--against` number. If the document cannot be followed, fix the document.
