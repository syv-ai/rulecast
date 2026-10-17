<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Ports and Adapters

`ports-and-adapters` · design patterns, architecture · **contested**

Keep the application core free of technology. It talks to the outside world only through ports, which are interfaces it defines, and each database, UI, queue or test harness plugs in through an adapter that translates to that port.

*Names:* Named by Alistair Cockburn in his article "Hexagonal Architecture" (dated 2005). Also called hexagonal architecture; the hexagon is only there to leave room in the drawing. Cockburn calls the two sides primary (driving) and secondary (driven). Jeffrey Palermo's Onion Architecture (2008) and Robert C. Martin's Clean Architecture (2012) are close variants that add named inner rings (domain model, use cases) around the same inside/outside split.

*Matters most for:* web-api, fullstack-web, distributed, event-driven, plugin-host

## But

The cost is indirection and mapping code, and it only pays off when there is real logic in the core and real variation or test pain at the edges. Many thin services are better as a transaction script straight against the framework. Critics such as DHH have long argued that wrapping the ORM or the framework you have committed to gives you a second, worse API for no gain. The test benefit also shrinks where real dependencies are cheap to run in tests (SQLite, testcontainers). Ports should be shaped by what the core needs, not by the technology behind them; a port that leaks SQL or HTTP concepts gives the cost without the benefit.

## Quality axes

- **change_cost** ⊕ (primary): The core names what it needs in its own terms, so it is testable with in-memory adapters and a database, queue or vendor is swapped at the edge.
- **delivery** −: Ports, adapters and mapping code at every boundary.

**Flips:** In a thin CRUD service with no real rules every field change edits several layers and change_cost turns "-"; ports that mirror the vendor's API give the cost without the benefit.

## Warranted when

- Business rules are tangled with framework, SQL or SDK calls, so they can't be tested without the real database or service.
- The same use case must be driven from more than one place (HTTP, CLI, a queue, a scheduled job, tests).
- An external dependency is volatile, slow or expensive to run in tests (a payment provider, a third-party API, hardware).
- The domain logic is rich enough that keeping it readable apart from plumbing pays off.

## How it shows

- A core or domain package that defines interfaces such as a repository, a notifier or a clock, and an infrastructure or adapters package that implements them.
- The same port with two implementations, usually a real one and an in-memory one used by tests.
- HTTP handlers, CLI commands and queue consumers that all call the same application service rather than each holding logic.
- A composition root (main, a DI module, Program.cs) that wires adapters to ports in one place.

## Overdone when

- A port and an adapter for every dependency, including stable ones like the standard library or a logging facade.
- Ports that mirror the vendor's API one to one, so the adapter translates nothing and the core still thinks in the vendor's terms.
- A CRUD service with no real rules split into domain, application and infrastructure projects, so every field change edits five files.
- Mapping between identical DTO, domain and persistence types at every boundary.

## Example

Before:

```
class PayslipService:
    fn issue(employee_id):
        emp = sql.query("select * from employees where id = ?", employee_id)
        payslip = compute_payslip(emp)
        smtp = SmtpClient("mail.internal", 25)
        smtp.send(emp.email, render_pdf(payslip))
# testing issue() needs a real database and a mail server
```

After:

```
interface Employees:            # ports, owned by the core
    fn get(id) -> Employee
interface PayslipSender:
    fn send(employee: Employee, payslip: Payslip)

class PayslipService:
    fn init(employees: Employees, sender: PayslipSender): ...
    fn issue(employee_id):
        emp = self.employees.get(employee_id)
        self.sender.send(emp, compute_payslip(emp))

class SqlEmployees implements Employees: ...      # adapters, outside the core
class SmtpPayslipSender implements PayslipSender: ...
```

The core names what it needs in its own terms; SQL and SMTP become swappable adapters, and tests plug in in-memory ones.

## By language

**python:** Ports are usually typing.Protocol classes or abstract base classes in the core package; adapters are plain classes elsewhere. Without a DI container, wiring is done by hand in a composition function or FastAPI's Depends. import-linter can enforce that the core never imports adapters.

**typescript:** Structural typing means an adapter satisfies a port without naming it, and a port can be a type alias for a function. Enforce the direction with dependency-cruiser or eslint-plugin-boundaries; nothing in the language stops a core file importing an adapter.

**java:** Ports are interfaces in the domain or application package, adapters are Spring or Jakarta beans, and the container does the wiring. The danger is framework annotations (JPA @Entity, @Transactional) creeping into the core; ArchUnit or JPMS modules can enforce the split.

**csharp:** Commonly done as separate projects (Core or ApplicationCore, Infrastructure, Web). The compiler then enforces the dependency rule only if the core project references nothing outward, including shared DTO projects, so check its project references. Wiring goes through Microsoft.Extensions.DependencyInjection in Program.cs.

**go:** Interfaces are satisfied implicitly, so Go's idiom is for the consumer to declare the small interface it needs, next to the code that uses it, rather than the provider exporting one. That is a port by default. Wiring is explicit in main; DI containers are rare.

**rust:** Ports are traits. Choose generics for zero-cost static dispatch or `dyn Trait` for runtime choice and smaller compile times. Splitting a workspace into a core crate and adapter crates makes Cargo enforce the direction, since dependency cycles between crates are impossible.

## Related

[The Dependency Rule](dependency-rule.md) · [Layered Architecture](layered-architecture.md) · [Adapter](adapter.md) · [SOLID](solid.md) · [Microkernel (plugin architecture)](microkernel.md)

## Overlaps

dependency-rule is the principle (dependencies point toward policy). dependency-inversion-principle is the same idea at the scale of one dependency: the interface belongs to the code that needs it, which is how a single import is made to point inward. ports-and-adapters is the architecture built on both, and layered-architecture the older style it corrects, where the domain depends on persistence.

## Sources

- [Alistair Cockburn, Hexagonal Architecture (Ports and Adapters), 2005](https://alistair.cockburn.us/hexagonal-architecture/) (read)
- [Robert C. Martin, The Clean Architecture (blog, 2012)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (read)
- [Jeffrey Palermo, The Onion Architecture, part 1 (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) (recalled)
