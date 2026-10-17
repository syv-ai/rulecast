<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# The Dependency Rule

`dependency-rule` · principles, architecture

Source code dependencies point inward, toward policy. Business rules never import the database, the web framework or the UI; those outer parts depend on the rules, and where control has to flow outward the inner code defines an interface for the outer code to implement.

*Names:* Named by Robert C. Martin in "The Clean Architecture" (2012) and the book Clean Architecture (2017). It generalises his Dependency Inversion Principle (the D in SOLID) and his Stable Dependencies and Stable Abstractions principles to whole systems. The same rule underlies Cockburn's ports and adapters and Palermo's onion architecture.

*Matters most for:* web-api, fullstack-web, mobile, desktop

## But

The rule assumes there is a stable core worth protecting. In small apps, scripts, and code whose whole point is the framework (a Django admin, a CLI wrapper over one SDK), following it buys indirection and nothing else. Committing deliberately to a framework is a legitimate choice, and some teams accept ORM entities as domain objects to avoid a mapping layer. Martin's own descriptions of the rings are schematic; the rule is the inward direction, not a fixed count of layers, and treating the four circles as mandatory projects is a common misreading.

## Quality axes

- **change_cost** ⊕ (primary): A framework, ORM or vendor change stays out of business-rule files, and the core is unit tested without booting infrastructure.
- **delivery** −: Interfaces in the core, adapters outside and mapping to plain data at each boundary all have to be written first.

**Flips:** In small apps, scripts and code whose whole point is the framework, the rings are indirection with no stable core behind them, so change_cost turns "-".

## Warranted when

- A framework or ORM upgrade forces edits in business-rule files.
- Domain code can't be unit tested without booting the framework or a database.
- Framework types (request objects, ORM entities, SDK clients) appear in the signatures of business functions.
- The rules are expected to outlive the current framework or delivery mechanism.

## How it shows

- Domain or core modules whose imports are only the standard library and each other.
- Interfaces declared in the inner package and implemented in an outer one (repository in domain, SqlRepository in infrastructure).
- Plain data (DTOs, records) crossing boundaries rather than ORM rows or framework request objects.
- Build or lint rules (separate projects, crates, import contracts) that fail when an inner module imports an outer one.

## Overdone when

- Wrapping types that are effectively part of the language platform (dates, decimals, collections) so the core imports "nothing".
- Treating a thin CRUD app's handlers as outer rings around an empty core.
- Copying every value into a boundary DTO even when the inner and outer shape are identical and owned by the same team.

## What to do

Invert the offending import by declaring an interface in the inner module and implementing it in the outer one, and map framework types to plain data at the boundary.

## Example

Before:

```
# domain/credit.py
import web_framework.Request
import orm.Session

class CreditPolicy:
    fn approve(request: Request, session: Session) -> bool:
        applicant = session.query(ApplicantRow).get(request.params["id"])
        return applicant.income > 3 * applicant.monthly_debt
```

After:

```
# domain/credit.py  (imports nothing from outer layers)
interface Applicants:
    fn get(id) -> Applicant

class CreditPolicy:
    fn approve(applicant: Applicant) -> bool:
        return applicant.income > 3 * applicant.monthly_debt

# web/credit_handler.py  (outer layer depends inward)
fn handle(request: Request):
    applicant = applicants.get(request.params["id"])
    return policy.approve(applicant)
```

The policy no longer knows about requests or ORM sessions; the handler, which is outer, does the translation and depends on the policy.

## One-file tell

Path-aware, for Python, TypeScript and Java: a file under a domain, core or entities directory that imports a web framework, ORM or cloud SDK (Python `fastapi`, `flask`, `django`, `sqlalchemy`, `boto3`; TypeScript `express`, `@nestjs/*`, `prisma`, `typeorm`; Java `org.springframework.*`, `jakarta.persistence.*`). Only meaningful in a codebase that has declared such a directory as its core.

## By language

**python:** Nothing stops a circular or outward import until runtime. import-linter "layers" and "forbidden" contracts are the usual enforcement. Watch for Pydantic or SQLAlchemy models used as the domain model; that may be an accepted trade, but it means the core depends on them.

**typescript:** Enforce with dependency-cruiser, eslint-plugin-boundaries or Nx module boundaries. Type-only imports (`import type`) still create a design dependency even though they vanish at runtime.

**java:** ArchUnit tests or JPMS module-info exports enforce it. Annotations from JPA, Jackson or Spring on domain classes are an outward dependency, even though they look like metadata.

**csharp:** Separate assemblies make the compiler enforce it: the core project references no infrastructure project. EF Core attributes on domain entities break it; fluent configuration in the infrastructure project keeps it.

**go:** Go forbids import cycles between packages, which helps but doesn't fix direction. Consumer-declared interfaces keep inner packages from importing adapters; an `internal/` tree limits who can import what.

**rust:** Crates in a workspace can't form cycles, so putting the core in its own crate with no dependency on the adapter crates enforces the rule at build time. Inside one crate, module privacy is the only tool.

## Related

[Ports and Adapters](ports-and-adapters.md) · [Layered Architecture](layered-architecture.md) · [SOLID](solid.md) · [The Law of Leaky Abstractions](law-of-leaky-abstractions.md)

## Overlaps

dependency-rule is the principle (dependencies point toward policy). dependency-inversion-principle is the same idea at the scale of one dependency: the interface belongs to the code that needs it, which is how a single import is made to point inward. ports-and-adapters is the architecture built on both, and layered-architecture the older style it corrects, where the domain depends on persistence.

## Sources

- [Robert C. Martin, The Clean Architecture (blog, 2012)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (read)
- Robert C. Martin, Clean Architecture (2017), The Dependency Rule (recalled)
