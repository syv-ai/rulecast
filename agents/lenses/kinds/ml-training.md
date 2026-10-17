<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Machine-learning training: where to start

Whether a run can be reproduced from its config alone, which decides how hyperparameters, seeds and shared state are handled.

Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.

Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](../AXES.md).

`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.

## Look at these first, in order

1. [`global-state`](../entries/global-state.md) **Global state** · anti-pattern/design [ATE] (delivery+ reliability− change_cost−) {web-api,serverless,web-frontend,ml-training,games,embedded,tui,plugin-host} langs:py,go: Mutable data reachable from anywhere, as global variables, module-level state or singletons, so any code can change it and no caller's behaviour depends only on what it was given. → `singleton` `law-of-demeter`
2. [`magic-number`](../entries/magic-number.md) **Magic number** · anti-pattern/code [TE] (change_cost−) {embedded,scientific,games,ml-training}: A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand. → `primitive-obsession` `principle-of-least-astonishment`
3. [`long-method`](../entries/long-method.md) **Long Method** · smell/code [CATE] (delivery+ change_cost−) {data-pipeline,scientific,ml-training,compilers-tooling,tui}: A function has grown long enough that you have to read all of it to understand any of it. → `comments` `large-class` `kiss` `duplicate-code`
4. [`long-parameter-list`](../entries/long-parameter-list.md) **Long Parameter List** · smell/code [ATE] (delivery+ change_cost− reliability−) {scientific,ml-training,library-sdk} langs:py: A function takes so many parameters that calls are hard to read and easy to get wrong. → `data-clumps` `primitive-obsession` `builder`
5. [`copy-and-paste-programming`](../entries/copy-and-paste-programming.md) **Copy-and-paste programming** · anti-pattern/code [ATE] (delivery+ change_cost− reliability−) {iac,data-pipeline,ml-training,web-frontend}: Code is reused by copying it and tweaking the copy, so the same logic lives in several places and a fix in one misses the others. Brown et al. call it Cut-and-Paste Programming; Duplicate Code is the smell. → `dry` `duplicate-code` `shotgun-surgery` `wrong-abstraction` `reinventing-the-wheel`
6. [`lava-flow`](../entries/lava-flow.md) **Lava flow** · anti-pattern/code [ATE] (change_cost−) {ml-training,scientific,data-pipeline}: Dead or half-finished code from earlier experiments hardens into the codebase because nobody knows whether it is still needed and nobody dares remove it. → `dead-code` `boat-anchor` `technical-debt` `cargo-cult-programming`
7. [`assertion-free-test`](../entries/assertion-free-test.md) **Assertion-Free Test** · anti-pattern/testing [AE] (delivery+ reliability− change_cost−) {data-pipeline,ml-training,scientific}: A test runs the code but asserts nothing meaningful, so it passes as long as nothing throws. Meszaros's nearest names are Neverfail Test and Manual Result Verification; also called the "secret catcher" or a smoke-only test. → `mock-everything` `manual-intervention` `conditional-test-logic`
8. [`cargo-cult-programming`](../entries/cargo-cult-programming.md) **Cargo cult programming** · anti-pattern/code [AE] (delivery+ change_cost− operability−) {iac,ml-training,serverless}: Code, rituals or structure are copied because they appeared in working code, without understanding what they do or whether they apply here. → `dogma-over-pragma` `copy-and-paste-programming` `lava-flow`
9. [`swallowed-errors`](../entries/swallowed-errors.md) **Swallowed Errors** · anti-pattern/code [ATE] (delivery+ reliability− operability−) {data-pipeline,cli-devtool,web-api,library-sdk,distributed,plugin-host} langs:py,ts,java,cs,go,rs: An error is caught or returned and then dropped, so the failure goes on silently and shows up later, somewhere else, as wrong data or a confusing symptom. → `fail-fast` `error-handling-policy` `fail-open-vs-fail-closed` `exceptions-for-control-flow` `murphys-law`
10. [`fail-fast`](../entries/fail-fast.md) **Fail Fast** · principle/design [E] (reliability⊕ operability+) {cli-devtool,web-api,data-pipeline,library-sdk,serverless} langs:py,java,cs,go,rs,ts: Detect a bad state as early as possible and stop right there with a clear error, instead of carrying on and failing later in a place that hides the cause. → `swallowed-errors` `error-handling-policy` `fail-open-vs-fail-closed` `murphys-law`
11. [`validate-at-the-boundary`](../entries/validate-at-the-boundary.md) **Validate at the boundary** · practice/security [E] (security⊕ reliability⊕ change_cost+ delivery−) {web-api,cli-devtool,data-pipeline,library-sdk,plugin-host,event-driven} langs:py,ts,java,cs,go,rs: Check data where it enters from a less trusted place (a request, a file, a queue, a CLI argument, a third-party API), against an allow-list of what is acceptable, and reject the rest there, so the code inside can rely on what it receives. → `parse-dont-validate` `trusting-client-input` `injection` `postels-law` `primitive-obsession` `defense-in-depth`
12. [`insecure-deserialization`](../entries/insecure-deserialization.md) **Insecure deserialization** · anti-pattern/security [TE] (delivery+ security−) {distributed,event-driven,ml-training,plugin-host,web-api} langs:py,ts,java,cs,go,rs: Data from outside is decoded with a format that can choose which classes to build or which code to run (pickle, Java serialization, BinaryFormatter, polymorphic JSON with type names), so crafted input can run code or build objects the program never meant to. → `validate-at-the-boundary` `trusting-client-input` `defense-in-depth`
13. [`hard-coded-secrets`](../entries/hard-coded-secrets.md) **Hard-coded secrets** · anti-pattern/security [ATE] (delivery+ security− operability−) {iac,serverless,data-pipeline,ml-training,web-api} langs:ts,java,cs,py: Passwords, API keys, tokens or private keys are written into source code, checked-in config or build files, where everyone with the repository, the image or the bundle can read them. → `magic-number` `sensitive-data-in-logs` `least-privilege` `secure-by-default`
14. [`strategy`](../entries/strategy.md) **Strategy** · pattern/behavioral [TE] (change_cost⊕ delivery−) {library-sdk,scientific,ml-training} langs:py,ts,java,cs,go,rs,cpp: Put each variant of an algorithm behind one interface and let the caller plug in the one it wants; also called Policy. → `state` `template-method` `command` `decorator` `bridge`
15. [`pipes-and-filters`](../entries/pipes-and-filters.md) **Pipes and Filters** · pattern/architecture [E] (change_cost⊕ runtime+ reliability−) {data-pipeline,cli-devtool,compilers-tooling,ml-training,event-driven} langs:py,ts,java,cs,go,rs: Break processing into a chain of independent steps (filters), each taking input and producing output, joined by pipes that carry data from one to the next and hold no logic of their own. → `chain-of-responsibility` `decorator` `functional-decomposition`
16. [`functional-core-imperative-shell`](../entries/functional-core-imperative-shell.md) **Functional Core, Imperative Shell** · practice/design [E] (change_cost⊕ delivery−) {cli-devtool,tui,games,web-api,data-pipeline,event-driven} langs:py,ts,java,cs,go,rs: Put the decisions in pure functions that take values and return values, and keep a thin outer layer that reads input, calls the core, and carries out the effects it returns. The core is tested with plain values and no doubles; the shell is kept simple enough to need only a few integration tests. → `hard-to-test-code` `mock-everything` `global-state` `command-query-separation` `immutability-by-default` `parse-dont-validate`
17. [`immutability-by-default`](../entries/immutability-by-default.md) **Immutability by Default** · practice/design [E] (reliability⊕ change_cost+ runtime−) {web-frontend,fullstack-web,distributed,library-sdk,data-pipeline} langs:py,ts,java,cs,go,rs: Make values, records and collections unchangeable unless there is a reason for them to change, and produce a modified copy instead of editing in place. Mutation is then rare and visible, so shared data can't be changed behind a reader's back. → `global-state` `functional-core-imperative-shell` `make-illegal-states-unrepresentable` `command-query-separation`
18. [`slow-tests`](../entries/slow-tests.md) **Slow Tests** · smell/testing [TE] (change_cost− delivery−) {fullstack-web,databases-storage,data-pipeline,ml-training}: The tests take so long that people stop running them on every change. Causes include Slow Component Usage (usually the database), a General Fixture, Asynchronous Test and Too Many Tests. → `erratic-test` `frequent-debugging` `hard-to-test-code`
19. [`property-based-test`](../entries/property-based-test.md) **Property-Based Test** · practice/testing [E] (reliability⊕ delivery−) {compilers-tooling,library-sdk,databases-storage,scientific,data-pipeline} langs:py,ts,java,cs,go,rs: Instead of a few hand-picked examples, state a rule that must hold for every input (the output is sorted, decoding undoes encoding, the parts add up to the total), let a library generate many inputs, and when one fails, let it shrink that input to the smallest case that still fails. → `golden-master-test` `test-data-builder` `parse-dont-validate`
20. [`golden-master-test`](../entries/golden-master-test.md) **Golden Master Test (approval, snapshot or golden-file test)** · pattern/testing [E] (change_cost⊕ delivery+ reliability−) {compilers-tooling,cli-devtool,tui,library-sdk} langs:py,ts,java,cs,go,rs: Capture the whole output of the code once, have a person check and approve it, store it, and fail the test whenever later output differs. It is the right tool when the output itself is the contract, as with renderers, formatters, compilers, CLI text and serialisers. → `fragile-test` `obscure-test` `erratic-test` `property-based-test`
21. [`amdahls-law`](../entries/amdahls-law.md) **Amdahl's Law** · law/scale [E] (bears on runtime) {distributed,data-pipeline,scientific,ml-training,databases-storage}: The part of the work that has to run in sequence caps how much faster you can get by adding parallel workers. → `gustafsons-law`
22. [`premature-optimization`](../entries/premature-optimization.md) **Premature Optimization** · principle/planning [CE] (change_cost⊕ delivery+) {games,embedded,scientific,databases-storage}: Don't make code faster before you know it is a bottleneck; write it clearly, measure, then optimise the hot spots. Also called Knuth's optimization principle. → `pareto-principle` `yagni`

## Probes for the interview

Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).

### 1. Goodhart's law, Confirmation bias

**Find:** Which metric is logged and reported, on which split, and how the splits are made. Whether early stopping, hyperparameter search or model selection read the same split the result is reported on. An analysis of how code could raise the metric without improving the goal.

**Ask:** "You report <metric> on <split>, and <early stopping / tuning> also reads <split>, so <consequence>. I'd <keep a split nothing tunes on> because <reason>. Is <metric> the goal, or a stand-in for <X>?"

**Settled when:** Selection and reporting already use separate splits and a doc says what the metric stands for. The agent confirms it.

### 2. Confirmation bias

**Find:** Seed handling and whether configs or scripts run several seeds, held-out or test sets, leakage checks between splits (duplicates, the same entity in both), and notes or experiment logs in the repo about how results were judged.

**Ask:** "Runs use <one seed / N seeds>, and there's <no / a> leakage check between <splits>. When a run beats the baseline, what else do you check? I'd make <N seeds and a held-out set> the bar for calling it a result, because <reason>."

**Settled when:** A documented evaluation protocol exists and the scripts follow it. The agent confirms it.

### 3. Developers Not Writing Tests

**Find:** Tests for data loading, preprocessing, metrics and tensor shapes, and what has none. Whether metrics are tested against hand-computed values.

**Ask:** "<parts> are tested; <metrics / loading> aren't. I'd test <metric code and data loading> first, because a bug there changes every number you report. Agree?"

**Settled when:** Loading, metrics and shapes are already tested. The agent confirms it and asks only about new code.

### 4. The Hype Cycle & Amara's Law

**Find:** Dependencies added in the last year or so (manifest and lockfile history), and recently added training code such as a new optimiser, scheduler, mixed precision, distributed or parameter-efficient training. For each, whether code calls it directly everywhere or through a thin wrapper, and how many files would change if it were swapped.

**Ask:** "<lib> came in <when> and is called directly in <N> places. Do you expect to swap it? I'd <wrap it / follow its idiom> because <reason>."

**Settled when:** Never by code alone: whether a library is expected to stay is the developer's judgement.

### 5. YAGNI

**Find:** The directory layout (notebooks, experiments, a package), what packaging or serving code imports, and what nothing imports.

**Ask:** "<package dir> is imported by <serving / packaging>; <experiments dir> isn't. Is that the line between code that ships and code that gets thrown away? I'd hold <package dir> to the conventions and leave <experiments> free, because <reason>."

**Settled when:** Packaging config and a doc already draw the line. The agent confirms it.

## Also relevant

- [`gustafsons-law`](../entries/gustafsons-law.md) **Gustafson's Law** · law/scale [E] (bears on runtime) {distributed,data-pipeline,scientific,ml-training}: If the problem grows with the hardware, parallel speedup can stay close to linear, because the serial part stays roughly fixed while the parallel part grows. → `amdahls-law`
