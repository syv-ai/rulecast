<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Anemic Domain Model

`anemic-domain-model` · anti-patterns, design · **contested** · **agents do this**

Domain classes that look like a model (named after business nouns, related to each other) but hold only data, while all the rules live in service classes that read and set their fields. It has the cost of a domain model without its benefit.

*Names:* Named by Martin Fowler in his bliki (2003), who had discussed it with Eric Evans. Its opposite is a rich domain model. Data Class is the code-scale smell for a single class.

*Matters most for:* web-api, fullstack-web

## But

For CRUD and generic subdomains, a transaction script over plain data is fine, and Fowler's own PoEAA says a domain model is only worth it when the logic is complex. Functional styles (Wlaschin, the "data-oriented programming" school) deliberately separate immutable data from the functions that act on it and get cohesion through modules and types instead; that is not this anti-pattern when the rules for one concept live in one place. Plain data is also right at boundaries (DTOs, events, read models in CQRS). The problem is specifically rules about one concept scattered across services while the classes pretend to be a model.

## Quality axes

- **delivery** +: Scaffolded data classes with logic in services is the path frameworks and tutorials already lay out.
- **change_cost** −: Rules about one concept are scattered across services and validation is copied, so a rule change means finding every copy.
- **reliability** −: Public setters let any service put an entity into an invalid state, and copied validations drift apart.

**Flips:** For CRUD and generic subdomains a transaction script over plain records is the right choice, and functional styles separate data and functions on purpose when one concept's rules live in one place.

## Why people fall into it

- Frameworks and tutorials present entities as ORM-mapped data holders and services as where code goes.
- Layered architecture read as "entities hold data, services hold logic".
- JavaBeans conventions and serialisers that want public setters and no-arg constructors.
- Generated entities (from a schema or ORM scaffolding) that nobody adds methods to.

## How it shows

- Entity classes with only fields, getters and setters, and service classes named after them (Order and OrderService) holding every rule.
- Services that read several fields of an entity, decide, then set its status (Feature Envy repeated).
- The same validation of an entity's state copied across services.
- An ORM and a mapping layer in place, yet no behaviour on the mapped objects.

## Overcorrecting looks like

- Pushing every operation onto entities, including persistence, emails and calls to other services, so entities grow into god objects that need the whole system to construct.
- Forcing rich objects onto CRUD and generic subdomains with no invariants worth protecting.

## What to do

If the rules are complex and repeated, move them onto the objects they are about (Move Method), replace setters with intention-revealing methods that enforce invariants, and leave the services to coordinate loading, transactions and calls. If the logic is simple, drop the pretence instead: call it a transaction script over plain records and skip the domain-model machinery.

## Example

Before:

```
class GiftCard:
    balance: Money
    status: str
    expires_at: Date

class RedemptionService:
    fn redeem(card, amount):
        if card.status != "active" or today() > card.expires_at: raise Unusable()
        if amount > card.balance: raise Insufficient()
        card.balance = card.balance - amount

class RefundService:
    fn refund_to_card(card, amount):
        card.balance = card.balance + amount     # forgot the expiry check
```

After:

```
class GiftCard:
    fn redeem(amount: Money):
        self.require_usable()
        if amount > self.balance: raise Insufficient()
        self.balance -= amount

    fn credit(amount: Money):
        self.require_usable()
        self.balance += amount

class RedemptionService:
    fn redeem(card_id, amount): with uow: uow.cards.get(card_id).redeem(amount); uow.commit()
```

The card's rules move onto the card, so every service gets them for free and the service only coordinates.

## By language

**java:** Common in Spring with JPA entities generated with Lombok getters and setters and logic in @Service classes. Where there is no service layer and the rules sit in controllers, the problem is fat-controller, not anemia.

**csharp:** The alternative is private setters and behaviour methods on entities, which EF Core supports as well as it supports plain property bags.

**python:** In Django, keeping logic in model methods and managers is idiomatic, so a thin-model, services-heavy Django app is the anemic form; SQLModel classes used as both table and schema tend toward it too.

**typescript:** Plain types with functions in one module per concept is a legitimate functional style, not anemia; anemia is TypeORM entity classes with logic scattered across several services.

**go:** Plain structs with logic in service methods is mainstream Go and usually fine; it becomes the anti-pattern only when one concept's rules are spread across several services.

**rust:** Structs with pub fields and logic elsewhere is the same risk; private fields and methods or modules that own the type are the idiom.

## Related

[Domain Model](domain-model.md) · [Transaction Script](transaction-script.md) · [Service Layer](service-layer.md) · [Data Class](data-class.md) · [Feature Envy](feature-envy.md) · [Business logic in helpers](business-logic-in-helpers.md) · [God object (The Blob)](god-object.md)

## Overlaps

Decide domain-model or transaction-script first: it is a choice per subdomain, not a ranking. Only then is anemic-domain-model a fault, when rich rules were wanted and ended up in services. data-class is the smell on one class, and is fine on boundary types.

## Sources

- [Martin Fowler, AnemicDomainModel (bliki, 2003)](https://martinfowler.com/bliki/AnemicDomainModel.html) (read)
- [Martin Fowler, PoEAA ch. 2, Organizing Domain Logic](https://martinfowler.com/books/eaa.html) (recalled)
- [Scott Wlaschin, Domain Modeling Made Functional (2018)](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/) (recalled)
