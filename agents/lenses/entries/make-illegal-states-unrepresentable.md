<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Make Illegal States Unrepresentable

`make-illegal-states-unrepresentable` · principles, design

Shape your types so that combinations of data that can't happen in the domain can't be built at all. Usually this means a closed set of variants (a sum type or discriminated union), each carrying only the fields that make sense for it, instead of one record with a status flag and a pile of optional fields.

*Names:* The phrase is Yaron Minsky's, from his Effective ML talk and the Jane Street post Effective ML Revisited (2011). Scott Wlaschin's Domain Modeling Made Functional (2018) spread it beyond ML languages.

*Matters most for:* web-frontend, fullstack-web, tui, compilers-tooling, library-sdk, web-api

## But

Not every invariant is worth a type. Rules that change often, depend on data in other records or come from configuration belong in runtime checks, and forcing them into types makes the model rigid. Closed unions also fight extensibility: if plugins or other teams must add variants, an open interface is the right shape (the expression problem). At boundaries the data arrives untyped anyway, so the principle works together with parsing at the edge (parse-dont-validate). Storage and wire formats usually flatten the union back into nullable columns or optional fields, so the mapping code has to be written and tested.

## Quality axes

- **reliability** ⊕ (primary): Impossible combinations, such as a finished upload with no url, can't be built, so the code can't act on them.
- **change_cost** +: Adding a state turns every place that must handle it into a compile error, instead of a hunt for every if on the status field.
- **delivery** −: Variant types, exhaustive matches and the mapping to flat storage and wire formats are extra code to write and test.

**Flips:** When rules that change often, or depend on other records or configuration, are forced into types, the model goes rigid and change_cost turns "-". Closed unions at an extension point block others from adding variants.

## Warranted when

- Bugs where an object was in a state the code assumed impossible (a paid order with no payment id).
- Code that checks for null on fields that "should" be set in the current state.
- A type that keeps gaining optional fields as new states are added.
- Adding a new state means hunting for every if on the status field.

## How it shows

- A status or kind field plus several optional or nullable fields, each meaningful for only some statuses.
- Boolean pairs that must never both be true (is_loading and has_error).
- Comments such as "only set when status is DONE" next to a field.
- Runtime checks or asserts that re-establish which fields are present for a given state.
- After the change, unions of small types and exhaustive switch or match over them.

## Overdone when

- Encoding every business rule in types, so a rule change ripples through signatures and the types read like a proof.
- Splitting a type into variants that share almost all fields and differ in nothing the code acts on.
- Type-level tricks (phantom types, branded types, type-level numbers) where a constructor check would be clearer to the team.
- Closed unions at an extension point that others must be able to extend.

## Example

Before:

```
class Upload:
    status: str                 # "pending" | "uploading" | "done" | "failed"
    progress: float or None     # only while uploading
    url: str or None            # only when done
    error: str or None          # only when failed

fn show(u: Upload):
    if u.status == "done": return link(u.url)   # url could still be None
    ...
```

After:

```
Upload = Pending
       | Uploading(progress: float)
       | Done(url: str)
       | Failed(error: str)

fn show(u: Upload):
    match u:
        Pending: return "waiting"
        Uploading(p): return bar(p)
        Done(url): return link(url)
        Failed(e): return warning(e)
```

A finished upload without a url, or a failed one with progress, can no longer be built, and a missing case in show is a type error.

## One-file tell

TypeScript and Python: a type or class with a string or enum field named status, state or kind alongside three or more optional or nullable fields. It is a hint to look, not a finding; some of these are honest records with independent optional data.

## By language

**python:** Model variants as separate frozen dataclasses joined with a Union (or the | operator), with a Literal tag field when serialising; match statements narrow them, and typing.assert_never makes a type checker report a missing case. The guarantee exists only under mypy or pyright, not at runtime. Pydantic discriminated unions apply it at the parsing boundary.

**typescript:** Discriminated unions with a literal kind field are the native tool, and a switch with a never-typed default gives exhaustiveness checking. Optional properties plus a status string is the common shape to replace. Types are erased at runtime, so external data still needs parsing.

**java:** Since Java 17, a sealed interface with record implementations is a closed sum type, and since Java 21 pattern-matching switch over it is checked for exhaustiveness. Before that, enums with data or the visitor pattern were the substitutes.

**csharp:** C# 15 (.NET 11, November 2026; in preview with LangVersion preview before that) adds union types, declared with the union keyword over a fixed set of types, with exhaustive switch checking. Through C# 14 the usual substitutes are an abstract record with a private constructor and nested sealed records, matched with switch expressions (the compiler can't prove exhaustiveness, so a discard arm is needed), or libraries such as OneOf.

**go:** Go has no sum types. The common substitute is an interface with an unexported marker method so only the package can implement it, plus a type switch; linters such as exhaustive and go-check-sumtype check the cases. Zero values mean any struct can exist half-built, so constructors and unexported fields carry more of the load.

**rust:** Enums with data and exhaustive match are the everyday tool, and Option and Result are the standard examples; the compiler rejects a missed variant. Newtypes and the typestate pattern push it further.

## Related

[Parse, Don't Validate](parse-dont-validate.md) · [Primitive Obsession](primitive-obsession.md) · [Temporary Field](temporary-field.md) · [Switch Statements](switch-statements.md) · [State](state.md) · [Data Clumps](data-clumps.md)

## Sources

- [Yaron Minsky, Effective ML Revisited, Jane Street blog (2011)](https://blog.janestreet.com/effective-ml-revisited/) (read)
- [Scott Wlaschin, Domain Modeling Made Functional (2018)](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/) (recalled)
- [Scott Wlaschin, Designing with types, F# for Fun and Profit](https://fsharpforfunandprofit.com/series/designing-with-types/) (recalled)
