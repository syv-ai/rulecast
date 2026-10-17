<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Abstract Factory

`abstract-factory` · design patterns, creational

One factory object creates a whole family of related objects, so the caller gets parts that fit together without naming their concrete classes. Sometimes called a kit.

*Matters most for:* desktop, mobile, library-sdk

## But

Skip it until a second family actually exists. It adds an interface per product plus a class per variant, and adding a new product type means touching every factory, so it is rigid along that axis. With one variant, plain constructors or a single function are clearer. Dependency injection containers and passing callables often cover the same need with less ceremony.

## Quality axes

- **change_cost** ⊕ (primary): The variant check lives in one place that picks a kit, so a new platform is one new factory, not edits at every construction site.
- **reliability** +: Every part comes from the same family, so mismatched parts (an S3 bucket with a Pub/Sub topic) can't be combined by mistake.
- **delivery** −: An interface per product plus a class per variant must be written before anything is built.

**Flips:** With one variant it is indirection around constructors, and adding a new product type means editing every factory, turning change_cost "-".

## Warranted when

- Several kinds of objects have to be used together and must come from the same variant (same theme, same backend, same platform).
- Code keeps checking the same setting to decide which concrete class to build, at several construction sites.
- New variants are expected, and each one brings a full set of matching parts.

## How it shows

- A factory interface with one create method per product type, plus one concrete factory per variant or platform.
- Client code receives a factory and builds every related part through it.
- A method that returns a factory, which is then used to make sub-components.

## Overdone when

- A factory hierarchy with a single concrete factory and no second variant in sight.
- A factory for one product type, which is just an indirection around a constructor.
- Parallel interface and class trees that grow with every new product, even though nothing ever mixes variants by mistake.

## Example

Before:

```
fn start_ingest(cfg: Config):
    if cfg.cloud == "aws":
        store = S3Bucket(cfg.bucket)
    else:
        store = GcsBucket(cfg.bucket)
    ...
    if cfg.cloud == "aws":
        queue = SqsQueue(cfg.queue)
    else:
        queue = PubSubTopic(cfg.queue)
    # nothing stops an S3 bucket being paired with a Pub/Sub topic
    Ingestor(store, queue).run()
```

After:

```
interface CloudKit:
    fn bucket(name: str) -> Bucket
    fn queue(name: str) -> Queue

class AwsKit(CloudKit): ...      # returns S3Bucket, SqsQueue
class GcpKit(CloudKit): ...      # returns GcsBucket, PubSubTopic

fn start_ingest(cfg: Config, kit: CloudKit):
    Ingestor(kit.bucket(cfg.bucket), kit.queue(cfg.queue)).run()
```

The cloud check moves to one place that picks a kit, and every part the ingestor gets comes from the same provider.

## By language

**python:** Classes are first-class values, so a "factory" is often just a module, a dict that maps a variant to classes, or a namespace object holding callables. Duck typing removes the need for an abstract factory base class. Frameworks still use the shape so users can plug in their own component classes. Norvig's point that many GoF creational patterns become trivial or invisible in dynamic languages applies directly here.

**typescript:** Common in TypeScript libraries and frameworks that let users swap whole families of components. Because typing is structural, the "factory" is often just an object literal or a function returning an object that satisfies an interface, not a class hierarchy. A plain record of creator functions, passed in or provided through dependency injection, usually does the job. Spotting it: A method or function returns an object whose own methods create related products, all typed against shared interfaces rather than concrete classes.

**java:** Common in Java, mostly in the JDK and frameworks as a pluggable provider entry point: a static lookup returns a factory object (often found via ServiceLoader or a system property) that makes a family of related components, as in the javax.xml parser, transformer and XPath factories. In application code, a dependency-injection container usually does this job, and a single interface bound per environment is often enough. Spotting it: A static newInstance-style method that returns a factory, whose methods then create the actual sub-components; implementations are often selected through ServiceLoader or configuration.

**csharp:** Common in C#, mostly inside frameworks that let you swap a whole family of components. ADO.NET's DbProviderFactory, which hands out matching connections, commands and parameters for one database provider, is the textbook standard-library case. In application code the DI container usually does this job: you register the family's implementations once and inject interfaces, so a hand-written factory interface is only worth it when the family is picked at runtime. Spotting it: A method or injected service that returns a factory interface, which is then asked for several related products (CreateConnection, CreateCommand and so on) that are meant to be used together.

**go:** Uncommon in Go. A family of products becomes a small interface whose methods return other interfaces, and a plain constructor function picks the concrete factory by name or config. Shared product fields usually sit in an embedded base struct instead of a base class. Most Go code passes the concrete dependencies in through the constructor and takes the interfaces where they are used, which makes a separate factory type unnecessary. Spotting it: An interface whose methods all return other interfaces, with one struct per variant implementing it, and a function that switches on a string or enum to return one of them.

**rust:** A factory trait whose methods return the products. Two versions: an associated type per product with the factory taken as `impl Trait` (static dispatch, no allocation), or methods returning `Box<dyn Product>` with the factory passed as `&dyn Factory` when the family is only known at runtime. Libraries usually take the generic form so the caller can choose, and binaries can use boxing. If the set of families is closed, an enum matched in one place is often simpler. Spotting it: A trait whose methods all build values of other traits, through associated types or boxed trait objects, with one implementing struct per family. Often picked by a cfg flag or a config value in main.

**cpp:** Common in C++ frameworks and libraries that let users plug in their own families of components. Factories return std::unique_ptr to an abstract base so ownership is explicit. When the product family is fixed at compile time, a policy or traits template parameter does the same job with no virtual dispatch and is often the more idiomatic choice. Spotting it: A method that returns a factory object (usually by pointer to an abstract class), whose own methods each return a unique_ptr to a different abstract product.

## Related

[Factory Method](factory-method.md) · [Builder](builder.md) · [Prototype](prototype.md) · [Bridge](bridge.md) · [Facade](facade.md) · [Singleton](singleton.md)

## Sources

- [Refactoring.Guru, Abstract Factory](https://refactoring.guru/design-patterns/abstract-factory) (read)
- [Refactoring.Guru, Abstract Factory in Python](https://refactoring.guru/design-patterns/abstract-factory/python/example) (read)
- [Peter Norvig, Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/) (recalled)
- [Refactoring.Guru, Abstract Factory in TypeScript](https://refactoring.guru/design-patterns/abstract-factory/typescript/example) (read)
- Established TypeScript practice (structural typing, object-literal factories) (recalled)
- [Refactoring.Guru, Abstract Factory in Java](https://refactoring.guru/design-patterns/abstract-factory/java/example) (read)
- JDK ServiceLoader and DI-container practice (Spring, Guice) (recalled)
- [Refactoring.Guru, Abstract Factory in C#](https://refactoring.guru/design-patterns/abstract-factory/csharp/example) (read)
- .NET System.Data.Common.DbProviderFactory and Microsoft.Extensions.DependencyInjection (recalled)
- [Refactoring.Guru, Abstract Factory in Go](https://refactoring.guru/design-patterns/abstract-factory/go/example) (read)
- [Go Code Review Comments, Interfaces](https://go.dev/wiki/CodeReviewComments#interfaces) (recalled)
- [Refactoring.Guru, Abstract Factory in Rust](https://refactoring.guru/design-patterns/abstract-factory/rust/example) (read)
- Common Rust practice (closed families as enums) (recalled)
- [Refactoring.Guru, Abstract Factory in C++](https://refactoring.guru/design-patterns/abstract-factory/cpp/example) (read)
- Policy-based design with template parameters (Alexandrescu, Modern C++ Design) (recalled)
