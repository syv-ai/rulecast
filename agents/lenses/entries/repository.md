<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Repository

`repository` · design patterns, design

Give the domain a collection-like interface for getting and storing its objects, so callers ask for "the overdue loans" and never see how the query is built or where the rows live.

*Names:* Named in Fowler's Patterns of Enterprise Application Architecture (2002), where the pattern is credited to Edward Hieatt and Rob Mee. Eric Evans's Domain-Driven Design (2003) gave it its DDD role as one repository per aggregate root. Frameworks reuse the name loosely (Spring Data repositories, Django managers play a similar role).

*Matters most for:* web-api, fullstack-web, databases-storage

## But

Modern ORMs already give you a repository and a unit of work (EF Core's DbSet and DbContext, SQLAlchemy's Session, Hibernate's EntityManager), so wrapping them again often adds a layer that hides useful features such as projections, eager loading and streaming. Oren Eini (Ayende) and others have argued that for most applications a thin query object or direct ORM use in the application layer is simpler. The pattern pays off when there is a real domain model to protect, heavy query reuse, or a need to test domain logic without a database. For a CRUD app it is usually ceremony.

## Quality axes

- **change_cost** ⊕ (primary): Query logic is written once behind intention-revealing methods, and domain code can be tested against an in-memory implementation.
- **delivery** −: A repository interface and implementation are another layer to write per aggregate.

**Flips:** Labelled for the domain-collection repository over a real domain model. Wrapping an ORM that already is a repository, especially in a CRUD app, adds a layer that hides projections, eager loading and streaming (runtime "-"), and multiplying finders turn it into a query dump.

## Warranted when

- The same query logic is written out in several services or handlers.
- Domain code is tangled with ORM sessions, query builders or SQL strings.
- Tests need to run domain logic without a database.
- The storage technology may really change, or several stores sit behind one kind of object.

## How it shows

- Interfaces or classes named after a domain noun plus Repository, with intention-revealing finders (find_overdue, by_member) and add or save methods.
- Domain and service code that depends on the repository interface, while the ORM or SQL lives only in its implementation.
- An in-memory implementation used by tests.

## Overdone when

- A repository for every table, including lookup tables only one screen reads.
- A repository that only forwards to an ORM that is already a repository (see generic-repository).
- Finder methods multiplying into dozens of one-off queries (find_by_a_and_b_ordered_by_c), which turns the repository into a query dump.

## Example

Before:

```
fn send_overdue_notices(db):
    rows = db.execute("SELECT * FROM loans WHERE due < now() AND returned IS NULL")
    for r in rows: notify(r.member_id, r.book_id)

fn overdue_fees(db, member_id):
    rows = db.execute("SELECT * FROM loans WHERE due < now() AND returned IS NULL"
                      + " AND member_id = ?", member_id)
    return total_fees(rows)
```

After:

```
interface LoanRepository:
    fn overdue() -> list[Loan]
    fn overdue_for(member: MemberId) -> list[Loan]
    fn add(loan: Loan)

fn send_overdue_notices(loans: LoanRepository):
    for loan in loans.overdue(): notify(loan.member, loan.book)

fn overdue_fees(loans: LoanRepository, member):
    return total_fees(loans.overdue_for(member))
```

The meaning of "overdue" is written once behind a domain-shaped interface, and callers can be tested with an in-memory list.

## By language

**java:** Spring Data generates repository implementations from interfaces (JpaRepository, derived query methods), so the interface is the pattern and you write little code. Watch for derived-method names that grow unreadable; move those to @Query or a specification.

**csharp:** EF Core's DbContext already acts as unit of work and DbSet as a repository, and Microsoft's own guidance treats a custom repository as optional. A generic repository plus specifications (Ardalis.Specification) is one well-known style in .NET reference architectures, not the only one.

**python:** Django has no repository by default; the model manager and QuerySet fill the role, and custom manager methods are the idiomatic home for named queries. With SQLAlchemy, a repository class over a Session is common in DDD-style code (Cosmic Python), while FastAPI apps often query directly in a crud module.

**typescript:** TypeORM ships a Repository per entity; Prisma's client is effectively one per model. A custom repository is worth it mainly to keep Prisma or TypeORM types out of the domain.

**go:** Usually a small interface defined by the consumer (a store or repo interface in the package that uses it) with a database/sql or sqlc implementation. Go favours narrow interfaces with only the methods that consumer needs.

**rust:** A trait for the repository with a sqlx or Diesel implementation, often async. Generic trait bounds or trait objects make it swappable in tests, but many Rust services just pass a pool and call query functions.

## Related

[Generic Repository](generic-repository.md) · [Data Mapper](data-mapper.md) · [Unit of Work](unit-of-work.md) · [Domain Model](domain-model.md) · [Table Data Gateway](table-data-gateway.md) · [Facade](facade.md) · [Over-Engineering](over-engineering.md)

## Overlaps

active-record or data-mapper is the persistence choice. repository sits on a data mapper and speaks the domain's language; generic-repository is a repository that just re-exposes the ORM.

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Repository (catalog summary)](https://martinfowler.com/eaaCatalog/repository.html) (read)
- [Eric Evans, Domain-Driven Design (2003), Repositories](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (recalled)
- [Microsoft, Design the infrastructure persistence layer (.NET microservices guide)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design) (recalled)
