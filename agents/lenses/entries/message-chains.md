<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Message Chains

`message-chains` · smells, design

A client walks a chain of objects to reach the one it wants, so it depends on the whole path between them. This is what the Law of Demeter forbids.

## But

Chains over the same type, such as builders, stream or query APIs, and string operations, are not this smell. Navigating plain data structures (a parsed JSON document, a config tree) is often fine because the structure is the published contract. Hiding every delegate trades this smell for Middle Man.

## Quality axes

- **delivery** +: Navigating through getters is the obvious way to reach the data now, with no decision about who owns the question.
- **change_cost** −: The caller depends on every object along the path, so restructuring any of them breaks callers far away.

## Why people fall into it

- The data the client needs sits several objects away, and navigating is the obvious way to reach it.
- Getters on every object make any path reachable.
- Adding a method to the start of the chain means deciding who owns the question.

## How it shows

- Calls like a.b().c().d() where each step returns a different object.
- The same navigation path repeated at several call sites.
- Temporary variables that each hold the next object along a path.

## Overcorrecting looks like

- Adding a forwarding method at every hop, until the classes are mostly delegation (Middle Man).
- Treating fluent builders, query builders and pipelines as chains; they return the same kind of object at each step.

## What to do

Hide Delegate so the client talks to its immediate neighbour. Better, ask why the client needs the end object, Extract Method for what it does with it, and Move Method that to the start of the chain.

## Example

Before:

```
fn print_header(ticket):
    city = ticket.event().venue().address().city
    tz = ticket.event().venue().timezone()
    print(city + " " + ticket.event().starts_at.local(tz))
```

After:

```
class Event:
    fn location_line() -> str:
        return self.venue.city() + " " + self.starts_at.local(self.venue.timezone())

fn print_header(ticket):
    print(ticket.event().location_line())
```

The event answers the question about its own venue, so the printer no longer depends on venue and address.

## One-file tell

The same navigation path of three or more getter calls or attribute hops through objects (a.b().c().d()) repeated at three or more call sites in one file, ignoring module and package paths.

## Related

[Law of Demeter](law-of-demeter.md) · [Middle Man](middle-man.md) · [Inappropriate Intimacy](inappropriate-intimacy.md)

## Overlaps

law-of-demeter is the principle, message-chains is how a break shows, and middle-man is what over-applying it produces. Read all three before recommending either direction.

## Sources

- [Refactoring.Guru, Message Chains](https://refactoring.guru/smells/message-chains) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
