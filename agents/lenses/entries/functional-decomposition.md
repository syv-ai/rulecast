<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Functional decomposition

`functional-decomposition` · anti-patterns, design · **contested**

Procedural code in object-oriented clothing, where classes are named after functions, each holds one routine, and the data travels between them as bare records.

## But

In functional and data-oriented styles, functions over plain data are the intended design, and many argue it is clearer than objects. The anti-pattern is the mismatch: classes used as namespaces for single functions in a codebase that claims to be object-oriented. Single-method classes are also fine when they are Commands or Strategies that get passed around.

## Quality axes

- **change_cost** −: Rules sit in verb-named classes away from the data they act on, so changing one concept means visiting several routines that pass bare records around.

**Flips:** In a functional or data-oriented style, plain functions over plain data are the intended design and can read better than objects.

## Why people fall into it

- Developers trained in procedural design moving to an object-oriented language.
- Designing by listing steps in a process instead of by the things the steps act on.

## How it shows

- data classes with no behaviour while the rules about them sit in separate verb-named classes

## Overcorrecting looks like

- Forcing objects onto code that is naturally a pipeline of transformations, where plain functions read better.

## What to do

Group the routines with the data they work on into classes (Move Method, Extract Class), or drop the classes and use plain functions.

## Example

Before:

```
class LeaseRecord:
    monthly_rent: Money
    start: Date
    end: Date

class CalculateLeaseTotal:
    fn run(lease: LeaseRecord) -> Money:
        return lease.monthly_rent * months_between(lease.start, lease.end)

class ValidateLease:
    fn run(lease: LeaseRecord) -> bool:
        return lease.end > lease.start
```

After:

```
class Lease:
    monthly_rent: Money
    start: Date
    end: Date

    fn total() -> Money:
        return self.monthly_rent * months_between(self.start, self.end)

    fn is_valid() -> bool:
        return self.end > self.start
```

The routines join the data they act on, so Lease is an object with behaviour rather than a record passed through verb classes.

## Related

[Business logic in helpers](business-logic-in-helpers.md) · [Poltergeist](poltergeist.md) · [God object (The Blob)](god-object.md) · [Data Class](data-class.md)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Functional Decomposition (recalled)
