<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Methodologies

How a project's conventions are worked out. With the developer, the agent picks a primary methodology, which frames the project's surfaces and structure, and usually a secondary one for internal code. Before any methodology: state what the project already enforces (linter and formatter config, type-checker strictness, CI checks, and the suppressions in the code). Those are conventions already; the interview confirms them rather than rediscovering them.

## Refactoring to Patterns (`refactoring-to-patterns`)

Never choose a pattern up front. Write the plain code, refactor away duplication and mixed responsibilities, and let a pattern in where its forces appear. Conventions read "when you see X, refactor toward Y".

**Fits:** Most internal code. Evolving products, small teams, code without a strong framework idiom. The usual secondary methodology.

**Signals in the code:** no dominant framework; mixed styles across modules; patterns used inconsistently.

**Ask:**

- Which duplications have already caused a bug or a missed update?
- Where do changes keep landing in the same place for unrelated reasons?

**Lenses to look at first:** [DRY (Don't Repeat Yourself)](entries/dry.md), [Shotgun Surgery](entries/shotgun-surgery.md), [Divergent Change](entries/divergent-change.md), [Speculative Generality](entries/speculative-generality.md), [YAGNI](entries/yagni.md), [Switch Statements](entries/switch-statements.md)

**Pairs with:** `quality-attributes`, `contract-led`, `framework-idiom`

## Framework idiom (`framework-idiom`)

The framework's documented idiom is the pattern language (Spring MVC, Django, Rails, ASP.NET Core, FastAPI's dependencies and routers, Bubble Tea's Elm Architecture, React's components and hooks). Each place the code departs from the idiom is a decision to record, either a convention to restore the idiom or a stated exception.

**Fits:** Projects built on a framework with a strong, well-documented idiom. Replaces the earlier "domain pattern language", which named UI and distributed idioms but not frameworks.

**Signals in the code:** a framework owns the entry points; the code mostly follows its tutorial structure; departures cluster in a few modules.

**Ask:**

- Which framework conventions do you follow on purpose, and which have you left?
- Where the code is inconsistent with itself (some routes use the repository layer, some don't), which way is right?
- Where have you built your own version of something the framework already provides?

**Lenses to look at first:** [Front Controller](entries/front-controller.md), [Fat Controller](entries/fat-controller.md), [Active Record](entries/active-record.md), [Repository](entries/repository.md), [Service Layer](entries/service-layer.md), [Data Transfer Object](entries/data-transfer-object.md)

**Stances to lead with:** [kept-for-what-it-does](THINKING.md#kept-for-what-it-does), [reasons-not-precedent](THINKING.md#reasons-not-precedent)

**Pairs with:** `refactoring-to-patterns`, `exemplar`, `migration-in-progress`

## Led by quality attributes (`quality-attributes`)

Start from the non-functional requirements that matter most (latency budgets, resource limits, consistency, availability, security and tenant isolation, operability, determinism), and let them set the constraints and patterns. Conventions protect the attributes.

**Fits:** Systems whose hardest problems are technical, not domain: tooling with time budgets, infrastructure, data pipelines, embedded, high-throughput services, and multi-tenant or security-sensitive services where one leak outweighs any feature.

**Signals in the code:** measured budgets or SLOs in docs or tests; performance or determinism tests; fail-open or fail-closed handling; a tenant or organisation id threaded through queries; a threat model or security review in the docs.

**Ask:**

- Which one or two qualities would you trade others for?
- Which of them is measured today, and where?
- [object Object]
- Could the code hit the number you measure while the quality itself gets worse?

**Lenses to look at first:** [Premature Optimization](entries/premature-optimization.md), [Amdahl's Law](entries/amdahls-law.md), [Fail Open vs Fail Closed](entries/fail-open-vs-fail-closed.md), [Fallacies of Distributed Computing](entries/fallacies-of-distributed-computing.md), [CAP Theorem](entries/cap-theorem.md), [Secure by default](entries/secure-by-default.md), [Least privilege](entries/least-privilege.md), [Defense in depth](entries/defense-in-depth.md), [Tenant isolation](entries/tenant-isolation.md)

**Stances to lead with:** [numbers-are-signals](THINKING.md#numbers-are-signals), [start-from-failure](THINKING.md#start-from-failure)

**Pairs with:** `refactoring-to-patterns`, `contract-led`

## Contract-led (`contract-led`)

List every surface outsiders depend on (the public API, a plugin or wire protocol, CLI output and exit codes, config schema, file formats, error text) and make conventions strict and reviewed there. Compatibility is the leading quality. Internal code follows a secondary methodology.

**Fits:** Libraries and SDKs, plugin hosts, CLIs that scripts call, anything with a published API or protocol.

**Signals in the code:** a public API or exported types; a plugin or extension interface; a changelog with breaking-change entries; snapshot tests of output.

**Ask:**

- Which of these surfaces do you promise to keep stable, and which are internal even if visible?
- How do you deprecate, and how long do you keep the old form?

**Lenses to look at first:** [Hyrum's Law](entries/hyrums-law.md), [Breaking-Change Surface](entries/breaking-change-surface.md), [Semantic Versioning Discipline](entries/semantic-versioning-discipline.md), [Deprecation Policy](entries/deprecation-policy.md), [Tolerant Reader](entries/tolerant-reader.md), [Postel's Law](entries/postels-law.md), [Golden Master Test (approval, snapshot or golden-file test)](entries/golden-master-test.md), [Contract Test](entries/contract-test.md)

**Pairs with:** `refactoring-to-patterns`, `quality-attributes`, `decision-led`

## DDD-led (`ddd-led`)

Split the domain into core, supporting and generic subdomains. Rigour and rich modelling go where the business is complex and differentiating (the core); plain CRUD, transaction scripts and bought-in solutions are right elsewhere. Conventions differ by subdomain.

**Fits:** Business software with complex, changing rules and a domain worth modelling.

**Signals in the code:** business rules spread across services or helpers; the same concept named differently in different places; a domain expert in the team.

**Ask:**

- Which part of the system is what makes the business different?
- Where are the rules that change most often, and who decides them?
- Do the boundaries you'd draw between subdomains match who owns the code today?

**Lenses to look at first:** [Core, Supporting and Generic Subdomains](entries/core-subdomain.md), [Bounded Context](entries/bounded-context.md), [Ubiquitous Language](entries/ubiquitous-language.md), [Aggregate](entries/aggregate.md), [Value Object](entries/value-object.md), [Anemic Domain Model](entries/anemic-domain-model.md), [Drifting terminology](entries/drifting-terminology.md)

**Stances to lead with:** [ownership-before-boundaries](THINKING.md#ownership-before-boundaries)

**Pairs with:** `refactoring-to-patterns`, `framework-idiom`

## Exemplar code (`exemplar`)

The code is copied by others, such as a template, a reference application or a teaching sample. Conventions optimise for the reader who copies: consistency over local cleverness, the canonical layer shown even where YAGNI says skip it, and every pattern used everywhere or nowhere. Resolve the code's inconsistencies with itself before forks inherit them.

**Fits:** Starter templates, reference architectures, samples, internal golden paths. Usually a modifier on framework idiom or DDD-led.

**Signals in the code:** README presents it as a template or reference; many forks; the same concern done two ways.

**Ask:**

- Who copies this, and what should they copy?
- Where it does one thing two ways, which is the one to teach?
- Which patterns are here because the people copying this will need them, and which only because templates usually have them?

**Lenses to look at first:** [Principle of Least Astonishment](entries/principle-of-least-astonishment.md), [Drifting terminology](entries/drifting-terminology.md), [Dogma over pragma](entries/dogma-over-pragma.md), [Cargo cult programming](entries/cargo-cult-programming.md)

**Stances to lead with:** [reasons-not-precedent](THINKING.md#reasons-not-precedent)

**Pairs with:** `framework-idiom`, `ddd-led`

## Decision-led (`decision-led`)

The project has already written down its decisions, as architecture decision records, a numbered spec or design notes, and each one argues its options and what it gave up. Start from those: every recorded decision that the code can break is a candidate convention, and its own rejected options are the counter-view. The interview checks which decisions still hold, which were superseded, and where the code has drifted from them.

**Fits:** Projects with a maintained decision log or spec. Usually primary for the parts the decisions cover, with another methodology for code they don't reach.

**Signals in the code:** a docs/adr; docs/decisions or numbered spec folder; decisions marked accepted or superseded; code comments that cite a decision number.

**Ask:**

- Which recorded decisions still hold, and which were quietly abandoned?
- Where the code disagrees with a decision, is the decision or the code wrong?
- Which recorded decisions rest mainly on what another project did, rather than on this project's own needs?

**Lenses to look at first:** [Dogma over pragma](entries/dogma-over-pragma.md), [Lehman's Laws of Software Evolution](entries/lehmans-laws.md)

**Stances to lead with:** [check-the-draft-against-the-code](THINKING.md#check-the-draft-against-the-code), [ask-the-history-first](THINKING.md#ask-the-history-first), [reasons-not-precedent](THINKING.md#reasons-not-precedent)

**Pairs with:** `contract-led`, `quality-attributes`, `migration-in-progress`

## Migration in progress (`migration-in-progress`)

The project is halfway through a move from one architecture, framework or style to another, often one written down as the house architecture. Two kinds of code coexist, and both are "how it's done here". Conventions say which side is the target, that new code goes there, how the old side may still be touched, and when the old way gets deleted. Never infer the convention from whichever side has more code.

**Fits:** Codebases mid-rewrite, mid-upgrade or mid-restructure: a new layer beside an old one, two state libraries, two API versions, legacy and new folders. A modifier on whichever methodology fits the target.

**Signals in the code:** legacy; old; v1 or deprecated folders beside new ones; the same concern done two ways split by age in git history; a migration plan or house-architecture document; compatibility shims.

**Ask:**

- Which side is the target, and is the move still active or stalled?
- May the old side get new features, only fixes, or nothing?
- What has to be true before the old way is deleted?
- Is the old side kept because it still earns its place, or because of what it cost to build?

**Lenses to look at first:** [Strangler Fig](entries/strangler-fig.md), [Anti-Corruption Layer](entries/anti-corruption-layer.md), [Deprecation Policy](entries/deprecation-policy.md), [Lava flow](entries/lava-flow.md), [Drifting terminology](entries/drifting-terminology.md)

**Stances to lead with:** [kept-for-what-it-does](THINKING.md#kept-for-what-it-does), [frozen-code-gets-its-own-rule](THINKING.md#frozen-code-gets-its-own-rule)

**Pairs with:** `framework-idiom`, `decision-led`, `refactoring-to-patterns`
