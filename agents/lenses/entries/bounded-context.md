<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Bounded Context

`bounded-context` · design patterns, architecture

Draw an explicit boundary around each model, in code, data and team ownership, and keep terms consistent inside it, accepting that the same word (customer, product, course) means different things in different contexts.

*Names:* Eric Evans, Domain-Driven Design (2003), ch. 14, the centre of DDD's strategic design.

*Matters most for:* distributed, web-api, fullstack-web, platforms, event-driven

## But

A bounded context is a model boundary, not a deployment unit; mapping each to a microservice is a common misreading that produces a distributed monolith. Evans himself warns that splitting into ever smaller contexts loses integration and coherence. A small app with one team and one coherent vocabulary is one context, and drawing internal boundaries adds translation without benefit. Boundaries are hard to get right early, so many practitioners start with a modular monolith and split once the boundaries have proved stable. Applying the tactical patterns without this strategic step is what Vernon calls DDD-Lite, the most common criticism of how DDD is practised.

## Quality axes

- **change_cost** ⊕ (primary): Each context owns its model and data, so one department's change no longer ripples through a shared Customer class or schema.
- **delivery** −: Boundaries, separate models and translation between contexts have to be designed before features ship, and they are hard to get right early.

**Flips:** In a small one-team app with one vocabulary the boundaries add translation for nothing. Mapping each context to a microservice, or splitting into many tiny contexts, gives a distributed monolith that turns change_cost and operability "-".

## Warranted when

- One central class (Customer, Product, Account) has grown fields and rules for every department, and every change risks breaking someone.
- Teams argue about what a word means because each is right in its own area.
- A shared database schema couples modules that should change independently.
- Different parts of the system change at different rates or are owned by different teams.

## How it shows

- Top-level modules, packages, projects or services named after business areas (billing, scheduling, grading), each with its own model classes.
- Two classes with the same name in different contexts, each holding only what that context needs, linked by an id.
- Each context owns its tables or schema, and other contexts go through its published interface.
- Import rules or architecture tests that stop one context reaching into another's internals.

## Overdone when

- A microservice per context, or worse per entity, in a system one team could run as a modular monolith.
- Dozens of tiny contexts with translation layers between them for a domain that is really one model.
- Duplicating a concept into two contexts when it means the same thing in both.

## Example

Before:

```
class Course:                  # shared by every part of the university system
    code: str
    room: Room
    timeslots: list
    enrolment_cap: int
    grading_scheme: GradingScheme
    credits: int
    pass_mark: int
    # scheduling changes break grading tests, and the reverse
```

After:

```
# scheduling/course.py
class Course:
    course_id: CourseId
    room: Room
    timeslots: list
    enrolment_cap: int

# grading/course.py
class Course:
    course_id: CourseId
    grading_scheme: GradingScheme
    credits: int
    pass_mark: int
```

Each context keeps the version of Course its own people mean, linked by id, so scheduling and grading change independently.

## One-file tell

Any language: a file inside one context's directory that imports from another context's internal module rather than its published interface (for example billing/ importing scheduling/domain/). Needs the project's context directories configured, so it is a path-aware check, not a universal one.

## By language

**python:** One top-level package per context; import-linter contracts can forbid imports between contexts except through a public module.

**typescript:** Workspace packages or folders per context, with dependency-cruiser or eslint-plugin-boundaries rules enforcing what may import what.

**java:** Packages or Maven/Gradle modules per context. Spring Modulith treats top-level packages as application modules and verifies their dependencies; ArchUnit does the same in any Java codebase.

**csharp:** A project (assembly) per context, with internal visibility for what other contexts must not use; NetArchTest can check the rules.

**go:** A package tree per context, with internal/ directories so other contexts can't import the internals; the compiler enforces it.

**rust:** A crate per context in a workspace, with pub only on the published interface; the crate graph makes dependencies explicit and acyclic.

## Related

[Ubiquitous Language](ubiquitous-language.md) · [Context Map](context-map.md) · [Anti-Corruption Layer](anti-corruption-layer.md) · [Core, Supporting and Generic Subdomains](core-subdomain.md) · [Shared Database](shared-database.md) · [Distributed Monolith](distributed-monolith.md) · [Big Ball of Mud](big-ball-of-mud.md) · [Drifting terminology](drifting-terminology.md)

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Bounded Context and Continuous Integration](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 14](https://www.domainlanguage.com/ddd/) (recalled)
- [Martin Fowler, bliki, BoundedContext](https://martinfowler.com/bliki/BoundedContext.html) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 1 (DDD-Lite) and ch. 2 (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 3](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
