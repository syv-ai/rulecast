<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Inner-Platform Effect

`inner-platform-effect` · anti-patterns, design

A system made so configurable that it becomes a poor copy of the platform it runs on: a homemade database inside a database, a scripting language in JSON, a rules engine that only programmers can drive.

*Names:* Named by Alex Papadimoulis on The Daily WTF (2006), whose example was a "data structure modeler" storing tables, fields and types as rows. Related to the entity-attribute-value (EAV) anti-pattern in databases, Greenspun's tenth rule, and "softcoding" (also coined on The Daily WTF).

*Matters most for:* platforms, fullstack-web, plugin-host

## But

Some products really are platforms: CRMs with custom objects, low-code tools and form builders sell exactly this configurability, and it is designed, tested and documented as a product. Domain-specific languages are legitimate when the users are domain experts and the language is kept small. The anti-pattern is drifting into a general-purpose platform by accident, without the tooling (debugging, versioning, tests) the real platform already has.

## Quality axes

- **change_cost** −: Logic moved into rows, JSON and homemade languages loses the host language's types, tests, versioning and refactoring tools.
- **runtime** −: Entity-attribute-value tables and rules interpreted at runtime are much slower than the platform they imitate.
- **operability** −: Behaviour stored as data has no debugger or history, so production problems are hard to trace.

**Flips:** Products whose value is configurability (CRMs with custom objects, low-code tools, form builders), designed and tested as such, or a small DSL for domain experts, are platforms on purpose.

## Why people fall into it

- A wish to let non-programmers change behaviour without a release.
- Fear of hard-coding, misread as "everything must be configurable".
- Slow release cycles, which make configuration look faster than code.
- Requirements stated as "the customer must be able to define their own fields and rules".

## How it shows

- Tables named entity, attribute, field_definition or value that describe other tables.
- Configuration files with if, then, loop or expression keys interpreted at runtime.
- A visual workflow or rules editor that end users never use and developers edit through raw JSON.
- Business logic stored in the database as strings and evaluated.
- A homemade permission, query or template language with its own parser.

## Overcorrecting looks like

- Refusing any configuration, so every threshold, label or feature toggle needs a code change and deploy.
- Rejecting a real, well-scoped need for user-defined fields or rules that a mature engine or the database's JSON column handles well.

## What to do

Put the logic back in the host language and the host database, and shorten the release path so changing code is as cheap as changing configuration. Where users truly need extensibility, embed an existing language or engine (Lua, CEL, a JSON column, a mature rules engine) instead of inventing one.

## Example

Before:

```
# discount_rules.json, edited by developers only
[{"if": {"and": [{"field": "cart.total", "op": ">", "value": 100},
                 {"field": "customer.tier", "op": "==", "value": "gold"}]},
  "then": {"set": "discount", "expr": "cart.total * 0.1"}}]

fn apply_rules(cart, customer):
    for rule in load_json("discount_rules.json"):
        if evaluate(rule["if"], {"cart": cart, "customer": customer}):  # homemade interpreter
            execute(rule["then"], ...)
```

After:

```
fn discount(cart, customer) -> Money:
    if cart.total > 100 and customer.tier == GOLD:
        return cart.total * GOLD_DISCOUNT_RATE
    return 0
# GOLD_DISCOUNT_RATE stays in config; the logic is code, with tests and a debugger
```

The rule language rebuilt conditionals and arithmetic badly; plain code is shorter and tooling works on it, while only the true parameter stays configurable.

## Related

[Over-Engineering](over-engineering.md) · [Speculative Generality](speculative-generality.md) · [Second-System Effect](second-system-effect.md) · [Reinventing the wheel](reinventing-the-wheel.md) · [Misapplied Genericity](misapplied-genericity.md) · [Zawinski's Law](zawinskis-law.md)

## In the interview

- [When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it.](../THINKING.md#kept-for-what-it-does)

## Sources

- [Alex Papadimoulis, The Inner-Platform Effect, The Daily WTF (2006)](https://thedailywtf.com/articles/The_Inner-Platform_Effect) (read)
- Bill Karwin, SQL Antipatterns (2010), Entity-Attribute-Value (recalled)
