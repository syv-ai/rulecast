<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Data Class

`data-class` · smells, design · **contested**

A class holds only fields and accessors, while the logic that works on that data lives in the classes that use it.

*Matters most for:* fullstack-web, web-api

## But

Plain data is right at boundaries: API payloads, events, config, rows read from a database, and immutable records passed through a pipeline. Functional and data-oriented styles deliberately separate data from functions, and Fowler himself says immutable records from a split phase are fine. It is the anemic domain model, where core business entities are mere bags, that the smell is aimed at.

## Quality axes

- **delivery** +: A plain bag of fields is the natural first shape and what ORMs and serialisers produce.
- **change_cost** −: Logic about the data is spread over the classes that use it and repeated there, so one rule change means finding every client.

**Flips:** At boundaries (API payloads, events, config, rows) and in immutable pipeline records, plain data is the right shape.

## Why people fall into it

- It is the natural first shape of a new class, and nobody went back to move the behaviour in.
- ORMs, serializers and frameworks that generate or expect plain field bags.
- A layered style that puts all logic in services and keeps entities anemic.

## How it shows

- A class of public fields or getter/setter pairs with no other methods.
- Several client functions computing the same thing from that class's fields.
- Setters used freely from outside after construction.

## Overcorrecting looks like

- Pushing behaviour into DTOs, messages and records whose job is to cross a boundary.
- Giving a value type methods that depend on services, databases or I/O.

## What to do

Encapsulate Field and Encapsulate Collection, then find the client logic that uses the fields and bring it in with Extract Method and Move Method. Once behaviour lives there, Remove Setting Method and Hide Method to narrow the surface.

## Example

Before:

```
class Loan:
    book_id: str
    due_date: Date
    returned_on: Date | None

fn overdue_fee(loan: Loan, today: Date) -> int:
    end = loan.returned_on or today
    days = (end - loan.due_date).days
    return max(days, 0) * 25
```

After:

```
class Loan:
    book_id: str
    due_date: Date
    returned_on: Date | None

    fn days_overdue(today: Date) -> int:
        end = self.returned_on or today
        return max((end - self.due_date).days, 0)

    fn overdue_fee(today: Date) -> int:
        return self.days_overdue(today) * 25
```

The fee logic moved next to the dates it reads, so every caller gets the same rule.

## By language

**python:** A dataclass or NamedTuple is not a smell on its own. Look at whether functions elsewhere keep reaching into its fields to compute the same thing.

**java:** Records are meant to be data carriers. The smell is mutable beans whose logic sits in a service layer.

## Related

[Feature Envy](feature-envy.md)

## Overlaps

Decide domain-model or transaction-script first: it is a choice per subdomain, not a ranking. Only then is anemic-domain-model a fault, when rich rules were wanted and ended up in services. data-class is the smell on one class, and is fine on boundary types.

## Sources

- [Refactoring.Guru, Data Class](https://refactoring.guru/smells/data-class) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
- [Martin Fowler, AnemicDomainModel (bliki)](https://martinfowler.com/bliki/AnemicDomainModel.html) (recalled)
