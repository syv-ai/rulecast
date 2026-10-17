<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Singleton

`singleton` · design patterns, creational · **contested**

A class allows only one instance of itself and hands out a global way to reach it.

*Matters most for:* mobile, games, embedded, desktop, serverless

## But

Widely regarded as an anti-pattern. It combines two jobs (controlling instance count and global access), hides dependencies, couples callers to one concrete class, makes unit tests share state, and needs locking under concurrency. The usual alternative is to create one instance at the composition root and pass it in (dependency injection). Even GoF co-author Erich Gamma has said he would drop it from the book.

## Quality axes

- **reliability** ⊕ (primary): A genuinely single resource (a device, a process-wide registry) can't be opened twice and fought over by two instances.
- **runtime** +: Expensive initialisation happens lazily and only once.
- **change_cost** −: Callers reach it through a global accessor, which hides the dependency on one concrete class and makes tests share state.

**Flips:** Used as a respectable global for config, database handles or loggers it is the global-state anti-pattern, quick to reach for (delivery "+") but sharply raising change_cost; without locking under concurrency, lazy creation itself turns reliability "-". Creating one instance at the composition root and passing it in keeps the benefit without the costs.

## Warranted when

- There is genuinely one physical or process-wide resource (a hardware device, a process-wide registry) and two instances would be a bug.
- Creating the instance is expensive and should happen lazily, once.

## How it shows

- A static or class-level accessor that always returns the same cached instance.
- A class that overrides instance creation to return a stored instance, sometimes guarded by a lock.
- Many modules reaching for the same instance through a global accessor instead of receiving it as a parameter.

## Overdone when

- Using it as a respectable global variable for configuration, a database handle or a logger.
- Hidden dependencies: functions that reach for the singleton instead of taking it as an argument, which makes them hard to test.
- Tests that need to reset or monkeypatch the instance between cases.
- Making something a singleton because "we only need one right now".

## Example

Before:

```
class CardReader:
    fn init(): self.port = open_serial("/dev/ttyUSB0")   # exclusive device

fn take_payment(amount):
    reader = CardReader()       # second open fails while checkout holds the port
    reader.charge(amount)

fn refund(amount):
    reader = CardReader()
    reader.refund(amount)
```

After:

```
class CardReader:
    _instance: CardReader = None

    private fn init(): self.port = open_serial("/dev/ttyUSB0")   # only instance() may construct

    fn instance() -> CardReader:      # class-level accessor
        if CardReader._instance is None:
            CardReader._instance = CardReader()   # opened lazily, once
        return CardReader._instance

fn take_payment(amount):
    CardReader.instance().charge(amount)

fn refund(amount):
    CardReader.instance().refund(amount)
```

There is one physical device, so one instance is enforced; creating it once at startup and passing it in gives the same guarantee without the hidden global.

## One-file tell

A class that stores its own instance in a class attribute and returns it from __new__ or a get_instance method.

## By language

**python:** A module is already a singleton: it is imported once and cached, so a module-level instance or plain module functions do the job without any class machinery. Overriding __new__, a metaclass or a decorator to force one instance is usually seen as unidiomatic. The Borg (shared state) variant exists but has the same drawbacks. Python's own singletons, None, True and False, are language-level and not a model to copy.

**typescript:** Seen as an antipattern by many and used less often. An ES module is evaluated once and cached, so exporting a single instance from a module already gives one shared object without the private-constructor ceremony. The usual advice is to export the instance, or better, pass it in, so tests can substitute it. Spotting it: A class with a private constructor and a static method or getter that lazily creates and always returns the same stored instance.

**java:** Much of the community treats it as an antipattern, though the JDK has examples such as Runtime and Desktop. When one is really needed, a single-element enum is the idiomatic, serialization-safe form, and the holder-class idiom gives lazy, thread-safe initialisation. Double-checked locking needs volatile to be correct. Most applications instead let a DI container manage a singleton-scoped bean, which keeps the class testable. Spotting it: A private constructor plus a static getInstance or INSTANCE field that always returns the same cached object, or an enum with a single constant used as a service.

