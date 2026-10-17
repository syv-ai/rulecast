<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# God object (The Blob)

`god-object` · anti-patterns, design · **agents do this**

One class holds most of the control and data that should be spread across several, so every change goes through it. Brown et al. call it The Blob; Large Class is the smell it shows up as.

*Matters most for:* mobile, games, desktop, fullstack-web, web-frontend, tui

## But

A composition root or application wiring module is meant to know about everything, and that is fine as long as it only wires and holds no rules. A small program or script with one class doing one job is not a God object just because it is the only class. Size alone isn't the test: a long class with one reason to change is a long class.

## Quality axes

- **delivery** +: Adding one more method to the class that already holds the data is the quickest way to ship the next feature.
- **change_cost** −: Every change goes through one class, so unrelated edits collide, it can't be tested in parts, and a change to one cluster risks the others.

## Why people fall into it

- Each new feature is small, and the class that already knows the related data is the easiest place to put it.
- Under a deadline, adding a method beats deciding where a new class should go and what it owns.
- Procedural habits carried into an object-oriented codebase put one controller in charge and leave the rest as records.

## How it shows

- one class or module that most other files import, and that turns up in most commits
- a class whose methods fall into clusters that share no fields with each other
- names like Manager, Controller, System or Service that cover a whole area of the product
- small satellite classes that are only data, with the logic for them all living in the big one

## Overcorrecting looks like

- Splitting until every class has two methods and following any behaviour means opening ten files (over-modularization).
- Breaking a class apart by method count instead of by reason to change, so things that always change together end up in different places.

## What to do

Extract Class along the clusters of fields and methods that change together; Move Method to the data the method uses.

## Example

Before:

```
class ClinicManager:
    appointments: list
    invoices: list
    sms_gateway: SmsGateway

    fn book(patient, slot): ...
    fn cancel(appointment_id): ...
    fn bill(appointment_id) -> Invoice: ...
    fn apply_insurance(invoice, policy): ...
    fn send_reminder(appointment_id): ...
    fn monthly_revenue_report() -> Report: ...
```

After:

```
class Schedule:
    appointments: list
    fn book(patient, slot): ...
    fn cancel(appointment_id): ...

class Billing:
    invoices: list
    fn bill(appointment) -> Invoice: ...
    fn apply_insurance(invoice, policy): ...
    fn monthly_revenue_report() -> Report: ...

class Reminders:
    sms_gateway: SmsGateway
    fn send(appointment): ...
```

Each cluster of fields and the methods that use them becomes its own class, so a billing change no longer touches scheduling.

## Related

[SOLID](solid.md) · [Facade](facade.md) · [Mediator](mediator.md) · [Large Class](large-class.md) · [Divergent Change](divergent-change.md) · [Interface bloat (bloated interface)](interface-bloat.md) · [Functional decomposition](functional-decomposition.md)

## Overlaps

god-object is the design failure (one class owns too much of the control), large-class the visible symptom, and interface-bloat the failure seen from the clients that depend on it.

## In the interview

- [Spend the interview where the work is.](../THINKING.md#find-where-changes-concentrate)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), The Blob (recalled)
- [Wikipedia, Anti-pattern, In software engineering](https://en.wikipedia.org/wiki/Anti-pattern) (read)
