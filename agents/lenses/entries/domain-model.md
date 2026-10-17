<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Domain Model

`domain-model` · design patterns, design

Model the business as objects that carry both their data and the rules about it, so invariants live with the state they protect instead of in the procedures that use it.

*Names:* Named in Fowler's PoEAA (2002). Evans's Domain-Driven Design (2003) built a whole approach on it (entities, value objects, aggregates). Sometimes called a rich domain model, in contrast to the anemic one.

*Matters most for:* web-api, fullstack-web, distributed

## But

Fowler notes a domain model costs more to build and needs a mapping layer to the database, so it pays off only when the logic is complex. Functional programmers (Wlaschin, Domain Modeling Made Functional) get the same benefit with immutable types and pure functions over them instead of mutable objects with methods, so "data and behaviour together" is one way to keep rules in one place, not the only one. Many web apps are mostly CRUD and are better served by a transaction script.

## Quality axes

- **change_cost** ⊕ (primary): Invariants live with the state they protect, so a rule changes in one place instead of in every procedure that copied it.
- **reliability** +: State changes go through methods that enforce the rules, so invalid states can't be produced from any caller.
- **delivery** −: The model and the mapping layer to the database cost more to build up front.

**Flips:** For CRUD screens or generic subdomains with no rules to enforce it is ceremony, and a transaction script is cheaper on both axes.

## Warranted when

- The same rules or invariants are checked in several procedures and have started to drift.
- Business rules interact (a claim's status, limits and history all affect what can happen next).
- Domain experts and code disagree on terms, and the logic is the product's core value.

## How it shows

- Entities with methods named for business actions (claim.approve, order.cancel) that check and change their own state.
- Few public setters; state changes go through methods that enforce rules.
- Domain classes with no imports from the web framework or database driver.

## Overdone when

- A rich model for a CRUD screen or a generic subdomain where there are no rules to enforce.
- Entities that reach into repositories or services to do their work, mixing persistence back in.
- DDD tactical ceremony (aggregates, factories, domain events) around data that only gets stored and shown.

## Example

Before:

```
fn approve_claim(claim, adjuster):
    if claim.status != "open": raise Invalid()
    if claim.amount > adjuster.limit: raise Forbidden()
    claim.status = "approved"

fn partial_payout(claim, amount):
    if claim.status != "open": raise Invalid()      # same check again
    claim.paid += amount
    if claim.paid >= claim.amount: claim.status = "closed"
```

After:

```
class Claim:
    fn approve(adjuster):
        self.require_open()
        if self.amount > adjuster.limit: raise Forbidden()
        self.status = APPROVED

    fn pay(amount: Money):
        self.require_open()
        self.paid += amount
        if self.paid >= self.amount: self.status = CLOSED
```

The rules about a claim's lifecycle move onto the claim, so no caller can change its status without them.

## By language

**java:** JPA entities can be rich, but JPA's need for a no-argument constructor and mutable fields pushes toward setters; keep those package-private or protected and expose business methods.

**csharp:** EF Core supports private setters, backing fields and owned types, so entities can enforce invariants while still being mapped.

**python:** Django models are Active Records, so rich behaviour goes on the model. Cosmic Python shows the separate domain-model style with SQLAlchemy classical mapping.

**typescript:** Classes with private fields work; many TS codebases prefer plain types plus functions in a module, which gives the same cohesion without classes.

**go:** Methods on structs with unexported fields and a constructor function that validates; Go culture leans simple, so rich models are less common outside DDD-style services.

**rust:** A natural fit: private fields, constructors that validate, methods that consume self to model state transitions, and enums that make invalid states unrepresentable.

## Related

[Anemic Domain Model](anemic-domain-model.md) · [Transaction Script](transaction-script.md) · [Data Mapper](data-mapper.md) · [Repository](repository.md) · [Active Record](active-record.md) · [Data Class](data-class.md) · [Feature Envy](feature-envy.md)

## Overlaps

Decide domain-model or transaction-script first: it is a choice per subdomain, not a ranking. Only then is anemic-domain-model a fault, when rich rules were wanted and ended up in services. data-class is the smell on one class, and is fine on boundary types.

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Domain Model (catalog summary)](https://martinfowler.com/eaaCatalog/domainModel.html) (read)
- [Eric Evans, Domain-Driven Design Reference (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (recalled)
- [Scott Wlaschin, Domain Modeling Made Functional (2018)](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/) (recalled)
