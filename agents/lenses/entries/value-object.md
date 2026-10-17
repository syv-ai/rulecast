<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Value Object

`value-object` · design patterns, design

A small immutable object defined only by its attributes, with no identity, that carries the meaning and rules of a domain value such as an amount with its currency, a date range or a dose with its unit.

*Names:* Also called Value type. Eric Evans, Domain-Driven Design (2003), ch. 5. Fowler's earlier enterprise writing and his bliki entry ValueObject describe the same idea; the name was in use in the Java world before, there sometimes meaning a transfer object, which is a different thing. Early J2EE literature used "Value Object" for what is now called a Data Transfer Object; that meaning is obsolete.

*Matters most for:* web-api, fullstack-web, library-sdk, scientific, data-pipeline

## But

Wrapping costs something. In hot loops or bulk data work, millions of small objects can cost allocation and memory in languages without real value types, and columnar or array code is often better with plain numbers and a documented unit. Mapping them to a database can be awkward with some ORMs. Not every string needs a type; wrap the ones that have rules, units or a format, and leave free text alone. This is the usual cure for Primitive Obsession, so overdoing it is the overcorrection of that smell.

## Quality axes

- **reliability** ⊕ (primary): Validation in the constructor means an invalid value can't exist, and units or currencies can't be mixed by accident.
- **change_cost** +: Validation and formatting for a kind of value live in one type instead of being repeated.
- **delivery** −: Each value kind needs its own type, constructor and ORM mapping, which some ORMs make awkward.

**Flips:** In hot loops or bulk numeric work, millions of small objects cost allocation and memory in languages without real value types (runtime "-"); wrapping every primitive, including ones with no rules, turns simple code into chains of conversions and raises change_cost.

## Warranted when

- The same raw string or number travels with an implied unit, currency or format, and bugs come from mixing them.
- Validation and formatting of one kind of value are repeated in several places.
- Two values that look equal must be equal, and nobody cares which instance is which.
- Shared mutable objects get changed by one holder and surprise another.

## How it shows

- Small immutable types (Money, Percentage, EmailAddress, DateRange, Quantity) with value-based equality.
- Validation in the constructor or factory, so an invalid value can't exist.
- Operations that return a new value instead of changing the old one (add, convert, overlaps).
- Entities whose fields are these types rather than raw strings and numbers.

## Overdone when

- Wrapping every primitive in its own class, including ones that carry no rules (a free-text note).
- Value objects so fine-grained that simple code becomes a chain of conversions.
- Value objects that are mutable or carry an id, which makes them entities in disguise.

## Example

Before:

```
fn total_dose(doses: list) -> float:
    total = 0.0
    for d in doses:
        total += d.amount          # d.unit may be "mg" or "mcg"
    return total

fn record_dose(patient, amount: float, unit: str):
    if amount <= 0: raise Invalid
    if unit not in ["mg", "mcg"]: raise Invalid
    patient.doses.append(...)
```

After:

```
class Dose:                        # immutable, equal by value
    amount: Decimal
    unit: Unit

    fn create(amount, unit) -> Dose:
        if amount <= 0: raise Invalid
        return Dose(amount, unit)

    fn plus(other: Dose) -> Dose:
        return Dose(self.amount + other.in_unit(self.unit).amount, self.unit)

fn total_dose(doses: list) -> Dose: return doses.reduce(Dose.plus)
```

The unit travels with the amount and validation lives in one place, so adding milligrams to micrograms can no longer happen silently.

## By language

**python:** A @dataclass(frozen=True) gives immutability and value equality and hashing; validate in __post_init__. NamedTuple works for very small ones. Freezing is shallow, so a list field can still be changed; use a tuple.

**typescript:** There are no nominal types, so type Email = string adds no safety. Use a class with a private constructor and a static create, or a branded type. Objects compare by reference, so give value objects an equals method. readonly is compile-time only; Object.freeze if it matters at runtime.

**java:** Records (Java 16 and later) are the natural fit: final fields, value-based equals and hashCode, validation in the compact constructor. Hibernate 6.2 and later can map records as @Embeddable. They are still heap objects until Project Valhalla's value classes land.

**csharp:** record and readonly record struct give value equality for free. EF Core maps them as owned types or, from EF Core 8, complex types. Older DDD-style .NET code uses a ValueObject base class with GetEqualityComponents; records make that mostly unnecessary.

**go:** Structs whose fields are all comparable already compare by value with ==, and passing by value avoids shared mutation. Go can't enforce immutability, so keep fields unexported and construct through a NewX function that returns an error for invalid input.

**rust:** A newtype or small struct with private fields, derived Clone, PartialEq, Eq and Hash, and a constructor returning Result. Copy for small ones. The compiler then keeps a Meters from being passed as Seconds.

## Related

[Primitive Obsession](primitive-obsession.md) · [Entity](entity.md) · [Data Clumps](data-clumps.md) · [Over-Engineering](over-engineering.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Value Objects](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 5](https://www.domainlanguage.com/ddd/) (recalled)
- [Martin Fowler, bliki, ValueObject](https://martinfowler.com/bliki/ValueObject.html) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 6 (recalled)
