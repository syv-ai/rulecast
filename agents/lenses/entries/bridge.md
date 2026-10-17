<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Bridge

`bridge` · design patterns, structural

Split a class that varies along two independent axes into two hierarchies, the abstraction and its implementation, linked by composition.

*Matters most for:* desktop, embedded, games

## But

It pays off only when both dimensions really vary. Otherwise it is an extra layer of delegation that makes the code harder to follow. It is one instance of the general advice to favour composition over inheritance; in practice many codebases just call it injecting a strategy or a backend, and the name matters less than the shape.

## Quality axes

- **change_cost** ⊕ (primary): Two dimensions vary independently, so a new backend or a new kind is one class, not one per combination.
- **delivery** −: Two hierarchies and the delegation between them must be designed up front.

**Flips:** When only one dimension really varies it is an extra layer of delegation that makes the code harder to follow.

## Warranted when

- Subclasses multiply as the product of two dimensions (shape times renderer, report times output format).
- One class contains several variants of a feature, such as support for different database engines or vendors.
- The implementation must be swappable at runtime, or chosen by configuration.

## How it shows

- A high-level class that holds a reference to an implementation object and delegates platform work to it.
- Two separate class trees, one for the kinds of thing and one for the platforms or backends, rather than one tree of every combination.

## Overdone when

- Splitting a cohesive class into abstraction and implementation when only one implementation exists.
- Designing two hierarchies up front for a second dimension of variation that is only imagined.

## Example

Before:

```
class FullBackupToS3(Backup):
    fn run(): s3_client.put_object("full", snapshot_all())
class FullBackupToTape(Backup):
    fn run(): tape_drive.append("full", snapshot_all())
class IncrementalBackupToS3(Backup):
    fn run(): s3_client.put_object("incr", changes_since_last())
class IncrementalBackupToTape(Backup):
    fn run(): tape_drive.append("incr", changes_since_last())
# every kind of backup is repeated per target, and every target per kind:
# adding Azure means two more classes, and adding Snapshot after that three more
```

After:

```
interface StorageTarget:
    fn write(name: str, data: bytes)

class S3Target(StorageTarget): ...
class TapeTarget(StorageTarget): ...

class Backup:
    fn init(target: StorageTarget): self.target = target
    fn run(): abstract

class FullBackup(Backup):
    fn run(): self.target.write("full", snapshot_all())

class IncrementalBackup(Backup):
    fn run(): self.target.write("incr", changes_since_last())
```

The kind of backup and where it is stored vary independently, so two small hierarchies joined by a reference replace one class per combination.

## By language

**python:** Passing the implementation object (or a callable) into the constructor is the whole pattern; no abstract base classes are required, though a Protocol can describe the implementation side. Common in code that targets several databases, operating systems or cloud providers.

**typescript:** Useful for cross-platform code and for supporting several providers of the same service (databases, cloud platforms, payment providers). In TypeScript the implementation side is usually an interface injected through the constructor, and the abstraction side often stays a single class rather than its own hierarchy. Spotting it: A controlling class holds a reference to an interface with several platform- or provider-specific implementations and delegates to it.

**java:** Appears where one abstraction must work over several platforms, database vendors or service providers. JDBC is the textbook Java case: application code talks to the java.sql interfaces, and a vendor driver supplies the implementation. SLF4J over a logging backend is another. Inside a single application, a plain interface injected by constructor usually covers it. Spotting it: An abstraction class holding a field of an interface type with several platform-specific implementations, where both sides form their own hierarchies and vary independently.

**csharp:** Useful in C# for cross-platform code, multiple database servers, or several providers of one kind of service such as cloud storage. In practice it is usually expressed as an abstraction class that takes an injected interface for its implementation side, so DI does most of the wiring; the logging and configuration abstractions in Microsoft.Extensions, with pluggable providers behind them, are well-known examples. Spotting it: A high-level class holding a reference to an implementation interface, with several platform- or provider-specific implementations of that interface that vary independently of the high-level class's own subclasses.

**go:** Comes almost for free, since Go composes with interface-typed fields rather than subclassing. A struct that holds an interface for its implementation side is already a bridge, and it is seldom named as one. database/sql in front of driver.Driver is the textbook standard-library case. Spotting it: A public type that holds an interface field for a pluggable backend, often filled from a registry such as sql.Register.

**rust:** The implementation side is a trait, and abstractions are structs generic over it (`Remote<D: Device>`). That gives compile-time pairing with no boxing, or a `Box<dyn Device>` field when the pairing is chosen at runtime. Default methods on the abstraction trait can carry the shared logic, so there is no base class. In Rust this is ordinary generic design and is rarely called Bridge. Spotting it: Structs with a type parameter bounded by a trait, or a `Box<dyn Trait>` field, where a second trait or hierarchy delegates to that field.

**cpp:** Fits cross-platform C++ code, multiple database backends, or several providers of one service. C++'s best-known bridge is the pimpl idiom: a class holds a unique_ptr to a forward-declared implementation, which hides private details from the header, keeps the ABI stable and cuts rebuild times. When the implementation is chosen at compile time, a template parameter is a cheaper bridge. Spotting it: A class whose header holds only a pointer (often unique_ptr) to a forward-declared or abstract implementation type, with methods that forward to it.

## Related

[Adapter](adapter.md) · [Strategy](strategy.md) · [State](state.md) · [Abstract Factory](abstract-factory.md) · [Builder](builder.md)

## Sources

- [Refactoring.Guru, Bridge](https://refactoring.guru/design-patterns/bridge) (read)
- [Refactoring.Guru, Bridge in Python](https://refactoring.guru/design-patterns/bridge/python/example) (read)
- [Refactoring.Guru, Bridge in TypeScript](https://refactoring.guru/design-patterns/bridge/typescript/example) (read)
- Established TypeScript practice (constructor-injected interfaces) (recalled)
- [Refactoring.Guru, Bridge in Java](https://refactoring.guru/design-patterns/bridge/java/example) (read)
- JDBC driver and SLF4J binding architecture (recalled)
- [Refactoring.Guru, Bridge in C#](https://refactoring.guru/design-patterns/bridge/csharp/example) (read)
- Microsoft.Extensions.Logging provider model (recalled)
- [Refactoring.Guru, Bridge in Go](https://refactoring.guru/design-patterns/bridge/go/example) (read)
- [Go standard library, database/sql/driver](https://pkg.go.dev/database/sql/driver) (recalled)
- [Refactoring.Guru, Bridge in Rust](https://refactoring.guru/design-patterns/bridge/rust/example) (read)
- [Refactoring.Guru, Bridge in C++](https://refactoring.guru/design-patterns/bridge/cpp/example) (read)
- [Pimpl idiom, cppreference](https://en.cppreference.com/w/cpp/language/pimpl) (recalled)
