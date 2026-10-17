<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Single Responsibility Principle (SRP)

`single-responsibility-principle` · principles, design · **contested**

A module should have one reason to change, meaning it answers to one group of people or one concern. Code that changes for different reasons, at different times, belongs in different modules.

*Names:* Robert C. Martin's restatement of David Parnas's and Larry Constantine's ideas on decomposition and cohesion (1972 to 1979); Martin later rephrased it as "a module should be responsible to one, and only one, actor". The S in SOLID.

*Matters most for:* web-api, fullstack-web, web-frontend

## But

"Responsibility" and "reason to change" are judgement calls, and two careful people split the same class differently; Martin himself rephrased the principle twice. Dan North argues for code that does one thing well as a property to aim at rather than a rule. Splitting has a cost too: more names, more indirection, and changes that now touch several files. Cohesion is the older and plainer test: things that change together stay together.

## Quality axes

- **change_cost** ⊕ (primary): Code that changes for different reasons sits in different modules, so a billing change can't break reporting, and fewer changes conflict when merged.
- **delivery** −: Splitting a module along its reasons to change takes design work, new names and wiring now.

**Flips:** Splitting along every verb scatters one feature across many one-method classes, so each change touches several files and change_cost turns "-".

## Warranted when

- Two teams or two kinds of request (reporting and billing, say) changing the same module.
- Merge conflicts and regressions in code nobody meant to touch.
- A module that can't be tested without standing up a database, a network client and a clock.

## How it shows

- A class whose methods split into groups that touch different fields and different collaborators (rendering, persistence, pricing).
- One file that changes in almost every pull request, for unrelated reasons.
- Names with "And", "Manager", "Util" or "Helper" that hide several jobs.
- Business rules and their storage or transport in the same function.

## Overdone when

- Splitting along every verb, so one feature is spread across many one-method classes that only make sense together.
- Reading "one thing" as "one function", which says nothing about reasons to change.

## Example

Before:

```
class Invoice:
    fn total(): ...                 # pricing rules: changed by finance
    fn to_pdf(): ...                # layout: changed by design
    fn save(): db.insert(...)       # storage: changed by the platform team
    fn email(to): smtp.send(...)
```

After:

```
class Invoice:
    fn total(): ...

fn render_pdf(invoice: Invoice) -> bytes: ...
class InvoiceStore:
    fn save(invoice: Invoice): ...
fn send_invoice(invoice: Invoice, to: Address): ...
```

Each part now changes for one group's reasons, and pricing can be tested without a database or SMTP.

## By language

**python:** Modules are the natural unit; a module of functions with one concern is often better than a class with many. Watch for models that also serialise, validate and send email.

**typescript:** React components that fetch, transform and render are the common case; hooks and plain functions are the usual split.

**java:** Service classes that grow to dozens of injected dependencies are the sign; the constructor's parameter list counts the responsibilities.

**csharp:** As in Java, a constructor with many injected services; partial classes can hide the size without fixing it.

**go:** Packages are the unit; a package named util or common that everything imports is where unrelated reasons to change collect.

## Related

[SOLID](solid.md) · [Divergent Change](divergent-change.md) · [Large Class](large-class.md) · [God object (The Blob)](god-object.md) · [Shotgun Surgery](shotgun-surgery.md)

## Overlaps

single-responsibility-principle is the principle: one reason to change per module. divergent-change is the smell when it is broken one way (one module changes for many reasons), shotgun-surgery when it is broken the other way (one reason to change touches many modules). Use the smells to find it in code.

## Sources

- [Robert C. Martin, The Single Responsibility Principle (2014)](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html) (recalled)
- [David L. Parnas, On the Criteria To Be Used in Decomposing Systems into Modules, CACM (1972)](https://dl.acm.org/doi/10.1145/361598.361623) (recalled)
- [Dan North, CUPID, for joyful coding (2022)](https://dannorth.net/blog/cupid-for-joyful-coding/) (recalled)
