<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Games: where to start

How game state is owned and shared between systems, and which hot paths are allowed to trade clarity for speed.

Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.

Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](../AXES.md).

`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.

## Look at these first, in order

1. [`god-object`](../entries/god-object.md) **God object (The Blob)** · anti-pattern/design [AE] (delivery+ change_cost−) {mobile,games,desktop,fullstack-web,web-frontend,tui}: One class holds most of the control and data that should be spread across several, so every change goes through it. Brown et al. call it The Blob; Large Class is the smell it shows up as. → `solid` `facade` `mediator` `large-class` `divergent-change` `interface-bloat` `functional-decomposition`
2. [`global-state`](../entries/global-state.md) **Global state** · anti-pattern/design [ATE] (delivery+ reliability− change_cost−) {web-api,serverless,web-frontend,ml-training,games,embedded,tui,plugin-host} langs:py,go: Mutable data reachable from anywhere, as global variables, module-level state or singletons, so any code can change it and no caller's behaviour depends only on what it was given. → `singleton` `law-of-demeter`
3. [`premature-optimization`](../entries/premature-optimization.md) **Premature Optimization** · principle/planning [CE] (change_cost⊕ delivery+) {games,embedded,scientific,databases-storage}: Don't make code faster before you know it is a bottleneck; write it clearly, measure, then optimise the hot spots. Also called Knuth's optimization principle. → `pareto-principle` `yagni`
4. [`state`](../entries/state.md) **State** · pattern/behavioral [TE] (change_cost⊕ reliability+ delivery−) {embedded,games,mobile,web-frontend,event-driven,tui} langs:py,ts,java,cs,go,rs,cpp: Move each state's behaviour into its own object and let the owner swap which one it delegates to, so it acts as if it changed class. → `strategy` `bridge` `adapter`
5. [`composition-over-inheritance`](../entries/composition-over-inheritance.md) **Composition over Inheritance** · principle/design [E] (change_cost⊕ delivery−) {library-sdk,plugin-host,games} langs:py,ts,java,cs,go,rs: Get reuse and variation by giving an object other objects to delegate to, rather than by subclassing. Inheritance ties a subclass to its parent's internals; composition lets you combine and swap parts, including at runtime. → `refused-bequest` `parallel-inheritance-hierarchies` `strategy` `decorator` `template-method` `liskov-substitution-principle`
6. [`observer`](../entries/observer.md) **Observer** · pattern/behavioral [TE] (change_cost⊕ reliability− operability−) {web-frontend,desktop,mobile,games,event-driven,tui,plugin-host} langs:py,ts,java,cs,go,rs,cpp: Interested objects subscribe to a publisher and get told when something happens, without the publisher knowing who they are; also called Publish-Subscribe, Listener or Event Subscriber. → `mediator` `chain-of-responsibility` `command`
7. [`command`](../entries/command.md) **Command** · pattern/behavioral [E] (change_cost⊕ operability+ delivery−) {desktop,games,cli-devtool,event-driven,web-frontend,tui} langs:py,ts,java,cs,go,rs,cpp: Wrap a request in an object that carries everything needed to run it, so it can be passed around, queued, logged, retried or undone; also called Action or Transaction. → `memento` `strategy` `chain-of-responsibility` `visitor` `prototype`
8. [`functional-core-imperative-shell`](../entries/functional-core-imperative-shell.md) **Functional Core, Imperative Shell** · practice/design [E] (change_cost⊕ delivery−) {cli-devtool,tui,games,web-api,data-pipeline,event-driven} langs:py,ts,java,cs,go,rs: Put the decisions in pure functions that take values and return values, and keep a thin outer layer that reads input, calls the core, and carries out the effects it returns. The core is tested with plain values and no doubles; the shell is kept simple enough to need only a few integration tests. → `hard-to-test-code` `mock-everything` `global-state` `command-query-separation` `immutability-by-default` `parse-dont-validate`
9. [`magic-number`](../entries/magic-number.md) **Magic number** · anti-pattern/code [TE] (change_cost−) {embedded,scientific,games,ml-training}: A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand. → `primitive-obsession` `principle-of-least-astonishment`
10. [`large-class`](../entries/large-class.md) **Large Class** · smell/code [ATE] (delivery+ change_cost−) {fullstack-web,desktop,mobile,games}: A class has grown too many fields, methods or lines because new features kept landing there. Taken to the extreme it becomes a God Object. → `god-object` `divergent-change` `long-method` `solid`
11. [`long-method`](../entries/long-method.md) **Long Method** · smell/code [CATE] (delivery+ change_cost−) {data-pipeline,scientific,ml-training,compilers-tooling,tui}: A function has grown long enough that you have to read all of it to understand any of it. → `comments` `large-class` `kiss` `duplicate-code`
12. [`singleton`](../entries/singleton.md) **Singleton** · pattern/creational [CTE] (reliability⊕ runtime+ change_cost−) {mobile,games,embedded,desktop,serverless} langs:py,ts,java,cs,go,rs,cpp: A class allows only one instance of itself and hands out a global way to reach it. → `facade` `flyweight` `abstract-factory` `builder` `prototype` `global-state`
13. [`hard-to-test-code`](../entries/hard-to-test-code.md) **Hard-to-Test Code** · smell/testing [E] (delivery+ change_cost− reliability−) {embedded,games,desktop,mobile,serverless,event-driven,tui}: The code resists being tested in isolation because it is tightly coupled, asynchronous, hides what a test needs to reach, or can't be constructed without half the system. → `singleton` `test-logic-in-production` `mock-everything` `fragile-test`
14. [`manual-intervention`](../entries/manual-intervention.md) **Manual Intervention** · smell/testing [TE] (change_cost− reliability−) {embedded,mobile,desktop,games,iac}: A test needs a person to do something each run, whether setting up the environment, injecting an event or checking the result by eye. → `assertion-free-test` `slow-tests`
15. [`trusting-client-input`](../entries/trusting-client-input.md) **Trusting client input** · anti-pattern/security [E] (delivery+ security− reliability−) {web-frontend,fullstack-web,mobile,games,web-api} langs:ts,cs,py: A rule is enforced only in the browser, the mobile app or the game client (a validation, a price, a permission, a hidden field), and the server accepts whatever arrives, though anyone can send the request without that client. → `validate-at-the-boundary` `mass-assignment` `broken-object-level-authorization` `defense-in-depth`
16. [`flyweight`](../entries/flyweight.md) **Flyweight** · pattern/structural [E] (runtime⊕ change_cost−) {games,embedded,compilers-tooling} langs:py,ts,java,cs,go,rs,cpp: Save memory by sharing the common, immutable part of many similar objects and keeping only the per-object part separate. → `composite` `singleton` `facade` `premature-optimization`
17. [`prototype`](../entries/prototype.md) **Prototype** · pattern/creational [TE] (change_cost⊕ runtime+ reliability−) {games} langs:py,ts,java,cs,go,rs,cpp: Make new objects by copying a configured existing one, with the object itself doing the copying, so the caller needn't know its class. Also called clone. → `factory-method` `abstract-factory` `composite` `decorator` `memento` `command`
18. [`data-clumps`](../entries/data-clumps.md) **Data Clumps** · smell/code [TE] (delivery+ change_cost− reliability−) {scientific,games}: The same few values travel together through fields and parameter lists in several places, which says they are one concept that has no name yet. → `long-parameter-list` `primitive-obsession`
19. [`spaghetti-code`](../entries/spaghetti-code.md) **Spaghetti code** · anti-pattern/code [E] (delivery+ change_cost−) {scientific,embedded,games}: Control flow is so tangled, with jumps, flags and deep nesting, that you can't follow what happens without tracing it by hand. → `long-method` `big-ball-of-mud` `kiss`
20. [`dry`](../entries/dry.md) **DRY (Don't Repeat Yourself)** · principle/design [E] (change_cost⊕ reliability+) {iac}: Each piece of knowledge, such as a business rule, constant or config value, should live in exactly one authoritative place. It is about knowledge, not text: two identical lines that encode different decisions are not duplication. → `kiss` `yagni` `wrong-abstraction`
21. [`pareto-principle`](../entries/pareto-principle.md) **Pareto Principle** · law/decisions (bears on runtime, reliability) {games,scientific}: A small share of causes produces most of the effect, so find the vital few (hot code, crashing bugs, used features) and spend effort there. Also called the 80/20 rule. → `premature-optimization`
22. [`memento`](../entries/memento.md) **Memento** · pattern/behavioral [E] (change_cost⊕ reliability+ runtime−) {desktop,games,tui} langs:py,ts,java,cs,go,rs,cpp: An object produces an opaque snapshot of its own state that others can store and hand back for restoring, without seeing inside it; also called Snapshot. → `command` `iterator` `prototype`
23. [`exceptions-for-control-flow`](../entries/exceptions-for-control-flow.md) **Exceptions for Control Flow** · anti-pattern/code [E] (delivery+ change_cost− runtime−) {library-sdk,games} langs:py,java,cs,ts,go,rs: Throwing and catching exceptions to steer ordinary, expected logic, such as ending a loop, returning a found value or choosing a branch, instead of using a return value or a condition. → `error-handling-policy` `swallowed-errors` `principle-of-least-astonishment`
24. [`resource-leak`](../entries/resource-leak.md) **Resource Leak** · anti-pattern/code [TE] (delivery+ reliability− runtime−) {web-api,distributed,databases-storage,tui,desktop,embedded} langs:go,rs,py,java,cs,ts: Something acquired, such as a file, socket, connection, response body, lock, goroutine or background task, is not released on every path, especially the error path, so the process slowly runs out of it. → `swallowed-errors` `murphys-law` `init-time-side-effects`

## Probes for the interview

Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).

### 1. Ninety-ninety rule

**Find:** Frame-time and memory budgets or checks in the code or CI, and platform-specific branches. For features merged in the last year or so: later commits that reference the same issue or pull request, or touch the same files within a few weeks with a fix-style message. Sort them by cause: performance, memory on the weakest platform, certification.

**Ask:** "Features mostly came back for <cause> (<examples>), and <no / a> budget check runs. I'd require <budget X> from a feature's first commit because <reason>. Is that what holds features at almost done?"

**Settled when:** Budgets are already checked in CI. The agent confirms it.

### 2. Developers Not Writing Tests

**Find:** Which systems have automated tests and which don't, and what recent fixes touched.

**Ask:** "<systems> are tested and <systems> aren't; recent fixes were mostly in <x>. Should <x> stay play-tested only? I'd add tests for <deterministic logic in x> because <reason>."

**Settled when:** Coverage already matches where fixes land. The agent confirms it.

### 3. Premature optimization, Gilb's law

**Find:** Code written for speed (manual pooling, unsafe code, SIMD, cache-layout tricks, hand-unrolled loops), and for each, whether a comment, commit or benchmark points to a measurement.

**Ask:** "<N> optimisations cite a profile or benchmark; <M> don't (<files>). I'd require a measurement for new ones and <leave / simplify> the unmeasured ones, because <reason>."

**Settled when:** Every optimisation already links a measurement. The agent confirms it.

### 4. YAGNI, Gall's law

**Find:** The project's age and history, release and build pipelines, platform targets, and store or certification config.

**Ask:** "This has <no release pipeline and N months of history / a store build and platform targets>. Is it a prototype that may be thrown away, or something you'll maintain for years? I'd <recommend> because <reason>."

**Settled when:** The signals are unambiguous (shipping builds on several platforms). The agent confirms it.

## Also relevant

- [`ui-thread-confinement`](../entries/ui-thread-confinement.md) **UI thread confinement** · practice/design [TE] (reliability⊕ runtime⊕ delivery−) {tui,desktop,mobile,web-frontend,games} langs:py,ts,java,cs,go,rs: UI state and widgets are touched only from the one thread or event loop that owns them, and anything slow or blocking (network, disk, heavy computation, waiting) runs elsewhere and hands its result back to that thread as a message or posted task. → `observer` `model-view-update` `functional-core-imperative-shell` `immutability-by-default` `global-state` `resource-leak`
- [`bridge`](../entries/bridge.md) **Bridge** · pattern/structural [E] (change_cost⊕ delivery−) {desktop,embedded,games} langs:py,ts,java,cs,go,rs,cpp: Split a class that varies along two independent axes into two hierarchies, the abstraction and its implementation, linked by composition. → `adapter` `strategy` `state` `abstract-factory` `builder`
- [`composite`](../entries/composite.md) **Composite** · pattern/structural [E] (change_cost⊕ delivery−) {web-frontend,desktop,compilers-tooling,games,tui} langs:py,ts,java,cs,go,rs,cpp: Leaves and containers share one interface, so code can treat a whole tree the same way it treats a single item. → `decorator` `iterator` `visitor` `builder` `flyweight` `chain-of-responsibility` `prototype`
