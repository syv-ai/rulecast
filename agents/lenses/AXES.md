<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Quality axes

Every lens is labelled with its effect on six quality axes. Ask the developer which axes matter most for this project, then bring up the lenses whose primary effect is on those axes, and name each one's costs from its other signs. The axes are one input: the kind of project, its forces and what the repository already shows still decide the order.

⊕ marks a lens's primary effect: the reason to reach for it. A lens can help other axes too (+) and costs something on most (−); each lens's page says why, and when a sign flips. Anti-patterns and smells have no primary effect. Laws can't be followed, only planned for, so they name the axes they bear on.

## security

What an attacker, a leaked secret or a compromised dependency can do.

**Primary effect of (7):** [Least privilege](entries/least-privilege.md), [Secure by default](entries/secure-by-default.md), [Defense in depth](entries/defense-in-depth.md), [Tenant isolation](entries/tenant-isolation.md), [Validate at the boundary](entries/validate-at-the-boundary.md), [Fail Open vs Fail Closed](entries/fail-open-vs-fail-closed.md), [Authorize before side effects](entries/authorize-before-side-effects.md)

**Laws that bear on it:** [Fallacies of Distributed Computing](entries/fallacies-of-distributed-computing.md)

## reliability

Whether it keeps working and fails visibly when it doesn't.

**Primary effect of (24):** [Fail Fast](entries/fail-fast.md), [Make Illegal States Unrepresentable](entries/make-illegal-states-unrepresentable.md), [Liskov Substitution Principle (LSP)](entries/liskov-substitution-principle.md), [Idempotency](entries/idempotency.md), [Postel's Law](entries/postels-law.md), [Validate at the boundary](entries/validate-at-the-boundary.md), [Error Handling Policy](entries/error-handling-policy.md), [Fail Open vs Fail Closed](entries/fail-open-vs-fail-closed.md), [Contract Test](entries/contract-test.md), [Property-Based Test](entries/property-based-test.md), [Parse, Don't Validate](entries/parse-dont-validate.md), [Immutability by Default](entries/immutability-by-default.md), [401 Unauthorized versus 403 Forbidden](entries/unauthenticated-vs-forbidden.md), [UI thread confinement](entries/ui-thread-confinement.md), [Singleton](entries/singleton.md), [Unit of Work](entries/unit-of-work.md), [Identity Map](entries/identity-map.md), [Entity](entries/entity.md), [Value Object](entries/value-object.md), [Aggregate](entries/aggregate.md), [Factory (DDD)](entries/factory-ddd.md), [Circuit Breaker](entries/circuit-breaker.md), [Transactional Outbox](entries/outbox.md), [Saga](entries/saga.md)

