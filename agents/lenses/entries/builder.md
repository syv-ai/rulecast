<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Builder

`builder` · design patterns, creational

Build a complicated object in named steps through a separate builder, instead of one constructor with a long list of options.

*Matters most for:* library-sdk, compilers-tooling

## But

In languages with keyword arguments and default values, most builders are unnecessary: a constructor call with named arguments says the same thing. A builder also adds a mutable intermediate object, which can be left half-configured. Keep it for genuinely staged or validated construction, or for fluent APIs where users compose queries and requests.

## Quality axes

- **change_cost** ⊕ (primary): Named construction steps replace telescoping constructors, so call sites read clearly and new options don't break existing callers.
- **reliability** +: Validation in the steps and at build means a half-built or contradictory object never reaches the rest of the code.
- **delivery** −: A separate builder class has to be written and kept in step with the object.

**Flips:** In languages with keyword and default arguments, or for small classes, it is ceremony; a builder that only mirrors setters adds a mutable half-configured object without any validation.

## Warranted when

- A constructor has grown many optional parameters, or several overloads that each add one more (telescoping constructors).
- The object must not be visible or usable until it is fully and validly assembled.
- The same assembly steps should produce different representations (for example, a document and a summary of it).
- Building a nested or tree structure step by step, possibly recursively.

## How it shows

- A class with several configuring methods and one final method that returns the finished object.
- Configuring methods that return the builder itself so calls chain and end in a build call.
- Optionally a director that runs a standard sequence of steps.

## Overdone when

- A builder for a class with three fields that could just be constructed directly.
- A builder that only mirrors setters one to one and performs no validation or sequencing.
- A director class that wraps a single fixed sequence used in one place.

## Example

Before:

```
class ProductSearch:
    fn init(text, category=None, min_price=None, max_price=None,
            in_stock_only=False, sort="relevance", page=1,
            page_size=20, facets=None, highlight=False): ...

# callers pass positional flags nobody can read, and nothing
# rejects min_price > max_price until the search engine does
q = ProductSearch("kettle", None, 20, 10, True, "price", 1, 50, None, True)
```

After:

```
class ProductSearchBuilder:
    fn init(text):
        self.text = text
        self.filters = {}
    fn price_between(lo, hi) -> ProductSearchBuilder:
        if lo > hi: raise InvalidQuery("price range is reversed")
        self.filters["price"] = (lo, hi)
        return self                    # returning the builder lets calls chain
    fn in_stock() -> ProductSearchBuilder: ...
    fn sort_by(field) -> ProductSearchBuilder: ...
    fn build() -> ProductSearch: ...   # final checks, then an immutable query

q = ProductSearchBuilder("kettle").price_between(10, 20).in_stock().sort_by("price").build()
```

Each option gets a named, validated step, and the query only exists once it is complete; with keyword arguments and no validation, a plain constructor would do.

## One-file tell

In Python, a builder class whose setter methods map one to one onto the fields of a dataclass or plain constructor and do no validation or sequencing, where keyword arguments would do.

## By language

**python:** Keyword arguments with defaults, dataclasses and attrs usually replace a builder outright. Builders still show up for fluent query or request APIs (ORM query sets, HTTP request builders), where each call returns a new or updated object. A classmethod alternative constructor is often enough for building from a different input.

**typescript:** Well known in TypeScript, and worth it when an object has many optional configuration choices. Often an options object with optional properties and defaults filled in by spread does the same job with less code. Builders still pay off where they can be typed fluently: query builders and schema libraries use generics so each chained call narrows or extends the type of the result. Spotting it: A class with several setup methods that return `this` for chaining, plus one method (often `build`) that produces the finished object.

**java:** Very common, because Java has no named or default parameters, so builders stand in for telescoping constructors when an object has many optional fields. The JDK uses the chained-call style in StringBuilder and other Appendable types, and in ByteBuffer's put methods. Lombok's @Builder and builders generated for immutable value types are widespread; for a few required fields, a record or a plain constructor is the idiomatic choice. Spotting it: A (often static nested) Builder class whose setter-like methods return this for chaining and end in a build() method; or a Lombok @Builder annotation.

