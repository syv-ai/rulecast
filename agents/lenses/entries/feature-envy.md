<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Feature Envy

`feature-envy` · smells, design

A method uses another object's data more than its own, which suggests it lives in the wrong class.

*Matters most for:* fullstack-web, web-api

## But

Strategy and Visitor put behaviour outside the data on purpose so it can vary or be added without touching the data classes. Functional and data-oriented designs do the same by choice. Code that formats or persists an object often reads only that object's fields and still belongs outside it, so the object doesn't learn about every output format.

## Quality axes

- **delivery** +: Writing the method where the caller already is takes no decision about ownership.
- **change_cost** −: Behaviour lives away from the data it uses, so changing that data means finding methods in other classes.

**Flips:** Strategy, Visitor and formatting or persistence code keep behaviour outside the data on purpose, so the data class doesn't learn every output format.

## Why people fall into it

- The method was written where the caller happened to be.
- Data was split into its own class and the code using it wasn't moved along.
- A layered style that keeps logic in services and data in entities.

## How it shows

- A method that reads several fields or getters of one other object and few or none of its own.
- The same computation on another class's data repeated in several callers.
- Behaviour left behind in a service after the data moved into its own class.

## Overcorrecting looks like

- Moving behaviour into an entity that then depends on infrastructure (databases, HTTP, clocks).
- Pulling apart a deliberate Strategy or Visitor, which keeps behaviour away from data on purpose.

## What to do

Move Method to the class whose data it uses. If only part of the method is envious, Extract Method first and move that part. When it uses several classes, move it to the one holding most of the data, or split it.

## Example

Before:

```
class ParkingTicket:
    entered_at: Time
    garage: Garage

    fn fee(left_at: Time) -> Money:
        hours = ceil((left_at - self.entered_at).hours)
        if hours <= self.garage.free_hours:
            return Money(0)
        billable = min(hours - self.garage.free_hours, self.garage.daily_cap_hours)
        return self.garage.hourly_rate * billable
```

After:

```
class Garage:
    fn fee_for(hours: int) -> Money:
        if hours <= self.free_hours:
            return Money(0)
        billable = min(hours - self.free_hours, self.daily_cap_hours)
        return self.hourly_rate * billable

class ParkingTicket:
    fn fee(left_at: Time) -> Money:
        return self.garage.fee_for(ceil((left_at - self.entered_at).hours))
```

The tariff logic moved to the garage that owns the rates; the ticket only knows its own times.

## Related

[Data Class](data-class.md) · [Law of Demeter](law-of-demeter.md) · [Strategy](strategy.md) · [Visitor](visitor.md) · [Inappropriate Intimacy](inappropriate-intimacy.md)

## Sources

- [Refactoring.Guru, Feature Envy](https://refactoring.guru/smells/feature-envy) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
