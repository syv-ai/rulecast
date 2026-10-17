<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Large Class

`large-class` · smells, code · **agents do this**

A class has grown too many fields, methods or lines because new features kept landing there. Taken to the extreme it becomes a God Object.

*Matters most for:* fullstack-web, desktop, mobile, games

## But

Size alone isn't the problem. A class that does one cohesive thing with many small methods, a generated client, or a thin composition root that wires many parts together can be large and fine. Ousterhout argues for deep modules, a lot of functionality behind a small interface, which a mechanical split can make worse. Judge by how many reasons it has to change.

## Quality axes

- **delivery** +: Adding a method to the class that already holds the data is the least effort.
- **change_cost** −: Every feature touches the same file, so changes collide and readers must understand far more than they need.

## Why people fall into it

- Adding a method to an existing class is less effort than creating a new one.
- The class is where the related data already lives.
- Splitting needs a decision about boundaries that nobody had time to make.

## How it shows

- A class with dozens of methods or fields, or a file that dominates the module by size.
- Groups of fields sharing a prefix or used only by a subset of methods.
- A class name ending in Manager, Service, Helper or Handler that every feature touches.
- Most commits in the area modify this one file.

## Overcorrecting looks like

- Breaking a class into many tiny classes connected by delegation, so one feature is spread across them (Shotgun Surgery, Middle Man).
- Splitting by size alone when the class has one reason to change.

## What to do

Extract Class for a coherent group of fields and methods, Extract Subclass for behaviour only some instances need, and Extract Interface to define what each kind of client uses. For UI classes, move data and behaviour into a domain object.

## Example

Before:

```
class AppointmentManager:
    fn book(patient, slot): ...
    fn cancel(appointment): ...
    fn find_free_slots(doctor, day): ...
    fn bill_insurer(appointment): ...
    fn apply_copay(appointment): ...
    fn send_reminder_sms(appointment): ...
    fn send_reminder_email(appointment): ...
    ... 30 more
```

After:

```
class Scheduler:
    fn book(patient, slot): ...
    fn cancel(appointment): ...
    fn find_free_slots(doctor, day): ...

class AppointmentBilling:
    fn bill_insurer(appointment): ...
    fn apply_copay(appointment): ...

class Reminders:
    fn send(appointment, channel): ...
```

Scheduling, billing and reminders were three groups of methods sharing one name; each is now its own class.

## One-file tell

Python and C#: a class body over 500 lines, excluding generated code.

## Related

[God object (The Blob)](god-object.md) · [Divergent Change](divergent-change.md) · [Long Method](long-method.md) · [SOLID](solid.md)

## Overlaps

god-object is the design failure (one class owns too much of the control), large-class the visible symptom, and interface-bloat the failure seen from the clients that depend on it.

## Sources

- [Refactoring.Guru, Large Class](https://refactoring.guru/smells/large-class) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
