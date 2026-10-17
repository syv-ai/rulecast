<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fluent Interface

`fluent-interface` · design patterns, design

An API designed to read like a sentence in the problem's language, usually by chaining calls that each return an object to continue from. Method chaining is the common mechanism, but the aim is readable call sites, not chaining itself.

*Names:* Named by Martin Fowler and Eric Evans after a workshop in 2005, in Fowler's bliki entry FluentInterface. Fowler later covered it as an internal DSL technique in Domain-Specific Languages (2010). Related to, but not the same as, the Builder pattern.

*Matters most for:* library-sdk

## But

Fowler says fluency costs more effort to design and build than plain setters and constructors, and that fluent methods break command-query separation by returning values from modifiers. Individual methods read poorly on their own in docs and completions. Chains hide intermediate state from debuggers, and a mutating chain that returns the same object can surprise callers who keep a reference. In languages with named and default arguments, a single call with keyword arguments often reads just as well. Keep fluent interfaces for libraries used widely enough to repay the design effort.

## Quality axes

- **change_cost** ⊕ (primary): Call sites read as one statement in the domain's own terms, which matters because they are read far more than the library source.
- **delivery** −: Fluency takes more effort to design and build than plain setters and constructors.

**Flips:** For objects with a few settings named arguments are clearer; mutating chains on shared objects surprise callers, and long chains hide intermediate state from debuggers.

## Warranted when

- Call sites that set many options through a series of setters and temporary variables, hard to read as one statement.
- A domain with a natural phrasing (queries, schedules, assertions, routing rules) used by many callers.
- A library whose call sites are read far more than its source.

## How it shows

- Methods that return this, self or a new stage object, used in long chains.
- Query builders, assertion libraries, HTTP clients and configuration APIs (where(), expect().toBe(), services.AddX().AddY()).
- Staged builder interfaces where each step returns a type that offers only the valid next steps.

## Overdone when

- Chains for objects with two or three settings, where a constructor with named arguments is clearer.
- Mutating chains on shared objects, so a half-built chain kept in a variable changes when another branch continues it.
- Long chains that are hard to debug, step through or read in a stack trace.
- Method names that make sense only inside the chain (with, and, then), which read badly anywhere else.

## Example

Before:

```
search = JobSearch()
search.set_role("backend engineer")
search.set_city("Oslo")
search.set_remote_allowed(true)
search.set_max_age_days(7)
search.set_sort("newest")
results = board.run(search)
```

After:

```
results = board.jobs()
    .for_role("backend engineer")
    .in_city("Oslo")
    .remote_ok()
    .posted_within(days=7)
    .newest_first()
    .run()
```

The query reads as one statement in the job board's own terms; each step returns the search so far.

## By language

**python:** Less common, since keyword arguments cover most configuration; seen in query builders (SQLAlchemy's select().where()), pandas method chains and some assertion libraries.

**typescript:** Common in query builders, test assertions (expect().toEqual()) and schema libraries (zod); generics can type staged chains so invalid next steps don't compile.

**java:** Widespread: Stream API, builders, AssertJ, jOOQ and Spring's configuration DSLs. Lombok's @Builder generates the chained builder shape.

**csharp:** LINQ method syntax, FluentAssertions, Entity Framework's model builder and the AddX extension methods on service collections all use it; extension methods let a library add fluent steps to types it doesn't own.

**go:** Uncommon and often seen as unidiomatic, because methods returning the receiver can't also return an error cleanly; functional options and config structs are preferred.

**rust:** Builder chains are idiomatic (std::process::Command, reqwest), either by value (self) or by &mut self; iterator adapters are a fluent interface over lazy sequences.

## Related

[Builder](builder.md) · [Command-Query Separation (CQS)](command-query-separation.md) · [Message Chains](message-chains.md) · [Law of Demeter](law-of-demeter.md) · [Test Data Builder](test-data-builder.md)

## Sources

- [Martin Fowler, bliki, FluentInterface (2005)](https://martinfowler.com/bliki/FluentInterface.html) (read)
- [Martin Fowler, Domain-Specific Languages (2010), Method Chaining](https://martinfowler.com/books/dsl.html) (recalled)
