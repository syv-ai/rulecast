<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Core, Supporting and Generic Subdomains

`core-subdomain` · design patterns, architecture

Sort the business areas a system covers into core (what sets the business apart), supporting (needed and specific, but no edge) and generic (solved problems), and spend design rigour on the core while keeping the rest simple or buying it.

*Names:* Also called Core domain, Subdomain types, Distillation. Eric Evans, Domain-Driven Design (2003), ch. 15 (Distillation, in part IV, Strategic Design), which names Core Domain and Generic Subdomains and speaks of supporting elements only in passing. The three-way split with supporting subdomains was made standard by Vaughn Vernon's Implementing Domain-Driven Design (2013) and Vlad Khononov's Learning Domain-Driven Design (2021), which ties each type to a choice of implementation pattern.

*Matters most for:* web-api, fullstack-web, platforms, distributed

## But

This is where DDD's rigour pays and where it doesn't. Khononov's heuristic is the clearest: core subdomains get a domain model (or an event-sourced one) because their logic is complex and changes; supporting subdomains get a transaction script or active record; generic ones are bought or adopted. So the tactical patterns are overkill for CRUD and for supporting and generic areas, and a CRUD app with no distinctive logic may have no core worth modelling at all. Classifications move: a core idea can become a commodity, and a supporting area can become core when the business competes on it, so revisit them. For developer tools and libraries the core is usually the technical problem itself, and the business framing fits less well. Teams tend to overrate how much of their system is core; asking "would we lose customers if a competitor had this?" helps.

## Quality axes

- **delivery** ⊕ (primary): Supporting and generic areas stay plain CRUD or are bought, so admin screens stop taking as long as the hard parts.
- **change_cost** +: Design rigour, tests and review go to the core module, where the logic is complex and keeps changing.

**Flips:** Labelling everything core brings back heavy patterns everywhere and loses the delivery gain. Neglecting supporting code, or keeping an old classification after a supporting area becomes core, turns change_cost "-" there.

## Warranted when

- The same heavy patterns are applied everywhere, so simple admin screens take as long as the hard parts.
- The team has built its own version of something it could have bought (auth, scheduling, PDF rendering).
- The part that makes the product different is buried in code no more careful than the rest.
- Deciding which DDD patterns to use, and where, needs a rule better than "everywhere" or "nowhere".

## How it shows

- A rich domain model (aggregates, value objects, events, thorough tests) in one or two modules, and plain CRUD or transaction scripts elsewhere.
- Authentication, billing, email or search delegated to a library or service rather than written in-house.
- A short document or README section naming which module is core and why.
- The strongest developers and most review attention on the core module.

## Overdone when

- Labelling everything core, so the classification guides nothing.
- Treating supporting code as unimportant and letting it rot, when it still has to work.
- Building a "core" from scratch that is actually generic, such as a home-grown identity system.

## Example

Before:

```
# office_locations: an admin table edited twice a year
class OfficeLocation(AggregateRoot): ...
class OfficeLocationFactory: ...
class OfficeLocationRepository: ...
class OfficeLocationRenamed(DomainEvent): ...

# dynamic pricing: the product's edge
fn price(room, date) -> float:
    return base_rates[room.type] * (1.2 if date.is_weekend else 1.0)
```

After:

```
# supporting: plain CRUD is enough
fn update_office_location(id, fields): db.update("office_locations", id, fields)

# core: the rigour goes here
class RatePlan:                       # aggregate with invariants and tests
    fn quote(room: RoomType, stay: StayDates, demand: DemandForecast) -> Quote:
        ...                           # floors, ceilings, length-of-stay rules
class Quote: ...                      # value object
```

Effort moves from ceremony around an admin table to the pricing model that sets the business apart.

## Related

[Bounded Context](bounded-context.md) · [Reinventing the wheel](reinventing-the-wheel.md) · [Over-Engineering](over-engineering.md) · [YAGNI](yagni.md) · [Domain Allergy](domain-allergy.md) · [Aggregate](aggregate.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Core Domain, Generic Subdomains, Domain Vision Statement, Highlighted Core, Segregated Core](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 15](https://www.domainlanguage.com/ddd/) (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 1 and 10 (design heuristics)](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 2 (recalled)
