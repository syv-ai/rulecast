<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Dependency Injection

`dependency-injection` · design patterns, design

Hand an object the collaborators it needs (usually through its constructor) instead of letting it create or look them up, and wire the whole graph in one place at startup, the composition root.

*Names:* The term was settled in Fowler's article "Inversion of Control Containers and the Dependency Injection pattern" (2004), chosen with the PicoContainer and Spring community to replace the vaguer Inversion of Control. Mark Seemann's Dependency Injection in .NET (2011) named the composition root and the Service Locator anti-pattern. Containers (Spring, ASP.NET Core's service collection, Guice) are one way to do the wiring; doing it by hand is called pure DI.

*Matters most for:* web-api, cli-devtool, library-sdk, plugin-host

## But

DI is about where wiring happens, not about containers. Containers add magic, runtime wiring errors and lifetime bugs (a scoped service captured by a singleton). Fowler himself wrote in 2004 that a Service Locator is roughly equivalent for application classes, with a slight edge for being more straightforward, and that it is just as easy to stub in tests; DI wins for classes reused across applications. Seemann later argued the opposite, calling Service Locator an anti-pattern because it hides dependencies. Long constructor lists are a sign the class does too much, not a reason to switch to setter injection. Small programs can pass arguments without any of the vocabulary.

## Quality axes

- **change_cost** ⊕ (primary): Collaborators arrive as parameters, so tests pass fakes without patching globals and environments swap implementations.
- **delivery** −: Every collaborator has to be threaded through constructors and wired in the composition root.

**Flips:** Auto-wiring containers bring hidden wiring, runtime wiring errors and lifetime bugs (reliability "-"), and injecting things that never vary, or an interface per class, is ceremony.

## Warranted when

- Code calls now(), opens connections or reads environment variables deep inside, so it can't be tested without the real thing.
- Singletons or module-level clients are reached from everywhere.
- Different environments (tests, CLI, production) need different implementations.

## How it shows

- Constructors or factory functions that take clock, repository, client and config as parameters.
- One main or startup module that builds the real implementations and passes them down.
- Tests that construct the object under test with fakes, without patching globals.

## Overdone when

- Injecting things that never vary (pure functions, value objects, the standard library).
- An interface for every class only so it can be injected and mocked.
- Containers with auto-wiring and scanning where a ten-line main would do, so nobody can see what gets built.
- Service Locator dressed up as DI, with a container passed around and queried.

## Example

Before:

```
class ReportScheduler:
    fn run_due():
        now = system_clock_now()
        for r in Database.instance().due_reports(now):
            pdf = render(r)
            SmtpMailer(env("SMTP_HOST")).send(r.recipients, pdf)

# the test needs a real database, a real SMTP server and a frozen system clock
```

After:

```
class ReportScheduler:
    fn init(reports: ReportStore, mailer: Mailer, clock: Clock): ...
    fn run_due():
        for r in self.reports.due(self.clock.now()):
            self.mailer.send(r.recipients, render(r))

fn main():                                 # composition root
    db = connect(env("DB_URL"))
    scheduler = ReportScheduler(PgReportStore(db), SmtpMailer(env("SMTP_HOST")), SystemClock())
```

The scheduler states what it needs, main builds the real ones, and a test passes fakes without any container.

## By language

**java:** Spring is container-first; constructor injection (with final fields and no @Autowired on fields) is the Spring team's own recommendation.

**csharp:** ASP.NET Core has the container built in (IServiceCollection); register with the right lifetime (transient, scoped, singleton) and inject through constructors or minimal API parameters.

**python:** Mostly plain arguments; FastAPI's Depends is a request-scoped injection system for handlers. Libraries like dependency-injector exist but are uncommon; module-level clients patched in tests are the common shortcut and the thing DI replaces.

**typescript:** NestJS and Angular have containers; elsewhere a createApp(deps) factory or plain parameters is the norm. Module mocking (jest.mock) is the shortcut DI replaces.

**go:** Pure DI is idiomatic: main builds the dependencies and passes them to constructors (NewServer(store, logger)), with consumer-defined interfaces. Wire and fx exist for very large graphs.

**rust:** Passing values or trait objects (Arc<dyn Trait>) or generics into constructors; axum's State and actix's Data carry shared dependencies to handlers. No mainstream container.

## Related

[Singleton](singleton.md) · [Global state](global-state.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Mocking Everything (over-mocking)](mock-everything.md) · [Abstract Factory](abstract-factory.md) · [Strategy](strategy.md) · [SOLID](solid.md)

## Sources

- [Martin Fowler, Inversion of Control Containers and the Dependency Injection pattern (2004)](https://martinfowler.com/articles/injection.html) (read)
- [Mark Seemann, Dependency Injection in .NET (2011), Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) (recalled)
- [Mark Seemann, Service Locator is an Anti-Pattern (2010)](https://blog.ploeh.dk/2010/02/03/ServiceLocatorisanAnti-Pattern/) (recalled)
