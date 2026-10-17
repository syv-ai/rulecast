<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Switch Statements

`switch-statements` · smells, code · **contested** · **agents do this**

A switch or if-else chain on the same type code shows up in several places, so adding a case means finding and editing every copy.

*Names:* Fowler's 2nd edition renames it Repeated Switches and aims it at the duplicated switch rather than at every conditional.

*Matters most for:* compilers-tooling, platforms, tui

## But

One switch in one place, especially in a factory or at a parsing boundary, is normal. The expression problem cuts both ways: polymorphism makes new types cheap and new operations expensive, while a switch makes new operations cheap. In languages with sum types and exhaustive matching, the compiler finds every switch that misses a new case, which removes most of the risk the smell is about. Data-oriented and functional programmers often prefer the switch.

## Quality axes

- **delivery** +: Adding another branch is the smallest change that handles the new case.
- **change_cost** −: Adding a case means finding and editing every switch on the same type code.
- **reliability** −: A switch missed when adding a case silently falls through to the wrong branch or the default.

**Flips:** With sum types and exhaustive matching the compiler finds every switch that misses a case, and when operations grow faster than variants the switch is the cheaper design.

## Why people fall into it

- Adding another branch is the smallest change that handles the new case.
- Behaviour depends on a type code read from the database or an API.
- Polymorphism means designing a hierarchy, and a deadline doesn't allow it.

## How it shows

- The same variable (type, kind, plan, status) switched on in several functions.
- Long if-elif chains comparing one value against many literals.
- A switch whose cases each call the same method with different arguments.
- A null check repeated before each use of an optional collaborator.

## Overcorrecting looks like

- Turning a single, simple switch into a class hierarchy.
- Replacing a switch in a factory, which is where choosing a class belongs.
- Splitting behaviour across subclasses when the set of variants is fixed but the set of operations keeps growing.

## What to do

Extract Method and Move Method so the switch lives with the data it switches on. Replace Type Code with Subclasses or with State/Strategy, then Replace Conditional with Polymorphism. Replace Parameter with Explicit Methods when every case calls one method with a different argument. Introduce Null Object for a null case.

## Example

Before:

```
fn monthly_price(account) -> Money:
    if account.plan == "free": return Money(0)
    elif account.plan == "team": return Money(12) * account.seats
    elif account.plan == "enterprise": return account.contract_price

fn seat_limit(account) -> int:
    if account.plan == "free": return 3
    elif account.plan == "team": return 50
    elif account.plan == "enterprise": return account.contract_seats
```

After:

```
interface Plan:
    fn monthly_price(account) -> Money
    fn seat_limit(account) -> int

class FreePlan implements Plan:
    fn monthly_price(account): return Money(0)
    fn seat_limit(account): return 3

class TeamPlan implements Plan: ...
class EnterprisePlan implements Plan: ...
```

A new plan is one new class rather than another branch in every function that asks about plans.

## One-file tell

TypeScript, Java and C#, excluding generated code: a switch on the same expression in two or more functions of one file.

## By language

**rust:** Exhaustive match on an enum is idiomatic, and within the crate that defines the enum the compiler flags every match when a variant is added. That guarantee stops at `#[non_exhaustive]` enums from other crates, which require a wildcard arm. A wildcard that panics or quietly does nothing is then where new variants go to hide, so handle the unknown case deliberately.

**typescript:** A discriminated union with an exhaustiveness check (assigning to never) gives the same safety.

## Related

[Strategy](strategy.md) · [State](state.md) · [Primitive Obsession](primitive-obsession.md) · [Shotgun Surgery](shotgun-surgery.md) · [Factory Method](factory-method.md)

## Overlaps

switch-statements is the smell, and state and strategy are the two usual remedies: state when the switch is on an object's lifecycle, strategy when it chooses an algorithm. Exhaustive matching on a closed set is often better than either. open-closed-principle says when the switch is worth replacing at all: when others add cases, not when you own every one.

## Sources

- [Refactoring.Guru, Switch Statements](https://refactoring.guru/smells/switch-statements) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3, Repeated Switches](https://martinfowler.com/books/refactoring.html) (recalled)
