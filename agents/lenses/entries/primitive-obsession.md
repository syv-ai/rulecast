<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Primitive Obsession

`primitive-obsession` · smells, code · **agents do this**

Domain concepts such as money, ranges, ids, phone numbers and statuses are passed around as bare strings and numbers, so their rules are repeated wherever they are used.

*Matters most for:* web-api, platforms, fullstack-web, databases-storage

## But

Primitives are fine for values with no rules and no ambiguity, inside a small scope, or in throwaway scripts. Wrapper types have a cost in languages where they allocate or need serialization code. The modern form of the advice is "parse, don't validate" (Alexis King): convert at the boundary into a type that can't hold invalid values, rather than wrapping everything everywhere.

## Quality axes

- **delivery** +: Adding a str or int field is quicker than creating a type.
- **change_cost** −: A concept's rules are repeated wherever its raw value is used, so changing a rule means finding every copy.
- **reliability** −: Bare strings and numbers can hold invalid values, mix units or currencies, or be passed in the wrong order, and nothing catches it.
- **security** −: Untyped input is re-checked at each entry point instead of parsed once at the boundary, and the entry point that forgets the check lets malformed input through.

**Flips:** In throwaway scripts, small scopes and for values with no rules, primitives are fine; wrappers cost allocation or serialisation code in some languages.

## Why people fall into it

- Adding a field is quicker than creating a type.
- Values arrive as strings and numbers from JSON, forms and databases, and are passed on as they came.
- Small types look like over-engineering until the bugs pile up.

## How it shows

- Amounts as floats with a separate currency string next to them.
- Integer or string constants standing for roles, states or types, compared in many places.
- Dicts or arrays with string keys used as records.
- The same format check (email, postcode, ISO code) repeated at each entry point.
- Function signatures of several str or int parameters that are easy to pass in the wrong order.

## Overcorrecting looks like

- Wrapping every string and int, including values with no rules and one use, into its own class.
- Value types so heavy (with factories, interfaces and mappers) that nobody wants to add a new one.

## What to do

Replace Data Value with Object (Replace Primitive with Object in the 2nd edition). Replace Type Code with Class, Subclasses or State/Strategy for coded values. Introduce Parameter Object or Preserve Whole Object for groups of primitives in signatures. Replace Array with Object for arrays of mixed values. Parse once at the boundary into the type.

## Example

Before:

```
fn pledge(project, amount: float, currency: str):
    if currency not in ("EUR", "USD"): raise BadCurrency(currency)
    if amount <= 0: raise BadAmount(amount)
    project.total = project.total + convert(amount, currency, project.currency)

fn refund(backer, amount: float, currency: str):
    if currency not in ("EUR", "USD"): raise BadCurrency(currency)
    ...
```

After:

```
class Money:
    cents: int
    currency: Currency

    fn positive(cents: int, code: str) -> Money:
        if cents <= 0: raise BadAmount(cents)
        return Money(cents, Currency.parse(code))

fn pledge(project, amount: Money):
    project.total = project.total.plus(amount.converted_to(project.currency))

fn refund(backer, amount: Money): ...
```

The amount and its currency became one value checked once on creation, and floats stopped carrying money.

## One-file tell

Go, Python, Java and C#, not TypeScript: a field or variable named like status, role, type or kind compared against string or number literals in three or more places in one file.

## By language

**python:** NewType, small frozen dataclasses and Enum cover most cases cheaply.

**typescript:** Branded types and string-literal unions give the safety without a runtime wrapper.

**rust:** Newtypes are zero-cost and idiomatic.

**go:** Named types over primitives (type UserID string) are idiomatic and cheap.

## Related

[Data Clumps](data-clumps.md) · [Long Parameter List](long-parameter-list.md) · [Switch Statements](switch-statements.md) · [Lazy Class](lazy-class.md)

## Sources

- [Refactoring.Guru, Primitive Obsession](https://refactoring.guru/smells/primitive-obsession) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
- [Alexis King, Parse, don't validate (2019)](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) (recalled)
