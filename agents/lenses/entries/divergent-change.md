<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Divergent Change

`divergent-change` · smells, code

One class keeps getting edited for unrelated reasons, so changes about different concerns all land in the same place. It is the mirror image of Shotgun Surgery.

*Matters most for:* fullstack-web, web-api

## But

Two kinds of change that always ship together are one reason to change, not two. Judge by the actual history, not by imagined future changes, and don't split a small, stable class because its methods could in principle change for different reasons. It sits in tension with Shotgun Surgery: the goal is one place per kind of change, not the smallest possible classes.

## Quality axes

- **delivery** +: Adding a method to the existing class needs no design decision.
- **change_cost** −: Unrelated concerns share one class, so each edit risks breaking another concern and changes collide.

## Why people fall into it

- New behaviour gets added where related-looking code already lives.
- A class named after a domain noun attracts every feature that mentions that noun.
- Splitting a class needs a design decision, adding a method doesn't.

## How it shows

- Git history where one file is touched by commits about many unrelated topics (pricing, formatting, storage).
- A class whose methods split into clusters that use disjoint fields and imports.
- Adding one kind of thing (a new product type, a new database) requires editing several unrelated methods in the same class.

## Overcorrecting looks like

- Splitting so finely that one change now has to touch many small classes, which is Shotgun Surgery.
- Splitting along concerns that in practice always change together.

## What to do

Extract Class to give each concern its own home. If the concerns form variants of one behaviour, Extract Superclass or Extract Subclass. At module scale, separate phases (parse, then compute, then render) so each changes on its own.

## Example

Before:

```
class Course:
    fn tuition(student) -> Money:
        ... discounts, residency rules, scholarships

    fn transcript_line() -> str:
        ... formatting, grade symbols, padding

    fn save(db):
        ... columns, upsert, migration quirks
```

After:

```
class TuitionPolicy:
    fn tuition(course, student) -> Money: ...

class TranscriptFormatter:
    fn line(course) -> str: ...

class CourseRepository:
    fn save(course): ...
```

Fee rules, transcript layout and storage change for different reasons and now change in different places.

## Related

[Shotgun Surgery](shotgun-surgery.md) · [Large Class](large-class.md) · [SOLID](solid.md) · [God object (The Blob)](god-object.md)

## Overlaps

single-responsibility-principle is the principle: one reason to change per module. divergent-change is the smell when it is broken one way (one module changes for many reasons), shotgun-surgery when it is broken the other way (one reason to change touches many modules). Use the smells to find it in code.

## In the interview

- [Spend the interview where the work is.](../THINKING.md#find-where-changes-concentrate)

## Sources

- [Refactoring.Guru, Divergent Change](https://refactoring.guru/smells/divergent-change) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