**csharp:** Familiar in C#, chiefly as fluent builders in the platform itself: StringBuilder, WebApplication.CreateBuilder, HostBuilder, UriBuilder, EF Core's ModelBuilder. For plain data objects, object initializers, init-only properties, required members and named optional arguments usually make a builder unnecessary; records with `with` expressions cover copy-and-tweak. Reach for a builder when construction has ordering, validation or many optional parts that an initializer can't enforce. Spotting it: A class with many configuration methods that return the builder itself for chaining, often named WithX, AddX or UseX, and one Build() method that produces the finished object.

**go:** The classic builder-plus-director shape is rare. Go code gets the same effect from a config struct literal with zero values as defaults, or from functional options, variadic functions that each set one field and are passed to the constructor. A chained builder that returns its receiver appears for queries and requests, often keeping the first error and reporting it at the final call. Spotting it: A constructor taking variadic option values (often named With...), or a type whose setter methods return the receiver pointer and end in a Build or Do call.

**rust:** Very common, because Rust has no default arguments, named arguments or overloading. The usual form is a separate `FooBuilder` with chained setters and a `build()` that returns `Result` (or panics) when a required field is missing. Setters take either `self` (build then consumes the builder) or `&mut self` (build takes `&self`, so the builder can be reused, which the API Guidelines prefer). A project should pick one. Method chaining alone is not a Builder in the GoF sense: GoF also has a director and several product types. Simple configs often need only `Default` plus struct update syntax, and crates like `derive_builder` or `bon` generate the boilerplate. Typestate builders move required-field checks to compile time. Spotting it: A `*Builder` struct of `Option` fields, a `builder()` or `new()` that returns it, chained setters, and a terminal `build()`.

**cpp:** Well known in C++ and most useful for objects with many optional settings, since the language has no named arguments. Lighter alternatives are often enough: a plain options struct passed to the constructor, which C++20 designated initializers make readable. Fluent builders return a reference to themselves; a final build step that returns by value or unique_ptr keeps the built object immutable. Spotting it: A class with several setter-like methods returning a reference to itself, chained together and ending in a single build or get-result method.

## Related

[Abstract Factory](abstract-factory.md) · [Factory Method](factory-method.md) · [Composite](composite.md) · [Bridge](bridge.md)

## Sources

- [Refactoring.Guru, Builder](https://refactoring.guru/design-patterns/builder) (read)
- [Refactoring.Guru, Builder in Python](https://refactoring.guru/design-patterns/builder/python/example) (read)
- [Refactoring.Guru, Builder in TypeScript](https://refactoring.guru/design-patterns/builder/typescript/example) (read)
- Established TypeScript practice (options objects, typed fluent builders such as query and schema libraries) (recalled)
- [Refactoring.Guru, Builder in Java](https://refactoring.guru/design-patterns/builder/java/example) (read)
- Effective Java (Bloch), item on builders for many constructor parameters; Lombok @Builder (recalled)
- [Refactoring.Guru, Builder in C#](https://refactoring.guru/design-patterns/builder/csharp/example) (read)
- C# object initializers, init accessors, records, and ASP.NET Core host builders (recalled)
- [Refactoring.Guru, Builder in Go](https://refactoring.guru/design-patterns/builder/go/example) (read)
- [Dave Cheney, Functional options for friendly APIs](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis) (recalled)
- [Refactoring.Guru, Builder in Rust](https://refactoring.guru/design-patterns/builder/rust/example) (read)
- [Rust API Guidelines, builder pattern (C-BUILDER); derive_builder and typestate practice](https://rust-lang.github.io/api-guidelines/type-safety.html) (recalled)
- [Refactoring.Guru, Builder in C++](https://refactoring.guru/design-patterns/builder/cpp/example) (read)
- [Designated initializers (C++20), cppreference](https://en.cppreference.com/w/cpp/language/aggregate_initialization) (recalled)