**Laws that bear on it:** [Broken Windows Theory](entries/broken-windows-theory.md), [CAP Theorem](entries/cap-theorem.md), [Fallacies of Distributed Computing](entries/fallacies-of-distributed-computing.md), [Gall's Law](entries/galls-law.md), [Hyrum's Law](entries/hyrums-law.md), [Kernighan's Law](entries/kernighans-law.md), [The Law of Leaky Abstractions](entries/law-of-leaky-abstractions.md), [Law of Unintended Consequences](entries/law-of-unintended-consequences.md), [Lindy Effect](entries/lindy-effect.md), [Murphy's Law](entries/murphys-law.md), [Pareto Principle](entries/pareto-principle.md), [Pesticide Paradox](entries/pesticide-paradox.md), [Little's Law](entries/littles-law.md)

## change_cost

What the next change costs, including how easy it is to test.

**Primary effect of (73):** [The Dependency Rule](entries/dependency-rule.md), [Tell, Don't Ask](entries/tell-dont-ask.md), [Command-Query Separation (CQS)](entries/command-query-separation.md), [Composition over Inheritance](entries/composition-over-inheritance.md), [SOLID](entries/solid.md), [Single Responsibility Principle (SRP)](entries/single-responsibility-principle.md), [Open/Closed Principle (OCP)](entries/open-closed-principle.md), [Interface Segregation Principle (ISP)](entries/interface-segregation-principle.md), [Dependency Inversion Principle (DIP)](entries/dependency-inversion-principle.md), [DRY (Don't Repeat Yourself)](entries/dry.md), [KISS (Keep It Simple, Stupid)](entries/kiss.md), [Law of Demeter](entries/law-of-demeter.md), [Occam's Razor](entries/occams-razor.md), [Premature Optimization](entries/premature-optimization.md), [Principle of Least Astonishment](entries/principle-of-least-astonishment.md), [Semantic Versioning Discipline](entries/semantic-versioning-discipline.md), [Deprecation Policy](entries/deprecation-policy.md), [Breaking-Change Surface](entries/breaking-change-surface.md), [Non-Exhaustive Types](entries/non-exhaustive-types.md), [Prefer Fakes over Mocks](entries/fake-over-mock.md), [Functional Core, Imperative Shell](entries/functional-core-imperative-shell.md), [Additive Features](entries/additive-features.md), [Versioned Plugin Protocol](entries/versioned-plugin-protocol.md), [The Boy Scout Rule](entries/boy-scout-rule.md), [Technical Debt](entries/technical-debt.md), [Testing Pyramid](entries/testing-pyramid.md), [Bounded Context](entries/bounded-context.md), [Ubiquitous Language](entries/ubiquitous-language.md), [Context Map](entries/context-map.md), [Abstract Factory](entries/abstract-factory.md), [Builder](entries/builder.md), [Factory Method](entries/factory-method.md), [Prototype](entries/prototype.md), [Adapter](entries/adapter.md), [Bridge](entries/bridge.md), [Composite](entries/composite.md), [Decorator](entries/decorator.md), [Facade](entries/facade.md), [Proxy](entries/proxy.md), [Chain of Responsibility](entries/chain-of-responsibility.md), [Command](entries/command.md), [Iterator](entries/iterator.md), [Mediator](entries/mediator.md), [Memento](entries/memento.md), [Observer](entries/observer.md), [State](entries/state.md), [Strategy](entries/strategy.md), [Template Method](entries/template-method.md), [Visitor](entries/visitor.md), [Repository](entries/repository.md), [Service Layer](entries/service-layer.md), [Domain Model](entries/domain-model.md), [Data Mapper](entries/data-mapper.md), [Table Data Gateway](entries/table-data-gateway.md), [Data Transfer Object](entries/data-transfer-object.md), [Dependency Injection](entries/dependency-injection.md), [Front Controller](entries/front-controller.md), [Domain Service](entries/domain-service.md), [Domain Event](entries/domain-event.md), [Specification](entries/specification.md), [Anti-Corruption Layer](entries/anti-corruption-layer.md), [Ports and Adapters](entries/ports-and-adapters.md), [Layered Architecture](entries/layered-architecture.md), [CQRS (Command Query Responsibility Segregation)](entries/cqrs.md), [Pipes and Filters](entries/pipes-and-filters.md), [Microkernel (plugin architecture)](entries/microkernel.md), [Tolerant Reader](entries/tolerant-reader.md), [Strangler Fig](entries/strangler-fig.md), [Test Double taxonomy (dummy, stub, spy, mock, fake)](entries/test-double-taxonomy.md), [Golden Master Test (approval, snapshot or golden-file test)](entries/golden-master-test.md), [Test Data Builder](entries/test-data-builder.md), [Fluent Interface](entries/fluent-interface.md), [Model-View-Update (The Elm Architecture)](entries/model-view-update.md)

**Laws that bear on it:** [Broken Windows Theory](entries/broken-windows-theory.md), [Hyrum's Law](entries/hyrums-law.md), [Kernighan's Law](entries/kernighans-law.md), [The Law of Leaky Abstractions](entries/law-of-leaky-abstractions.md), [Law of Unintended Consequences](entries/law-of-unintended-consequences.md), [Lehman's Laws of Software Evolution](entries/lehmans-laws.md), [Lindy Effect](entries/lindy-effect.md), [Second-System Effect](entries/second-system-effect.md), [Tesler's Law](entries/teslers-law.md), [Zawinski's Law](entries/zawinskis-law.md)

## delivery

How fast the team ships now.

**Primary effect of (4):** [YAGNI](entries/yagni.md), [Core, Supporting and Generic Subdomains](entries/core-subdomain.md), [Transaction Script](entries/transaction-script.md), [Active Record](entries/active-record.md)

**Laws that bear on it:** [Gall's Law](entries/galls-law.md), [Second-System Effect](entries/second-system-effect.md)

## runtime

Speed and resource use when it runs.

**Primary effect of (2):** [UI thread confinement](entries/ui-thread-confinement.md), [Flyweight](entries/flyweight.md)

**Laws that bear on it:** [Amdahl's Law](entries/amdahls-law.md), [Fallacies of Distributed Computing](entries/fallacies-of-distributed-computing.md), [Gustafson's Law](entries/gustafsons-law.md), [The Law of Leaky Abstractions](entries/law-of-leaky-abstractions.md), [Pareto Principle](entries/pareto-principle.md), [Little's Law](entries/littles-law.md)

## operability

What it takes to run, observe and debug it in production.

**Primary effect of (1):** [Event Sourcing](entries/event-sourcing.md)

**Laws that bear on it:** [Tesler's Law](entries/teslers-law.md)
