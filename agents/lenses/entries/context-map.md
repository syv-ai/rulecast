<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Context Map

`context-map` · design patterns, architecture

A map of the bounded contexts in play, including outside systems, and of how each pair relates (who is upstream, who translates, what is shared), drawn as things are now rather than as hoped.

*Names:* Eric Evans, Domain-Driven Design (2003), ch. 14. The relationship patterns it uses are Evans's too (Shared Kernel, Customer/Supplier, Conformist, Anticorruption Layer, Open Host Service, Published Language, Separate Ways); Partnership and Big Ball of Mud were added in his 2015 DDD Reference.

*Matters most for:* distributed, platforms, event-driven

## But

Its value grows with the number of teams and systems; for one team and one codebase, a list of external integrations and how each is wrapped is enough. Like any architecture diagram it rots unless something checks it, so encode the important edges as dependency rules instead of trusting the picture. Evans's advice is to map the existing terrain first and change it later; a map drawn as the target state misleads.

## Quality axes

- **change_cost** ⊕ (primary): Who is upstream, who translates and who owns each concept is written down, so a change on one side stops surprising the other.
- **delivery** −: Mapping integrations and keeping the map true is work that ships nothing.

**Flips:** For one team and one codebase a list of integrations is enough and a detailed map is upkeep only; a map drawn as the hoped-for target state misleads and makes changes riskier.

## Warranted when

- Several teams or systems integrate, and changes on one side keep surprising the other.
- Nobody can say which system is the source of truth for a concept.
- A downstream team plans around features an upstream team never committed to.
- A legacy system or vendor API is shaping the model of the code that uses it.

## How it shows

- A diagram or document in the repository naming each context, its owner and each integration with its relationship type.
- Integration code whose shape matches the map (a translator where the map says anticorruption layer, a versioned public API where it says open host service).
- Dependency rules or architecture tests that encode the allowed directions.

## Overdone when

- A detailed map for a single-team app with one context and a couple of third-party APIs.
- Drawing the map as the desired future state, so it describes nothing that exists.
- Maintaining a heavy modelling tool's output that nobody reads after the workshop.

## Example

None: A context map describes relationships between contexts and teams in a diagram or document; it has no shape in a single code snippet.

## Related

[Bounded Context](bounded-context.md) · [Anti-Corruption Layer](anti-corruption-layer.md) · [Shared Database](shared-database.md) · [Big Ball of Mud](big-ball-of-mud.md)

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Context Map and the relationship patterns](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 14](https://www.domainlanguage.com/ddd/) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 3 (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 4](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
- [Context Mapper, a DSL and tooling for context maps](https://contextmapper.org/) (recalled)
