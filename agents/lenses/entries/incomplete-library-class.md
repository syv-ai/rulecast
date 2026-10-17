<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Incomplete Library Class

`incomplete-library-class` · smells, design

A library you depend on is missing something you need and you can't change its source, so the extra behaviour ends up scattered across callers.

*Names:* Fowler dropped it from the 2nd edition's list.

*Matters most for:* library-sdk, plugins-extensions

## But

If the extension would cost more than it saves, a small utility function is enough. Languages with extension methods or traits (C#, Kotlin, Rust, Swift) make the smell mostly disappear, since you can add the method without a wrapper. Fowler dropped it from the 2nd edition's list, along with the two refactorings that treated it.

## Quality axes

- **delivery** +: Patching the class at runtime or writing a local helper is quicker than wrapping it or contributing upstream.
- **change_cost** −: Missing behaviour is copied across callers or monkey-patched in, and both break or need redoing when the library changes.

## Why people fall into it

- The library's authors never added the feature or declined to.
- Forking or contributing upstream is slow.
- Patching the class at runtime looks like the shortest path.

## How it shows

- The same helper computation on a library type copied in several modules.
- Monkey-patching new methods onto a third-party class or module.
- Utility modules full of functions whose first parameter is always one library type.

## Overcorrecting looks like

- Wrapping a whole library in your own layer to add one function, and then maintaining that wrapper forever.
- Building a local extension when the next release of the library already adds the method.

## What to do

Introduce Foreign Method for one or two missing operations (a function in your code that takes the library object as its first argument). Introduce Local Extension (a wrapper or subclass you own) when you need more. Contributing upstream is the long-term fix.

## Example

Before:

```
import datelib

fn settlement_date(trade_date: datelib.Date) -> datelib.Date:
    d = trade_date.add_days(1)
    while d.weekday() >= 5 or d in HOLIDAYS:
        d = d.add_days(1)
    return d

fn invoice_due(issued: datelib.Date) -> datelib.Date:
    d = issued.add_days(1)
    while d.weekday() >= 5 or d in HOLIDAYS:
        d = d.add_days(1)
    ...
```

After:

```
import datelib

# foreign method: datelib.Date has no business-day support
fn next_business_day(d: datelib.Date) -> datelib.Date:
    d = d.add_days(1)
    while d.weekday() >= 5 or d in HOLIDAYS:
        d = d.add_days(1)
    return d

fn settlement_date(trade_date) -> datelib.Date:
    return next_business_day(trade_date)
```

The missing operation lives in one function of your own, labelled as such, instead of in every caller.

## One-file tell

Assignments onto attributes of an imported third-party class or module (monkey-patching).

## By language

**csharp:** Extension methods are the idiomatic Introduce Foreign Method.

**rust:** An extension trait implemented for the foreign type does the same job, within the orphan rule.

**python:** Monkey-patching a library class is the shortcut to avoid; a module of functions or a thin wrapper is the usual fix.

## Related

[Adapter](adapter.md) · [Decorator](decorator.md) · [Facade](facade.md)

## Sources

- [Refactoring.Guru, Incomplete Library Class](https://refactoring.guru/smells/incomplete-library-class) (read)
- [Martin Fowler, Refactoring (1st ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
