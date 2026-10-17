<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Data Mapper

`data-mapper` · design patterns, design

Move data between domain objects and the database with a separate mapping layer, so the domain objects know nothing about tables and the schema can differ from the object model.

*Names:* Named in Fowler's PoEAA (2002). Hibernate and JPA, EF Core, SQLAlchemy's ORM and Doctrine are Data Mappers; most people meet it as "the ORM" without the name.

*Matters most for:* web-api, databases-storage

## But

The independence costs a mapping layer, and hand-written mappers are tedious and drift. When the domain mirrors the tables, Active Record or plain queries into structs is simpler. Full ORMs that implement this pattern are also where Ted Neward's "Vietnam of computer science" critique of object-relational mapping lands: the mismatch never fully goes away, so expect to drop to SQL for reports and bulk work.

## Quality axes

- **change_cost** ⊕ (primary): Domain objects know nothing about tables, so schema and model change separately and the domain is tested without a database.
- **delivery** −: A mapping layer has to be written and kept in step with both sides.

**Flips:** When objects are identical to their rows, hand-written mappers double every change for nothing, turning change_cost "-".

## Warranted when

- The object model and the schema have diverged (value objects spread over columns, inheritance, legacy tables).
- Domain logic needs to be tested without a database.
- A rich domain model must not depend on the persistence technology.

## How it shows

- Domain classes with no base class from the ORM and no save methods.
- Mapping configuration in separate files or classes (EF configurations, SQLAlchemy registry, ORM XML or annotations kept to the infrastructure layer).
- Hand-written mappers with to_domain and from_domain functions between row structs and domain types.

## Overdone when

- Hand-written mappers for objects that are identical to their rows, doubling every change.
- A separate domain type and persistence type for each table in a CRUD app.

## Example

Before:

```
class Patient extends Record:          # table: patients
    first_name: str
    last_name: str
    dob_text: str                       # legacy column, "DD/MM/YYYY"
    fn age() -> int: return years_since(parse_date(self.dob_text))
    fn admit(ward): ... self.save()

# domain code parses legacy column formats and can't be tested without a database
```

After:

```
class Patient:                          # plain domain object
    name: PersonName
    birth_date: Date
    fn age() -> int: return years_since(self.birth_date)

class PatientMapper:
    fn to_domain(row) -> Patient:
        return Patient(PersonName(row.first_name, row.last_name), parse_date(row.dob_text))
    fn to_row(p: Patient) -> PatientRow: ...
```

The schema's quirks stay in the mapper, and the domain object is plain and testable on its own.

## By language

**java:** JPA and Hibernate are Data Mappers, but annotations on entity classes put mapping metadata on the domain object; purists use orm.xml or separate persistence entities.

**csharp:** EF Core with IEntityTypeConfiguration classes keeps mapping out of entities; Dapper is a thin mapper from rows to objects with SQL you write.

**python:** SQLAlchemy is a Data Mapper; its imperative (classical) mapping lets domain classes stay plain, as Cosmic Python shows.

**typescript:** TypeORM in repository mode and MikroORM are Data Mappers. With Prisma, a hand-written mapper from Prisma types to domain types is the common way to keep the domain independent.

**go:** Usually explicit: sqlc or database/sql scans into row structs, and a small function converts to domain types when they differ.

**rust:** sqlx's FromRow and Diesel's Queryable map rows to structs; separate domain types with From or TryFrom conversions are the idiom when they differ.

## Related

[Active Record](active-record.md) · [Repository](repository.md) · [Unit of Work](unit-of-work.md) · [Identity Map](identity-map.md) · [Domain Model](domain-model.md) · [The Law of Leaky Abstractions](law-of-leaky-abstractions.md)

## Overlaps

active-record or data-mapper is the persistence choice. repository sits on a data mapper and speaks the domain's language; generic-repository is a repository that just re-exposes the ORM.

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Data Mapper (catalog summary)](https://martinfowler.com/eaaCatalog/dataMapper.html) (read)
- [Ted Neward, The Vietnam of Computer Science (2006)](https://www.odbms.org/wp-content/uploads/2013/11/031.01-Neward-The-Vietnam-of-Computer-Science-June-2006.pdf) (recalled)
