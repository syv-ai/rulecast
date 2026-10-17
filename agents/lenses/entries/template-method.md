<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Template Method

`template-method` · design patterns, behavioral

A base class fixes the steps of an algorithm and subclasses fill in or override individual steps without changing the order.

*Matters most for:* library-sdk, plugins-extensions, data-pipeline, plugin-host

## But

It relies on inheritance, and the usual cautions apply: favour composition over inheritance (GoF's own advice), and beware the fragile base class problem where changes to the skeleton break subclasses. The fixed skeleton limits some callers, a subclass that suppresses a default step can break Liskov substitution, and many steps make it hard to maintain. Strategy or passing functions for the varying steps is often the cleaner alternative.

## Quality axes

- **change_cost** ⊕ (primary): The algorithm's order and shared steps live once in the base class, so a fix lands once instead of in every near-duplicate copy.

**Flips:** It ties variation to inheritance, so the fragile base class problem and long skeletons with many hooks turn change_cost "-"; with one subclass, or when the steps could be passed as functions, it is coupling for nothing.

## Warranted when

- Several classes run nearly the same algorithm and differ in a few steps, and fixes have to be made in each copy
- Callers should be able to customise parts of a workflow but not its overall order
- Client code type-checks to decide which near-duplicate class to call

## How it shows

- A base class method that calls a sequence of other methods, some abstract and some empty hooks
- Subclasses that override only a step or two and never the main method
- Framework base classes (views, test cases, commands) that users subclass to fill in steps

## Overdone when

- A base class with one subclass, created in case others appear
- A long skeleton with many hook methods, so understanding one subclass means reading the whole hierarchy
- Inheritance used only to share a few helper steps that could be plain functions

## Example

Before:

```
class NordbankImporter:
    fn run(path):
        txns = []
        for r in read_semicolon_csv(path):
            txns.append(Txn(r[0], parse_eu_amount(r[3]), r[5]))
        txns = drop_duplicates(txns, self.ledger)    # dedupe fixed here last month
        self.ledger.save(txns)
class CoastalCreditImporter:
    fn run(path):
        txns = []
        for r in read_json(path)["transactions"]:
            txns.append(Txn(r["date"], r["amount"], r["memo"]))
        self.ledger.save(txns)    # never got the dedupe fix
```

After:

```
class StatementImporter:
    fn run(path):    # fixed order, not overridden
        txns = []
        for raw in self.read_rows(path):
            txns.append(self.to_txn(raw))
        self.ledger.save(drop_duplicates(txns, self.ledger))
    fn read_rows(path) -> list: abstract
    fn to_txn(raw) -> Txn: abstract

class NordbankImporter extends StatementImporter:
    fn read_rows(path): return read_semicolon_csv(path)
    fn to_txn(r): return Txn(r[0], parse_eu_amount(r[3]), r[5])
```

The base class owns the import order and the dedupe step, and each bank fills in only how it reads and maps rows, so a fix lands once.

## One-file tell

A base class method that calls several self methods in sequence where some of those are marked abstract and others have empty bodies.

## By language

**python:** Usually an abc.ABC with abstractmethod steps and no-op hook methods. Passing the varying steps as functions often removes the need for subclassing. The source notes Python frameworks use it so users can extend standard behaviour by subclassing.

**typescript:** Common in TypeScript frameworks that let users extend built-in behaviour by subclassing; `abstract` classes and methods make the required steps explicit. Outside frameworks, composition is usually preferred: a function that runs the fixed skeleton and takes the varying steps as callbacks or hooks in an options object. Spotting it: A base-class method that calls several other methods, some abstract and some empty hooks that subclasses may override.

**java:** Common in Java frameworks and the JDK: the concrete methods of InputStream/Reader and the AbstractList/AbstractMap skeletons build on a few abstract ones, and HttpServlet's doGet/doPost hooks default to 405. Spring's JdbcTemplate and RestTemplate get the same effect with callbacks rather than inheritance. With lambdas, passing the varying steps as functions is often preferred over subclassing; marking the template method final keeps subclasses from overriding the skeleton. Spotting it: An abstract base class with a (often final) public method that calls protected abstract or empty hook methods that subclasses override.

**csharp:** Common in C# frameworks, which expose protected virtual or abstract hooks for users to override; ASP.NET Core's BackgroundService with ExecuteAsync and EF Core's DbContext with OnModelCreating and OnConfiguring are everyday examples. Making the template method itself non-virtual keeps the algorithm's order fixed. Outside frameworks, passing delegates or injecting a strategy is often preferred over inheritance. Spotting it: A base class method that calls a sequence of protected abstract or virtual methods, some with empty default bodies, that subclasses override.

**go:** Awkward in Go. Embedding a base struct does not give it virtual dispatch, so the embedded type's skeleton method can't call the outer type's overrides. The workaround is to keep the fixed algorithm in a function or struct that takes the varying steps as an interface or as function values. This makes it a strategy with a fixed outline. Copying the inheritance shape through embedding is a common mistake for newcomers. Spotting it: A function or method that runs a fixed sequence of calls on an interface or on func fields, with concrete types supplying only the steps.

**rust:** No abstract base classes. The template is a provided (default) method on a trait that calls the trait's required methods and default hook methods. Rust can't stop implementors from overriding the template method, but one defined in an `impl dyn Trait` block, a free function, or a sealed helper can't be overridden. Taking the steps as closures or a strategy trait is often the simpler choice. Spotting it: A trait with one default method that calls several other trait methods in order, some of them required and some with empty default bodies.

**cpp:** Common in C++ frameworks that are extended by subclassing. C++ has an established form, the non-virtual interface idiom: a public non-virtual method fixes the skeleton and calls private or protected virtual hooks. CRTP gives a static version with no virtual calls. Calling a virtual hook from a constructor or destructor does not reach the subclass, so the skeleton must not run there. Spotting it: A base class with a public non-virtual method that calls several virtual steps, some pure virtual and some with empty defaults; or a CRTP base calling static_cast<Derived*>(this) steps.

## Related

[Strategy](strategy.md) · [Factory Method](factory-method.md)

## Sources

- [Refactoring.Guru, Design Patterns: Template Method](https://refactoring.guru/design-patterns/template-method) (read)
- [Refactoring.Guru, Template Method in Python](https://refactoring.guru/design-patterns/template-method/python/example) (read)
- [Refactoring.Guru, Template Method in TypeScript](https://refactoring.guru/design-patterns/template-method/typescript/example) (read)
- Established TypeScript practice (abstract classes, callback-based skeletons) (recalled)
- [Refactoring.Guru, Template Method in Java](https://refactoring.guru/design-patterns/template-method/java/example) (read)
- Spring JdbcTemplate callback design (recalled)
- [Refactoring.Guru, Template Method in C#](https://refactoring.guru/design-patterns/template-method/csharp/example) (read)
- Microsoft.Extensions.Hosting.BackgroundService; EF Core DbContext (recalled)
- [Refactoring.Guru, Template Method in Go](https://refactoring.guru/design-patterns/template-method/go/example) (read)
- [Effective Go, Embedding](https://go.dev/doc/effective_go#embedding) (recalled)
- [Refactoring.Guru, Template Method in Rust](https://refactoring.guru/design-patterns/template-method/rust/example) (read)
- Default trait methods and impl-dyn blocks (recalled)
- [Refactoring.Guru, Template Method in C++](https://refactoring.guru/design-patterns/template-method/cpp/example) (read)
- [Herb Sutter, Virtuality (non-virtual interface idiom)](http://www.gotw.ca/publications/mill18.htm) (recalled)
