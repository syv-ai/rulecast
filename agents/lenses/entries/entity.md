<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Entity

`entity` · design patterns, design

A domain object defined by a lasting identity rather than by its attributes, so it stays the same thing while its data changes, and two with the same data can still be different things.

*Names:* Also called Reference Object. Eric Evans, Domain-Driven Design (2003), ch. 5, as one of the model's building blocks.

*Matters most for:* web-api, fullstack-web, databases-storage

## But

In CRUD code an ORM row with a primary key is enough, and calling it an entity adds vocabulary without adding design. The pattern earns its keep where identity rules are subtle: matching across systems, merges, a lifecycle with rules. Functional designers often model an entity as an id plus a series of immutable state snapshots rather than a mutable object, which keeps the identity idea but drops the mutation. Equality by id is debated in ORM-heavy code, because a new object has no id until it is saved. Using the entity pattern without the strategic side of DDD is what Vaughn Vernon calls DDD-Lite: the building blocks without the bounded contexts that make them pay.

## Quality axes

- **reliability** ⊕ (primary): Equality, lookups and merges go by a lasting id, so two different things with the same data are never confused or merged.
- **delivery** −: Identity rules, id-based equality and lifecycle methods take more design than a row with a primary key.

**Flips:** In CRUD code an ORM row with a key is enough, and giving ids to mere descriptions (addresses, amounts) or writing getter-setter entities adds vocabulary without design.

## Warranted when

- The domain experts talk about one thing that persists through changes, such as an employee whose name, grade and address all change.
- Two records with identical attributes must still be told apart, or one record must be matched across systems and representations.
- Mistaken identity would corrupt data, such as merging two people because they share a name.
- The object has a lifecycle with rules about which state changes are allowed.

## How it shows

- A class with an id field whose equality and hashing use only that id.
- Methods that change state over a lifecycle (activate, suspend, close) rather than setters for every field.
- Lookups and merges done by id, never by comparing names or other attributes.
- An identity that is assigned once (by the system, a sequence or an outside authority) and never changes.

## Overdone when

- Giving an id to everything, including things that are only descriptions (an address, a date range, an amount), which is what value objects are for.
- Treating every database row with a surrogate key as an entity in the model, even when nothing tracks it over time.
- Entities that are bags of getters and setters with the rules held in services, which is Fowler's anemic domain model.

## Example

Before:

```
class Employee:
    name: str
    birth_date: Date
    grade: str

fn find_existing(staff: list, incoming: Employee) -> Employee:
    for e in staff:
        if e.name == incoming.name and e.birth_date == incoming.birth_date:
            return e      # two different people can match
    return null
```

After:

```
class Employee:
    id: EmployeeId        # assigned once by HR, never reused
    name: str
    birth_date: Date
    grade: str

    fn equals(other) -> bool: return self.id == other.id
    fn promote(new_grade: str): ...

fn find_existing(staff: list, incoming_id: EmployeeId) -> Employee:
    return staff.first(e -> e.id == incoming_id)
```

Identity becomes explicit and attributes may change freely, so matching never confuses two people who share a name and birthday.

## By language

**python:** A plain @dataclass compares every field, so two snapshots of the same entity compare unequal. Use eq=False and define __eq__ and __hash__ on the id, or keep entities as ordinary classes. Pydantic and SQLAlchemy models have their own equality rules; check them before relying on ==.

**typescript:** Objects compare by reference with ===, so identity checks are written as a.id === b.id or an equals method. A branded id type (string plus a brand) keeps a CustomerId from being passed where an OrderId is expected, since structural typing alone would allow it.

**java:** A JPA @Entity's equals and hashCode are the classic trap. A generated id is null before persist, so equality on it alone breaks collections; the usual advice is a natural business key or an id check that handles null. Records cannot be JPA entities.

**csharp:** EF Core entities are classes with a key; records are a poor fit because their value equality fights identity. A shared base class with Id-based Equals is common in DDD-style .NET code.

**go:** Entities are usually pointer types with an ID field, compared by ID rather than with == on the struct, since == on structs compares every field.

**rust:** Derive PartialEq only if equality really means same id; often implement it by hand on the id, or don't implement it and compare ids explicitly. A newtype id (struct OrderId(Uuid)) keeps ids of different entities apart.

## Related

[Value Object](value-object.md) · [Aggregate](aggregate.md) · [Data Class](data-class.md) · [Primitive Obsession](primitive-obsession.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Entities](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 5](https://www.domainlanguage.com/ddd/) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 1 (DDD-Lite) and ch. 5 (recalled)
- [Martin Fowler, bliki, AnemicDomainModel](https://martinfowler.com/bliki/AnemicDomainModel.html) (recalled)
