<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# SOLID

`solid` · principles, design · **contested**

Robert C. Martin's name for five object-oriented design principles, each an entry of its own here: single responsibility, open/closed, Liskov substitution, interface segregation and dependency inversion. Use this entry when a project names SOLID as a whole; judge code against the five.

*Names:* Martin set out the principles in papers and books from 1995 to 2002; Michael Feathers coined the acronym around 2004.

## But

Over-applied as a set it produces an interface for every class and many tiny indirections. Dan North's CUPID and others argue for simpler, property-based goals, and much of SOLID targets class-heavy object-oriented code: in functional or procedural code some of the five map loosely or not at all. A project that says it follows SOLID usually means one or two of them; ask which.

## Quality axes

- **change_cost** ⊕ (primary): Taken together, the five principles keep changes local, keep new cases out of working code and keep implementations swappable and testable.
- **delivery** −: More interfaces, smaller classes and wiring to set up before the feature works.

**Flips:** Over-applied as a set, you get an interface for every class and a factory for every interface, so each change touches four files and change_cost turns "-". In functional or procedural code several of the five barely apply.

## Overdone when

- An interface for every class and a factory for every interface, so each change touches four files.

## By language

**python:** Duck typing and protocols cover much of interface segregation and dependency inversion without declared interfaces; abstract base classes for every dependency are usually overkill.

**go:** Small implicit interfaces defined by the consumer give interface segregation and dependency inversion almost for free; inheritance-based open/closed and Liskov apply less.

## Related

[Single Responsibility Principle (SRP)](single-responsibility-principle.md) · [Open/Closed Principle (OCP)](open-closed-principle.md) · [Liskov Substitution Principle (LSP)](liskov-substitution-principle.md) · [Interface Segregation Principle (ISP)](interface-segregation-principle.md) · [Dependency Inversion Principle (DIP)](dependency-inversion-principle.md) · [YAGNI](yagni.md)

## Sources

- [Milanović, Laws of Software Engineering, SOLID Principles](https://lawsofsoftwareengineering.com/laws/solid-principles/) (read)
- [Robert C. Martin, Agile Software Development, Principles, Patterns, and Practices (2002)](https://www.oreilly.com/library/view/agile-software-development/0135974445/) (recalled)
- [Dan North, CUPID, for joyful coding (2022)](https://dannorth.net/blog/cupid-for-joyful-coding/) (recalled)
