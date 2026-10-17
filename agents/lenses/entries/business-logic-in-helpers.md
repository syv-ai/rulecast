<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Business logic in helpers

`business-logic-in-helpers` · anti-patterns, design · **agents do this**

The rules of the domain live in functions in "utils", "helpers" or "common" modules instead of on the domain objects they are about, which are left as bare data. Close to the Anemic Domain Model.

*Matters most for:* fullstack-web, web-api

## But

In a functional or data-oriented style, rules as functions over plain data are the design, not a mistake; the problem there is only when they sit in a grab-bag module instead of one named after the domain. Truly generic helpers are fine. The test is whether a domain expert would recognise the rule.

## Quality axes

- **delivery** +: A helper file is the quickest place for a function when nobody wants to decide which class owns it.
- **change_cost** −: Domain rules scattered across grab-bag helper modules are hard to find, so they get duplicated and changed in one place but not the other.

**Flips:** In a functional or data-oriented codebase, rules as functions over plain data are the design, provided they sit in a module named for the domain.

## Why people fall into it

- A helper file is the quickest place to put a function when you don't want to decide which class owns it.
- Frameworks and ORMs that generate plain data models make adding behaviour to them feel off-limits.
- A function that started as formatting or conversion slowly picks up rules.

## How it shows

- utils or helpers modules that import domain entities and branch on their fields
- domain classes with only fields and accessors, while functions elsewhere take them as the first argument
- the same business rule computed by two different helpers in different places
- helper names that are really domain verbs, such as calculate_discount or is_eligible

## Overcorrecting looks like

- Pushing infrastructure into entities, such as database or HTTP calls inside a domain object.
- Moving genuinely generic code (string padding, date maths) onto a domain class where it doesn't belong.

## What to do

Move Method onto the entity or value object the rule is about, or Extract Class for a domain service when the rule spans several.

## Example

Before:

```
# utils.py
fn loyalty_points(member: Member, purchase: Purchase) -> int:
    points = floor(purchase.total / 10)
    if member.tier == "gold":
        points = points * 2
    if member.joined_days < 30:
        points = points + WELCOME_BONUS
    return points

class Member:
    tier: str
    joined_days: int
```

After:

```
class Member:
    tier: str
    joined_days: int

    fn points_for(purchase: Purchase) -> int:
        points = floor(purchase.total / 10)
        if self.tier == "gold":
            points = points * 2
        if self.joined_days < 30:
            points = points + WELCOME_BONUS
        return points
```

The loyalty rule moves onto the member it is about, so there is one place to find and change it.

## Related

[Feature Envy](feature-envy.md) · [Drifting terminology](drifting-terminology.md) · [Functional decomposition](functional-decomposition.md)

## Sources

- [Fowler, AnemicDomainModel (2003)](https://martinfowler.com/bliki/AnemicDomainModel.html) (recalled)
