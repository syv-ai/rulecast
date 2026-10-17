<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Facade

`facade` · design patterns, structural

Give a complex subsystem one simple entry point that covers what callers actually need.

*Matters most for:* library-sdk, web-api, platforms, plugin-host

## But

A facade simplifies the common case but can't hide everything; callers with unusual needs will go around it, and that is fine. Left unchecked it accumulates responsibilities and becomes a god object. It also adds a layer to maintain, so it earns its place only when the subsystem really is hard to use directly.

## Quality axes

- **change_cost** ⊕ (primary): Setup order and wiring of a subsystem live in one entry point, so upgrading or replacing the dependency changes one module instead of every caller.
- **delivery** −: Another layer to write and maintain in front of the subsystem.

**Flips:** Over a subsystem that is already simple it is a pass-through, and left to cover every feature it grows into a god object coupled to everything.

## Warranted when

- Several callers repeat the same setup, ordering and wiring of a library's objects.
- Business logic is tangled with the details of a large third-party library or external API.
- You want to split a system into layers, each with a clear entry point, or limit what changes when a dependency is upgraded or replaced.

## How it shows

- A class or module with a few high-level methods that set up and coordinate several lower-level objects behind it.
- Callers importing the facade instead of reaching into the many classes of a library or subsystem.

## Overdone when

- A facade that grows to cover every feature of the subsystem and becomes a god object coupled to everything.
- A facade over something already simple, adding a pass-through layer.
- Forbidding direct access to the subsystem even for callers that need its full power.

## Example

Before:

```
fn signup(req):
    schema = db_admin.create_schema("t_" + req.slug)
    db_admin.run_migrations(schema)
    bucket = storage.create_bucket(req.slug, region=req.region)
    roles.seed_defaults(schema)
    roles.grant(schema, req.owner_email, "admin")
    mailer.send_welcome(req.owner_email, bucket.url)

# the admin CLI and the test fixtures repeat the same six steps in the same order
```

After:

```
class TenantProvisioning:
    fn init(db_admin, storage, roles, mailer): ...
    fn create(slug: str, region: str, owner_email: str) -> Tenant:
        schema = self.db_admin.create_schema("t_" + slug)
        self.db_admin.run_migrations(schema)
        bucket = self.storage.create_bucket(slug, region=region)
        self.roles.seed_defaults(schema)
        self.roles.grant(schema, owner_email, "admin")
        self.mailer.send_welcome(owner_email, bucket.url)
        return Tenant(slug, schema, bucket)

fn signup(req): provisioning.create(req.slug, req.region, req.owner_email)
```

The setup order lives in one entry point that signup, the CLI and tests share, while callers with unusual needs can still use the subsystems directly.

## By language

**python:** Often just a module with a handful of functions, or a package's __init__ that re-exports a small public API, rather than a class. Context managers are a natural facade for setup and teardown sequences.

**typescript:** Common in TypeScript apps, especially in front of large libraries and APIs. It is often just a module that exports a few functions and hides the library behind them, with no class at all. An API client or service module that wraps a generated SDK is the typical example. Spotting it: A class or module with a small public surface that delegates most of its work to other objects and often manages their lifecycle.

**java:** Common around complex libraries and enterprise APIs. Jakarta Faces' FacesContext and ExternalContext hide lifecycle, navigation and servlet internals. In layered Spring applications, the service layer often plays this role over repositories and clients. Watch for facades that grow into god classes. Spotting it: A class with a small, simple API whose methods mostly delegate to several subsystem objects it creates or owns.

**csharp:** Common in C# apps that depend on large or awkward libraries. Application "service" classes that sit in front of repositories, external clients and SDKs are usually facades under another name. File and Directory static helpers are a standard-library example of a simple front over a more detailed API. Spotting it: A class with a small public surface that creates, holds and disposes several lower-level objects and delegates most of its work to them.

**go:** In Go the package is the usual facade. A small exported API sits in front of unexported helpers or internal/ packages, and the boundary is enforced by capitalisation rather than by a dedicated class. A facade struct that holds several subsystem clients also shows up at service layers. Its main risk is turning into a god object. Spotting it: A package or struct whose exported methods each orchestrate calls into several unexported types or internal packages.

**rust:** A plain struct owning its subsystems as fields, with a few methods that return `Result` and chain the steps with `?`. Rust's module system already provides most facades. A crate root or `mod.rs` that exposes a small `pub` API with `pub use` re-exports and keeps internals at `pub(crate)` is the usual form. Spotting it: A struct that owns several unrelated service structs and has a few high-level methods, or a module whose public surface is a handful of re-exports over private submodules.

**cpp:** Widely used in C++ to put a small interface over large or awkward libraries. Facades often own the subsystem objects they use, creating them in the constructor and releasing them through RAII. A header that exposes only the facade and keeps the subsystem out of it also shortens compile times. Spotting it: A class with a small public interface that delegates most work to other objects, and which constructs and owns those objects itself.

## Related

[Adapter](adapter.md) · [Mediator](mediator.md) · [Proxy](proxy.md) · [Abstract Factory](abstract-factory.md) · [Singleton](singleton.md) · [Flyweight](flyweight.md) · [God object (The Blob)](god-object.md)

## Sources

- [Refactoring.Guru, Facade](https://refactoring.guru/design-patterns/facade) (read)
- [Refactoring.Guru, Facade in Python](https://refactoring.guru/design-patterns/facade/python/example) (read)
- [Refactoring.Guru, Facade in TypeScript](https://refactoring.guru/design-patterns/facade/typescript/example) (read)
- Established TypeScript practice (module-as-facade) (recalled)
- [Refactoring.Guru, Facade in Java](https://refactoring.guru/design-patterns/facade/java/example) (read)
- [Refactoring.Guru, Facade in C#](https://refactoring.guru/design-patterns/facade/csharp/example) (read)
- System.IO.File and Directory helpers (recalled)
- [Refactoring.Guru, Facade in Go](https://refactoring.guru/design-patterns/facade/go/example) (read)
- [Go command documentation, Internal directories](https://pkg.go.dev/cmd/go#hdr-Internal_packages) (recalled)
- [Refactoring.Guru, Facade in Rust](https://refactoring.guru/design-patterns/facade/rust/example) (read)
- Rust module visibility and re-export conventions (recalled)
- [Refactoring.Guru, Facade in C++](https://refactoring.guru/design-patterns/facade/cpp/example) (read)
