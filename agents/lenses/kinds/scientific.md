<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Scientific computing: where to start

Whether results can be trusted and reproduced, which decides how constants, units, inputs and tests of the numerics are handled.

Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.

Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](../AXES.md).

`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.

## Look at these first, in order

1. [`long-method`](../entries/long-method.md) **Long Method** · smell/code [CATE] (delivery+ change_cost−) {data-pipeline,scientific,ml-training,compilers-tooling,tui}: A function has grown long enough that you have to read all of it to understand any of it. → `comments` `large-class` `kiss` `duplicate-code`
2. [`magic-number`](../entries/magic-number.md) **Magic number** · anti-pattern/code [TE] (change_cost−) {embedded,scientific,games,ml-training}: A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand. → `primitive-obsession` `principle-of-least-astonishment`
3. [`global-state`](../entries/global-state.md) **Global state** · anti-pattern/design [ATE] (delivery+ reliability− change_cost−) {web-api,serverless,web-frontend,ml-training,games,embedded,tui,plugin-host} langs:py,go: Mutable data reachable from anywhere, as global variables, module-level state or singletons, so any code can change it and no caller's behaviour depends only on what it was given. → `singleton` `law-of-demeter`
4. [`assertion-free-test`](../entries/assertion-free-test.md) **Assertion-Free Test** · anti-pattern/testing [AE] (delivery+ reliability− change_cost−) {data-pipeline,ml-training,scientific}: A test runs the code but asserts nothing meaningful, so it passes as long as nothing throws. Meszaros's nearest names are Neverfail Test and Manual Result Verification; also called the "secret catcher" or a smoke-only test. → `mock-everything` `manual-intervention` `conditional-test-logic`
5. [`long-parameter-list`](../entries/long-parameter-list.md) **Long Parameter List** · smell/code [ATE] (delivery+ change_cost− reliability−) {scientific,ml-training,library-sdk} langs:py: A function takes so many parameters that calls are hard to read and easy to get wrong. → `data-clumps` `primitive-obsession` `builder`
6. [`data-clumps`](../entries/data-clumps.md) **Data Clumps** · smell/code [TE] (delivery+ change_cost− reliability−) {scientific,games}: The same few values travel together through fields and parameter lists in several places, which says they are one concept that has no name yet. → `long-parameter-list` `primitive-obsession`
7. [`value-object`](../entries/value-object.md) **Value Object** · pattern/design [E] (reliability⊕ change_cost+ delivery−) {web-api,fullstack-web,library-sdk,scientific,data-pipeline} langs:py,ts,java,cs,go,rs: A small immutable object defined only by its attributes, with no identity, that carries the meaning and rules of a domain value such as an amount with its currency, a date range or a dose with its unit. → `primitive-obsession` `entity` `data-clumps` `over-engineering`
8. [`primitive-obsession`](../entries/primitive-obsession.md) **Primitive Obsession** · smell/code [ATE] (delivery+ change_cost− reliability− security−) {web-api,platforms,fullstack-web,databases-storage} langs:py,ts,rs,go: Domain concepts such as money, ranges, ids, phone numbers and statuses are passed around as bare strings and numbers, so their rules are repeated wherever they are used. → `data-clumps` `long-parameter-list` `switch-statements` `lazy-class`
9. [`duplicate-code`](../entries/duplicate-code.md) **Duplicate Code** · smell/code [ATE] (delivery+ change_cost− reliability−) {iac,data-pipeline,scientific,web-frontend}: The same logic appears in more than one place, so every fix or change has to be made in each copy and the copies drift. Fowler calls it Duplicated Code. → `dry` `wrong-abstraction` `alternative-classes-with-different-interfaces` `shotgun-surgery`
10. [`lava-flow`](../entries/lava-flow.md) **Lava flow** · anti-pattern/code [ATE] (change_cost−) {ml-training,scientific,data-pipeline}: Dead or half-finished code from earlier experiments hardens into the codebase because nobody knows whether it is still needed and nobody dares remove it. → `dead-code` `boat-anchor` `technical-debt` `cargo-cult-programming`
11. [`property-based-test`](../entries/property-based-test.md) **Property-Based Test** · practice/testing [E] (reliability⊕ delivery−) {compilers-tooling,library-sdk,databases-storage,scientific,data-pipeline} langs:py,ts,java,cs,go,rs: Instead of a few hand-picked examples, state a rule that must hold for every input (the output is sorted, decoding undoes encoding, the parts add up to the total), let a library generate many inputs, and when one fails, let it shrink that input to the smallest case that still fails. → `golden-master-test` `test-data-builder` `parse-dont-validate`
12. [`golden-master-test`](../entries/golden-master-test.md) **Golden Master Test (approval, snapshot or golden-file test)** · pattern/testing [E] (change_cost⊕ delivery+ reliability−) {compilers-tooling,cli-devtool,tui,library-sdk} langs:py,ts,java,cs,go,rs: Capture the whole output of the code once, have a person check and approve it, store it, and fail the test whenever later output differs. It is the right tool when the output itself is the contract, as with renderers, formatters, compilers, CLI text and serialisers. → `fragile-test` `obscure-test` `erratic-test` `property-based-test`
13. [`validate-at-the-boundary`](../entries/validate-at-the-boundary.md) **Validate at the boundary** · practice/security [E] (security⊕ reliability⊕ change_cost+ delivery−) {web-api,cli-devtool,data-pipeline,library-sdk,plugin-host,event-driven} langs:py,ts,java,cs,go,rs: Check data where it enters from a less trusted place (a request, a file, a queue, a CLI argument, a third-party API), against an allow-list of what is acceptable, and reject the rest there, so the code inside can rely on what it receives. → `parse-dont-validate` `trusting-client-input` `injection` `postels-law` `primitive-obsession` `defense-in-depth`
14. [`reinventing-the-wheel`](../entries/reinventing-the-wheel.md) **Reinventing the wheel** · anti-pattern/design [CAE] (security− reliability− change_cost−) {web-api,fullstack-web,scientific}: Writing your own version of something that a standard library, a mature package or the codebase itself already does well, usually with fewer edge cases handled. → `golden-hammer` `copy-and-paste-programming` `duplicate-code`
15. [`premature-optimization`](../entries/premature-optimization.md) **Premature Optimization** · principle/planning [CE] (change_cost⊕ delivery+) {games,embedded,scientific,databases-storage}: Don't make code faster before you know it is a bottleneck; write it clearly, measure, then optimise the hot spots. Also called Knuth's optimization principle. → `pareto-principle` `yagni`
16. [`amdahls-law`](../entries/amdahls-law.md) **Amdahl's Law** · law/scale [E] (bears on runtime) {distributed,data-pipeline,scientific,ml-training,databases-storage}: The part of the work that has to run in sequence caps how much faster you can get by adding parallel workers. → `gustafsons-law`
17. [`gustafsons-law`](../entries/gustafsons-law.md) **Gustafson's Law** · law/scale [E] (bears on runtime) {distributed,data-pipeline,scientific,ml-training}: If the problem grows with the hardware, parallel speedup can stay close to linear, because the serial part stays roughly fixed while the parallel part grows. → `amdahls-law`
18. [`spaghetti-code`](../entries/spaghetti-code.md) **Spaghetti code** · anti-pattern/code [E] (delivery+ change_cost−) {scientific,embedded,games}: Control flow is so tangled, with jumps, flags and deep nesting, that you can't follow what happens without tracing it by hand. → `long-method` `big-ball-of-mud` `kiss`
19. [`strategy`](../entries/strategy.md) **Strategy** · pattern/behavioral [TE] (change_cost⊕ delivery−) {library-sdk,scientific,ml-training} langs:py,ts,java,cs,go,rs,cpp: Put each variant of an algorithm behind one interface and let the caller plug in the one it wants; also called Policy. → `state` `template-method` `command` `decorator` `bridge`
20. [`immutability-by-default`](../entries/immutability-by-default.md) **Immutability by Default** · practice/design [E] (reliability⊕ change_cost+ runtime−) {web-frontend,fullstack-web,distributed,library-sdk,data-pipeline} langs:py,ts,java,cs,go,rs: Make values, records and collections unchangeable unless there is a reason for them to change, and produce a modified copy instead of editing in place. Mutation is then rare and visible, so shared data can't be changed behind a reader's back. → `global-state` `functional-core-imperative-shell` `make-illegal-states-unrepresentable` `command-query-separation`
21. [`functional-core-imperative-shell`](../entries/functional-core-imperative-shell.md) **Functional Core, Imperative Shell** · practice/design [E] (change_cost⊕ delivery−) {cli-devtool,tui,games,web-api,data-pipeline,event-driven} langs:py,ts,java,cs,go,rs: Put the decisions in pure functions that take values and return values, and keep a thin outer layer that reads input, calls the core, and carries out the effects it returns. The core is tested with plain values and no doubles; the shell is kept simple enough to need only a few integration tests. → `hard-to-test-code` `mock-everything` `global-state` `command-query-separation` `immutability-by-default` `parse-dont-validate`
22. [`fail-fast`](../entries/fail-fast.md) **Fail Fast** · principle/design [E] (reliability⊕ operability+) {cli-devtool,web-api,data-pipeline,library-sdk,serverless} langs:py,java,cs,go,rs,ts: Detect a bad state as early as possible and stop right there with a clear error, instead of carrying on and failing later in a place that hides the cause. → `swallowed-errors` `error-handling-policy` `fail-open-vs-fail-closed` `murphys-law`
23. [`swallowed-errors`](../entries/swallowed-errors.md) **Swallowed Errors** · anti-pattern/code [ATE] (delivery+ reliability− operability−) {data-pipeline,cli-devtool,web-api,library-sdk,distributed,plugin-host} langs:py,ts,java,cs,go,rs: An error is caught or returned and then dropped, so the failure goes on silently and shows up later, somewhere else, as wrong data or a confusing symptom. → `fail-fast` `error-handling-policy` `fail-open-vs-fail-closed` `exceptions-for-control-flow` `murphys-law`

## Probes for the interview

Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).

### 1. Confirmation bias

**Find:** Tests against known analytic cases, comparisons with another implementation or published values, convergence checks, seed handling, and scripts or notes that validate results.

**Ask:** "Results are checked against <X / nothing I could find>. When a result looks right, what do you check before you believe it? I'd add <an analytic case for Y> because <a plausible-looking result is the easiest one to trust wrongly>."

**Settled when:** A validation suite against known cases runs regularly. The agent confirms it.

### 2. Developers Not Writing Tests

**Find:** Which numerical routines have tests, and which are only exercised by scripts that produce plots.

**Ask:** "<routines> have tests; <routines> are only checked by plots. I'd test <the riskiest one> first, against <a known case>, because <reason>. Agree?"

**Settled when:** All numerical code is tested. The agent confirms it and asks only about new code.

### 3. Bus factor

**Find:** An analysis of whether someone else could rerun the analysis from scratch: environment pinning (lockfile, container), where input data comes from and whether it's versioned, one entry point (a Makefile or workflow file), seeds, hard-coded paths, and manual steps in the README.

**Ask:** "Rerunning from scratch would need <missing pieces: an unpinned environment, data at a local path, a manual step>. I'd fix <X> first because <reason>. Anything else only you know?"

**Settled when:** A pinned environment and one command reproduce the results. The agent confirms it.

### 4. Not Invented Here

**Find:** Routines written by hand that a standard library provides (linear algebra, integrators, statistics), with any comment or commit saying why.

**Ask:** "<routines> do what <library> does. I'd switch because <reason>. Is there a reason to keep them, such as matching a published method exactly?"

**Settled when:** A reason is recorded that still holds. The agent cites it.

### 5. YAGNI

**Find:** Signals of how long the code is meant to live: packaging, version tags, tests, a citation file, other projects that depend on it, and how the history clusters around deadlines.

**Ask:** "This has <signals>. Is it code for one paper, or meant to be maintained and reused? I'd <recommend a light or a full set of conventions> because <reason>."

**Settled when:** The signals are unambiguous (a released package with dependents). The agent confirms it.

## Also relevant

- [`pareto-principle`](../entries/pareto-principle.md) **Pareto Principle** · law/decisions (bears on runtime, reliability) {games,scientific}: A small share of causes produces most of the effect, so find the vital few (hot code, crashing bugs, used features) and spend effort there. Also called the 80/20 rule. → `premature-optimization`
