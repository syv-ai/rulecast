<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Infrastructure as code: where to start

Where shared configuration lives and when to extract a module, kept against least privilege, no secrets in code, and module inputs and outputs treated as a versioned contract.

Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.

Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](../AXES.md).

`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.

## Look at these first, in order

1. [`dry`](../entries/dry.md) **DRY (Don't Repeat Yourself)** · principle/design [E] (change_cost⊕ reliability+) {iac}: Each piece of knowledge, such as a business rule, constant or config value, should live in exactly one authoritative place. It is about knowledge, not text: two identical lines that encode different decisions are not duplication. → `kiss` `yagni` `wrong-abstraction`
2. [`wrong-abstraction`](../entries/wrong-abstraction.md) **Wrong abstraction (premature abstraction)** · anti-pattern/design [AE] (delivery+ change_cost−) {web-frontend,library-sdk,iac}: Code that looked alike was merged into one shared abstraction too early, and as the cases diverge it grows parameters and branches until it is harder to change than the duplication was. Sandi Metz's term; Speculative Generality is the related smell. → `dry` `yagni` `speculative-generality` `copy-and-paste-programming` `dogma-over-pragma` `poltergeist`
3. [`copy-and-paste-programming`](../entries/copy-and-paste-programming.md) **Copy-and-paste programming** · anti-pattern/code [ATE] (delivery+ change_cost− reliability−) {iac,data-pipeline,ml-training,web-frontend}: Code is reused by copying it and tweaking the copy, so the same logic lives in several places and a fix in one misses the others. Brown et al. call it Cut-and-Paste Programming; Duplicate Code is the smell. → `dry` `duplicate-code` `shotgun-surgery` `wrong-abstraction` `reinventing-the-wheel`
4. [`least-privilege`](../entries/least-privilege.md) **Least privilege** · principle/security [E] (security⊕ delivery− operability−) {iac,serverless,platforms,plugin-host,distributed} langs:rs,ts: Give every user, process, service account, token and plugin only the permissions its job needs, for only as long as it needs them, so a mistake or a compromise can do only that much harm. → `secure-by-default` `defense-in-depth` `broken-object-level-authorization` `hard-coded-secrets`
5. [`hard-coded-secrets`](../entries/hard-coded-secrets.md) **Hard-coded secrets** · anti-pattern/security [ATE] (delivery+ security− operability−) {iac,serverless,data-pipeline,ml-training,web-api} langs:ts,java,cs,py: Passwords, API keys, tokens or private keys are written into source code, checked-in config or build files, where everyone with the repository, the image or the bundle can read them. → `magic-number` `sensitive-data-in-logs` `least-privilege` `secure-by-default`
6. [`secure-by-default`](../entries/secure-by-default.md) **Secure by default** · principle/security [TE] (security⊕ delivery−) {library-sdk,plugin-host,cli-devtool,platforms,iac} langs:py,ts,java,cs,go,rs: The out-of-the-box setting is the safe one, and anything dangerous (network access, disabled TLS checks, open CORS, debug mode, running untrusted code) must be switched on explicitly, by a setting whose name says it is dangerous. → `least-privilege` `defense-in-depth` `principle-of-least-astonishment` `hyrums-law` `ssrf`
7. [`defense-in-depth`](../entries/defense-in-depth.md) **Defense in depth** · principle/security [E] (security⊕ delivery− runtime− change_cost−) {platforms,web-api,distributed,fullstack-web}: Protect anything that matters with several independent layers of control, so one missed check, bug or misconfiguration doesn't expose it on its own. → `least-privilege` `secure-by-default` `validate-at-the-boundary` `broken-object-level-authorization` `shotgun-surgery`
8. [`sensitive-data-in-logs`](../entries/sensitive-data-in-logs.md) **Sensitive data in logs** · anti-pattern/security [ATE] (delivery+ security−) {web-api,distributed,serverless,data-pipeline} langs:py,ts,java,cs,go,rs: Passwords, tokens, session ids, keys, payment data or personal data are written to logs, traces or error reports, which are kept longer and read by more people and systems than the data was ever meant for. → `hard-coded-secrets` `defense-in-depth` `least-privilege`
9. [`breaking-change-surface`](../entries/breaking-change-surface.md) **Breaking-Change Surface** · practice/api [E] (change_cost⊕ reliability+ delivery−) {library-sdk,cli-devtool,plugin-host,web-api,platforms,iac} langs:ts,py,go,rs,java,cs: Know every surface outsiders depend on, not just function signatures but CLI flags and output, exit codes, error messages, config schema, file formats, wire formats and defaults, and treat changes to any of them as API changes. → `hyrums-law` `semantic-versioning-discipline` `deprecation-policy` `non-exhaustive-types` `postels-law` `inconsistent-error-contract`
10. [`semantic-versioning-discipline`](../entries/semantic-versioning-discipline.md) **Semantic Versioning Discipline** · practice/api [C] (change_cost⊕ reliability+ delivery−) {library-sdk,cli-devtool,plugin-host,platforms,iac} langs:rs,ts,py,go,java,cs: Declare what your public API is, then let every release number say what changed in it, a major bump for a break, a minor for an addition or deprecation, a patch for a compatible fix, and actually hold to that. → `breaking-change-surface` `deprecation-policy` `hyrums-law` `non-exhaustive-types`
11. [`deprecation-policy`](../entries/deprecation-policy.md) **Deprecation Policy** · practice/api [E] (change_cost⊕ delivery−) {library-sdk,web-api,cli-devtool,plugin-host,platforms,iac} langs:py,java,cs,rs,ts,go: Remove public things in stages, marking them deprecated with a replacement and a removal date or version, warning users, and only deleting after a stated window, so users can migrate on their own schedule. → `semantic-versioning-discipline` `breaking-change-surface` `hyrums-law` `lava-flow`
12. [`law-of-leaky-abstractions`](../entries/law-of-leaky-abstractions.md) **The Law of Leaky Abstractions** · law/architecture [E] (bears on runtime, reliability, change_cost) {fullstack-web,databases-storage,library-sdk,iac,plugin-host}: Every non-trivial abstraction lets some of the underlying details through, so you still need to understand what it hides. → `fallacies-of-distributed-computing` `hyrums-law` `law-of-demeter`
13. [`law-of-unintended-consequences`](../entries/law-of-unintended-consequences.md) **Law of Unintended Consequences** · law/architecture (bears on reliability, change_cost) {platforms,distributed,iac}: Any real change to a complex system will have effects nobody planned for, good, bad, or the opposite of what was meant. → `hyrums-law` `murphys-law`
14. [`cargo-cult-programming`](../entries/cargo-cult-programming.md) **Cargo cult programming** · anti-pattern/code [AE] (delivery+ change_cost− operability−) {iac,ml-training,serverless}: Code, rituals or structure are copied because they appeared in working code, without understanding what they do or whether they apply here. → `dogma-over-pragma` `copy-and-paste-programming` `lava-flow`
15. [`over-engineering`](../entries/over-engineering.md) **Over-Engineering** · anti-pattern/architecture [A] (change_cost− operability− delivery−) {distributed,serverless,iac,platforms}: A system's architecture is more complex than its requirements need, usually through new technology or optimisation for flexibility and scale nobody has asked for. At code scale it overlaps Speculative Generality, which is the canonical name for the class-level form. → `yagni` `premature-optimization` `misapplied-genericity` `domain-allergy` `second-system-effect` `speculative-generality` `kiss`
16. [`inner-platform-effect`](../entries/inner-platform-effect.md) **Inner-Platform Effect** · anti-pattern/design [E] (change_cost− runtime− operability−) {platforms,fullstack-web,plugin-host}: A system made so configurable that it becomes a poor copy of the platform it runs on: a homemade database inside a database, a scripting language in JSON, a rules engine that only programmers can drive. → `over-engineering` `speculative-generality` `second-system-effect` `reinventing-the-wheel` `misapplied-genericity` `zawinskis-law`
17. [`boat-anchor`](../entries/boat-anchor.md) **Boat anchor** · anti-pattern/design [E] (security− change_cost− operability−) {iac,platforms}: A component, library or piece of infrastructure is kept in the system although it serves no purpose, usually because it was costly to get or might be useful later. → `lava-flow` `dead-code` `speculative-generality` `yagni`
18. [`magic-number`](../entries/magic-number.md) **Magic number** · anti-pattern/code [TE] (change_cost−) {embedded,scientific,games,ml-training}: A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand. → `primitive-obsession` `principle-of-least-astonishment`
19. [`teslers-law`](../entries/teslers-law.md) **Tesler's Law** · law/architecture [E] (bears on change_cost, operability) {cli-devtool,library-sdk,web-api,iac}: Every task has some complexity that cannot be removed, only moved, so decide deliberately whether the user, the caller or the system carries it. Also called the Law of Conservation of Complexity. → `occams-razor` `principle-of-least-astonishment`
20. [`kiss`](../entries/kiss.md) **KISS (Keep It Simple, Stupid)** · principle/design [E] (change_cost⊕ delivery+): Pick the simplest design that meets the actual requirement. → `yagni` `galls-law` `kernighans-law` `dry`
21. [`manual-intervention`](../entries/manual-intervention.md) **Manual Intervention** · smell/testing [TE] (change_cost− reliability−) {embedded,mobile,desktop,games,iac}: A test needs a person to do something each run, whether setting up the environment, injecting an event or checking the result by eye. → `assertion-free-test` `slow-tests`
22. [`validate-at-the-boundary`](../entries/validate-at-the-boundary.md) **Validate at the boundary** · practice/security [E] (security⊕ reliability⊕ change_cost+ delivery−) {web-api,cli-devtool,data-pipeline,library-sdk,plugin-host,event-driven} langs:py,ts,java,cs,go,rs: Check data where it enters from a less trusted place (a request, a file, a queue, a CLI argument, a third-party API), against an allow-list of what is acceptable, and reject the rest there, so the code inside can rely on what it receives. → `parse-dont-validate` `trusting-client-input` `injection` `postels-law` `primitive-obsession` `defense-in-depth`
23. [`hyrums-law`](../entries/hyrums-law.md) **Hyrum's Law** · law/architecture [E] (bears on change_cost, reliability) {library-sdk,web-api,platforms,plugins-extensions,cli-devtool,plugin-host}: With enough users, every observable behaviour of an API ends up depended on by someone, whatever the docs promise. → `law-of-leaky-abstractions` `postels-law`

## Probes for the interview

Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).

### 1. The map is not the territory

**Find:** Whether CI runs a scheduled plan to detect drift, ignore-changes blocks, imported resources, data sources reading resources nothing here manages, and comments or commits about manual changes in the console.

**Ask:** "<N> resources ignore changes to <attributes>, <data sources> read things nothing here manages, and CI <does / doesn't> detect drift. When live infrastructure and the code disagree, which wins? I'd make the code win and <add a drift check> because <reason>."

**Settled when:** Drift is checked on a schedule and nothing is ignored. The agent confirms it; what the live state holds now isn't in the repo.

### 2. Never Change a Running System

**Find:** Prevent-destroy guards, resources untouched for a long time, warning comments, state moves and imports, and commits that reverted an apply.

**Ask:** "<resources> have <guards / warnings> and haven't changed since <date>. Does nobody dare touch them, and why? I'd <require X before changing them> because <reason>."

**Settled when:** Never by code alone: the repo shows the guards, not the fear behind them.

### 3. Bus factor

**Find:** Pipelines that run apply and on which branches, docs on manual applies, how credentials are configured, CODEOWNERS, and who authored the commits that changed production.

**Ask:** "Production applies run <from CI on main / by hand>, and only <people> changed <prod> in the last <period>. Could someone else apply safely if they were away? I'd <move applies into CI with approval> because <reason>."

**Settled when:** Applies run only through CI with an approval step and a runbook. The agent confirms it.

### 4. Developers Not Writing Tests

**Find:** Validation, lint and policy checks in CI (format, validate, static security scanners, policy as code), module tests, and plan tests. An analysis of which risky changes would pass all of them: public storage or network exposure, missing encryption, wide permissions, destroyed or replaced stateful resources, values that differ between environments.

**Ask:** "CI runs <checks>; nothing tests <modules>. A change that <risk the analysis found> would pass all of them. I'd add <a policy check for X> first because <reason>. Is there a risk you worry about more?"

**Settled when:** Policy checks and module tests already cover the risks the agent found. The agent confirms it.

### 5. Blind Pattern Following

**Find:** The module and environment layout, how the environments actually differ (compare their variable files), and code copied between environments.

**Ask:** "Environments differ only in <variables>, but each keeps its own copy of <N files> <(the layout came from <template>, per <commit / README>)>. Is keeping them separate deliberate, for example to change one environment at a time? I'd <share one module and pass variables> because <reason>."

**Settled when:** The layout already tracks how environments differ, with no copies. The agent confirms it.

## Also relevant

- [`duplicate-code`](../entries/duplicate-code.md) **Duplicate Code** · smell/code [ATE] (delivery+ change_cost− reliability−) {iac,data-pipeline,scientific,web-frontend}: The same logic appears in more than one place, so every fix or change has to be made in each copy and the copies drift. Fowler calls it Duplicated Code. → `dry` `wrong-abstraction` `alternative-classes-with-different-interfaces` `shotgun-surgery`
