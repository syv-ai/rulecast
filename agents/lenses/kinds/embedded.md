<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Embedded and firmware: where to start

How hardware access and shared state are fenced off, so the logic can be tested off-target and fails safe on it.

Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.

Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](../AXES.md).

`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.

## Look at these first, in order

1. [`global-state`](../entries/global-state.md) **Global state** · anti-pattern/design [ATE] (delivery+ reliability− change_cost−) {web-api,serverless,web-frontend,ml-training,games,embedded,tui,plugin-host} langs:py,go: Mutable data reachable from anywhere, as global variables, module-level state or singletons, so any code can change it and no caller's behaviour depends only on what it was given. → `singleton` `law-of-demeter`
2. [`magic-number`](../entries/magic-number.md) **Magic number** · anti-pattern/code [TE] (change_cost−) {embedded,scientific,games,ml-training}: A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand. → `primitive-obsession` `principle-of-least-astonishment`
3. [`resource-leak`](../entries/resource-leak.md) **Resource Leak** · anti-pattern/code [TE] (delivery+ reliability− runtime−) {web-api,distributed,databases-storage,tui,desktop,embedded} langs:go,rs,py,java,cs,ts: Something acquired, such as a file, socket, connection, response body, lock, goroutine or background task, is not released on every path, especially the error path, so the process slowly runs out of it. → `swallowed-errors` `murphys-law` `init-time-side-effects`
4. [`hard-to-test-code`](../entries/hard-to-test-code.md) **Hard-to-Test Code** · smell/testing [E] (delivery+ change_cost− reliability−) {embedded,games,desktop,mobile,serverless,event-driven,tui}: The code resists being tested in isolation because it is tightly coupled, asynchronous, hides what a test needs to reach, or can't be constructed without half the system. → `singleton` `test-logic-in-production` `mock-everything` `fragile-test`
5. [`state`](../entries/state.md) **State** · pattern/behavioral [TE] (change_cost⊕ reliability+ delivery−) {embedded,games,mobile,web-frontend,event-driven,tui} langs:py,ts,java,cs,go,rs,cpp: Move each state's behaviour into its own object and let the owner swap which one it delegates to, so it acts as if it changed class. → `strategy` `bridge` `adapter`
6. [`premature-optimization`](../entries/premature-optimization.md) **Premature Optimization** · principle/planning [CE] (change_cost⊕ delivery+) {games,embedded,scientific,databases-storage}: Don't make code faster before you know it is a bottleneck; write it clearly, measure, then optimise the hot spots. Also called Knuth's optimization principle. → `pareto-principle` `yagni`
7. [`murphys-law`](../entries/murphys-law.md) **Murphy's Law** · law/quality [E] (bears on reliability) {embedded,data-pipeline,event-driven,mobile}: Anything that can go wrong eventually will, so handle the failure cases instead of assuming them away. Also called Sod's Law. → `law-of-unintended-consequences` `postels-law`
8. [`infrastructure-ignorance`](../entries/infrastructure-ignorance.md) **Infrastructure Ignorance** · anti-pattern/architecture (delivery+ reliability− change_cost− runtime− operability−) {embedded,distributed,serverless,mobile}: Designing and building without regard for the environment the system will actually run in (hardware, network, power, security, legal constraints), so it fails requirements in ways that are hard to fix later. → `fallacies-of-distributed-computing` `distributed-monolith` `over-modularization`
9. [`fail-fast`](../entries/fail-fast.md) **Fail Fast** · principle/design [E] (reliability⊕ operability+) {cli-devtool,web-api,data-pipeline,library-sdk,serverless} langs:py,java,cs,go,rs,ts: Detect a bad state as early as possible and stop right there with a clear error, instead of carrying on and failing later in a place that hides the cause. → `swallowed-errors` `error-handling-policy` `fail-open-vs-fail-closed` `murphys-law`
10. [`fail-open-vs-fail-closed`](../entries/fail-open-vs-fail-closed.md) **Fail Open vs Fail Closed** · practice/design [E] (security⊕ reliability⊕ delivery−) {cli-devtool,plugin-host,plugins-extensions,web-api,distributed,platforms} langs:go,py,ts: For each place where a check or a dependency can fail, decide on purpose whether failure lets things through (fail open) or stops them (fail closed), and make the code do that; the anti-pattern is leaving it to whatever the error path happens to do. → `fail-fast` `swallowed-errors` `error-handling-policy` `postels-law` `murphys-law`
11. [`manual-intervention`](../entries/manual-intervention.md) **Manual Intervention** · smell/testing [TE] (change_cost− reliability−) {embedded,mobile,desktop,games,iac}: A test needs a person to do something each run, whether setting up the environment, injecting an event or checking the result by eye. → `assertion-free-test` `slow-tests`
12. [`singleton`](../entries/singleton.md) **Singleton** · pattern/creational [CTE] (reliability⊕ runtime+ change_cost−) {mobile,games,embedded,desktop,serverless} langs:py,ts,java,cs,go,rs,cpp: A class allows only one instance of itself and hands out a global way to reach it. → `facade` `flyweight` `abstract-factory` `builder` `prototype` `global-state`
13. [`spaghetti-code`](../entries/spaghetti-code.md) **Spaghetti code** · anti-pattern/code [E] (delivery+ change_cost−) {scientific,embedded,games}: Control flow is so tangled, with jumps, flags and deep nesting, that you can't follow what happens without tracing it by hand. → `long-method` `big-ball-of-mud` `kiss`
14. [`functional-core-imperative-shell`](../entries/functional-core-imperative-shell.md) **Functional Core, Imperative Shell** · practice/design [E] (change_cost⊕ delivery−) {cli-devtool,tui,games,web-api,data-pipeline,event-driven} langs:py,ts,java,cs,go,rs: Put the decisions in pure functions that take values and return values, and keep a thin outer layer that reads input, calls the core, and carries out the effects it returns. The core is tested with plain values and no doubles; the shell is kept simple enough to need only a few integration tests. → `hard-to-test-code` `mock-everything` `global-state` `command-query-separation` `immutability-by-default` `parse-dont-validate`
15. [`bridge`](../entries/bridge.md) **Bridge** · pattern/structural [E] (change_cost⊕ delivery−) {desktop,embedded,games} langs:py,ts,java,cs,go,rs,cpp: Split a class that varies along two independent axes into two hierarchies, the abstraction and its implementation, linked by composition. → `adapter` `strategy` `state` `abstract-factory` `builder`
16. [`make-illegal-states-unrepresentable`](../entries/make-illegal-states-unrepresentable.md) **Make Illegal States Unrepresentable** · principle/design [TE] (reliability⊕ change_cost+ delivery−) {web-frontend,fullstack-web,tui,compilers-tooling,library-sdk,web-api} langs:py,ts,java,cs,go,rs: Shape your types so that combinations of data that can't happen in the domain can't be built at all. Usually this means a closed set of variants (a sum type or discriminated union), each carrying only the fields that make sense for it, instead of one record with a status flag and a pile of optional fields. → `parse-dont-validate` `primitive-obsession` `temporary-field` `switch-statements` `state` `data-clumps`
17. [`validate-at-the-boundary`](../entries/validate-at-the-boundary.md) **Validate at the boundary** · practice/security [E] (security⊕ reliability⊕ change_cost+ delivery−) {web-api,cli-devtool,data-pipeline,library-sdk,plugin-host,event-driven} langs:py,ts,java,cs,go,rs: Check data where it enters from a less trusted place (a request, a file, a queue, a CLI argument, a third-party API), against an allow-list of what is acceptable, and reject the rest there, so the code inside can rely on what it receives. → `parse-dont-validate` `trusting-client-input` `injection` `postels-law` `primitive-obsession` `defense-in-depth`
18. [`swallowed-errors`](../entries/swallowed-errors.md) **Swallowed Errors** · anti-pattern/code [ATE] (delivery+ reliability− operability−) {data-pipeline,cli-devtool,web-api,library-sdk,distributed,plugin-host} langs:py,ts,java,cs,go,rs: An error is caught or returned and then dropped, so the failure goes on silently and shows up later, somewhere else, as wrong data or a confusing symptom. → `fail-fast` `error-handling-policy` `fail-open-vs-fail-closed` `exceptions-for-control-flow` `murphys-law`
19. [`frequent-debugging`](../entries/frequent-debugging.md) **Frequent Debugging** · smell/testing (change_cost−) {distributed,embedded}: Most test failures need a debugger or print statements to find the cause, because the suite lacks defect localization. Also called Manual Debugging. → `assertion-roulette` `slow-tests`
20. [`secure-by-default`](../entries/secure-by-default.md) **Secure by default** · principle/security [TE] (security⊕ delivery−) {library-sdk,plugin-host,cli-devtool,platforms,iac} langs:py,ts,java,cs,go,rs: The out-of-the-box setting is the safe one, and anything dangerous (network access, disabled TLS checks, open CORS, debug mode, running untrusted code) must be switched on explicitly, by a setting whose name says it is dangerous. → `least-privilege` `defense-in-depth` `principle-of-least-astonishment` `hyrums-law` `ssrf`
21. [`long-method`](../entries/long-method.md) **Long Method** · smell/code [CATE] (delivery+ change_cost−) {data-pipeline,scientific,ml-training,compilers-tooling,tui}: A function has grown long enough that you have to read all of it to understand any of it. → `comments` `large-class` `kiss` `duplicate-code`
22. [`dependency-injection`](../entries/dependency-injection.md) **Dependency Injection** · pattern/design [E] (change_cost⊕ delivery−) {web-api,cli-devtool,library-sdk,plugin-host} langs:java,cs,py,ts,go,rs: Hand an object the collaborators it needs (usually through its constructor) instead of letting it create or look them up, and wire the whole graph in one place at startup, the composition root. → `singleton` `global-state` `hard-to-test-code` `mock-everything` `abstract-factory` `strategy` `solid`
23. [`flyweight`](../entries/flyweight.md) **Flyweight** · pattern/structural [E] (runtime⊕ change_cost−) {games,embedded,compilers-tooling} langs:py,ts,java,cs,go,rs,cpp: Save memory by sharing the common, immutable part of many similar objects and keeping only the per-object part separate. → `composite` `singleton` `facade` `premature-optimization`

## Probes for the interview

Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).

### 1. Production Bugs

**Find:** Fix commits sorted by where the bug showed (on hardware, in the field, off target), what off-target tests cover (logic versus drivers), and whether a hardware-in-the-loop setup exists.

**Ask:** "<k> of the last <N> fixes only showed on hardware (<examples>), in code off-target tests don't reach because <it calls registers directly / it is timing-dependent>. I'd <move logic out of X behind an interface> so it can be tested off target, because <reason>. Were there field bugs that don't show in the history?"

**Settled when:** Never fully: field bugs aren't all in the repo.

### 2. Never Change a Running System

**Find:** Modules with no changes for a long time, certification or safety markers (standard references, deviation records, safety headers), and comments that warn people off.

**Ask:** "<modules> haven't changed since <date>, and <some> carry <certification markers>. Certified, proven, or feared? I'd exempt <certified ones> from new conventions and <require characterisation tests> for the rest, because <reason>."

**Settled when:** Certification records list exactly which modules are frozen, and no other module is long untouched. The agent cites them. Untouched modules without certification are never settled by code alone.

### 3. Bus factor

**Find:** Authors of drivers, interrupt handlers and the linker script, and what is written down about them.

**Ask:** "Only <person> has changed <drivers / interrupt handlers / linker script>, and <little / nothing> is written down. Could anyone else change them safely? I'd write <X> down first because <reason>."

**Settled when:** Several people change these parts and docs exist. For a solo developer the ask is only what to write down.

### 4. Murphy's law, Inversion

**Find:** Watchdog configuration, fault and assert handlers, safe-state code, and how each module handles errors (reset, safe state, carry on degraded).

**Ask:** "<modules> <reset / enter a safe state / carry on> on failure (<files>). What must happen when it fails on the device? I'd make <behaviour> the system-wide rule, with <exceptions>, because <reason>."

**Settled when:** One system-wide policy is implemented and documented. The agent confirms it.

## Also relevant

- [`additive-features`](../entries/additive-features.md) **Additive Features** · practice/api [TE] (change_cost⊕ reliability+ delivery−) {library-sdk,embedded,plugin-host,compilers-tooling} langs:rs,go,py,ts,cs,cpp: A build-time feature or conditional-compilation flag should only add to a public API, never remove or change what is already there, because a dependency graph turns on the union of every flag that anyone in it asked for. → `breaking-change-surface` `semantic-versioning-discipline` `non-exhaustive-types` `hyrums-law`
- [`lindy-effect`](../entries/lindy-effect.md) **Lindy Effect** · law/decisions (bears on change_cost, reliability) {web-frontend,embedded}: The longer a technology has already been in use, the longer it is likely to stay in use, which favours proven, "boring" choices. → `occams-razor`