**csharp:** Many C# developers treat it as an antipattern and it is fading from new code. The idiomatic replacement is registering a service with a singleton lifetime in the DI container, which gives one instance per container while keeping it injectable and testable. When a true static singleton is needed, Lazy<T> or a static readonly field gives thread-safe lazy initialization without hand-rolled double-checked locking. Spotting it: A private constructor plus a static Instance property or GetInstance method returning the same cached object, frequently backed by Lazy<T> or a static readonly field; or AddSingleton registrations in DI setup.

**go:** Done with package-level state. Either an unexported variable set in init or at declaration, or lazy creation guarded by sync.Once (sync.OnceValue since Go 1.21). Hand-rolled double-checked locking with an unsynchronized nil check is a data race. Idiomatic Go is wary of package globals and prefers creating one instance in main and passing it down. The standard library's own defaults, such as http.DefaultClient, are a known source of hidden coupling. Spotting it: An unexported package variable returned by a GetInstance-style function, a sync.Once beside it, or an exported Default variable.

**rust:** Rust discourages global mutable state: `static mut` needs `unsafe`, and newer editions lint against references to it. The idiomatic default is no singleton. Create the value in main and pass it down by reference. When a global really is needed, as with loggers or a lazily built registry, use a `static` with interior mutability: `OnceLock`/`LazyLock` (std; these replace `lazy_static` and `once_cell`), or a plain `static Mutex` (const-constructible since 1.63). Keep any `unsafe` inside a small safe API, as the `log` crate does. Spotting it: A `static` holding `OnceLock`, `LazyLock`, `Mutex` or `Atomic*`, a `lazy_static!` or `once_cell` block, or a `get()`/`global()` function that returns a reference to a static.

**cpp:** Widely seen as an antipattern and less common in modern C++. When one is wanted, the idiom is a function-local static (the Meyers singleton), whose initialization C++11 guarantees is thread-safe, so double-checked locking is unnecessary. Watch the static initialization and destruction order across translation units. Passing the dependency explicitly is usually preferred. Spotting it: A static accessor returning a reference to a function-local static or a static member, with the constructor private and copy and move deleted.

## Related

[Facade](facade.md) · [Flyweight](flyweight.md) · [Abstract Factory](abstract-factory.md) · [Builder](builder.md) · [Prototype](prototype.md) · [Global state](global-state.md)

## Overlaps

global-state is the problem. singleton is one way to produce it, and the pattern entry covers when a single instance is still right.

## Sources

- [Refactoring.Guru, Singleton](https://refactoring.guru/design-patterns/singleton) (read)
- [Refactoring.Guru, Singleton in Python](https://refactoring.guru/design-patterns/singleton/python/example) (read)
- [Erich Gamma interview in Design Patterns 15 Years Later (InformIT, 2009)](https://www.informit.com/articles/article.aspx?p=1404056) (recalled)
- [Refactoring.Guru, Singleton in TypeScript](https://refactoring.guru/design-patterns/singleton/typescript/example) (read)
- Established TypeScript practice (module-level instances, ES module caching) (recalled)
- [Refactoring.Guru, Singleton in Java](https://refactoring.guru/design-patterns/singleton/java/example) (read)
- Effective Java (Bloch), item on enforcing singletons with an enum; Spring singleton scope (recalled)
- [Refactoring.Guru, Singleton in C#](https://refactoring.guru/design-patterns/singleton/csharp/example) (read)
- Microsoft.Extensions.DependencyInjection service lifetimes; System.Lazy<T> (recalled)
- [Refactoring.Guru, Singleton in Go](https://refactoring.guru/design-patterns/singleton/go/example) (read)
- [Go standard library, sync.OnceValue](https://pkg.go.dev/sync#OnceValue) (recalled)
- [Refactoring.Guru, Singleton in Rust](https://refactoring.guru/design-patterns/singleton/rust/example) (read)
- [std::sync::OnceLock and LazyLock; static_mut_refs lint](https://doc.rust-lang.org/std/sync/struct.LazyLock.html) (recalled)
- [Refactoring.Guru, Singleton in C++](https://refactoring.guru/design-patterns/singleton/cpp/example) (read)
- [C++11 thread-safe initialization of function-local statics, cppreference](https://en.cppreference.com/w/cpp/language/storage_duration) (recalled)
