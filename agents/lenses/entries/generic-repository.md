<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Generic Repository

`generic-repository` · anti-patterns, design · **contested** · **agents do this**

A single Repository<T> with get, get_all, add, update and delete that sits over an ORM which already offers all of that, so it adds a layer without adding meaning and often hides the ORM's useful features.

*Names:* Debated mostly in .NET. Critics include Oren Eini (Ayende), "Repository is the new Singleton" (2009), and later Jimmy Bogard, who favours query objects over repositories. It is defended in a form with specifications by Steve Smith (Ardalis). No single coiner.

*Matters most for:* web-api, fullstack-web

## But

Contested. Its defenders (Steve Smith, Ardalis) pair a generic base with the Specification pattern, which keeps query logic named and reusable and keeps EF out of the domain; teams that value that separation find it worth it. A generic base under specific repository interfaces is also reasonable, since it only shares implementation. The anti-pattern is the generic interface used as the whole abstraction, over an ORM that already is a repository and unit of work.

## Quality axes

- **change_cost** −: A layer that adds no meaning must still be maintained, and each new query shape means another method on the base or a leaky query builder.
- **runtime** −: Callers fetch everything with get_all and filter in memory instead of in the query.

**Flips:** Contested. Paired with specifications, or as a shared base under specific repository interfaces, teams that value keeping the ORM out of the domain find it worth it.

## Why people fall into it

- Tutorials and templates present it as the standard clean-architecture layer.
- Wanting to swap the database later, or to mock data access in unit tests.
- DRY applied to the five CRUD methods every repository would otherwise repeat.

## How it shows

- An IRepository<T> or BaseRepository<T> interface with CRUD methods and one EF, JPA or TypeORM implementation.
- Services that call get_all() and filter in memory, or that need a new method on the base for every query shape.
- get_all returning IQueryable or a query builder, so the ORM leaks through anyway.

## Overcorrecting looks like

- Spreading ORM calls through controllers and views with no seam at all, so query logic is duplicated and domain code depends on the ORM everywhere.
- Refusing any repository, even where a real domain model or a second store would benefit.

## What to do

Use the ORM directly in the application layer for simple cases, or write specific repositories with intention-revealing methods (one per aggregate), or use query objects or specifications for reads. Test against a real or in-memory database rather than mocking the repository.

## Example

Before:

```
interface Repository<T>:
    fn get(id) -> T
    fn all() -> list[T]
    fn add(item: T)
    fn update(item: T)
    fn delete(item: T)

fn open_courses_for(student):
    courses = course_repo.all()                    # loads every course
    return filter(courses, fn(c): c.is_open and c.level <= student.level)
```

After:

```
interface CourseCatalog:
    fn open_for_level(level: int) -> list[Course]

class OrmCourseCatalog implements CourseCatalog:
    fn open_for_level(level):
        return self.orm.courses.where(is_open=true, level_lte=level).list()

fn open_courses_for(student): return catalog.open_for_level(student.level)
```

The interface names the question the domain asks, and the filter runs in the database instead of in memory.

## By language

**csharp:** The main battleground. DbSet is already a repository and DbContext a unit of work; Microsoft's guidance treats a custom layer as optional. Returning IQueryable from a repository defeats its purpose.

**java:** Spring Data's CrudRepository is a generic repository supplied by the framework, which is fine; writing your own GenericDao<T> over JPA on top of it is the redundant form.

**typescript:** Hand-written BaseRepository<T> over TypeORM or Prisma, often from NestJS templates, duplicates what the ORM already offers.

**python:** Less common; a generic CRUDBase over SQLAlchemy is the same shape.

**go:** Generics made Repository[T any] possible, but Go favours small consumer-defined interfaces, so the pattern is rare and usually discouraged.

## Related

[Repository](repository.md) · [Unit of Work](unit-of-work.md) · [Misapplied Genericity](misapplied-genericity.md) · [Speculative Generality](speculative-generality.md) · [Middle Man](middle-man.md) · [Over-Engineering](over-engineering.md) · [Mocking Everything (over-mocking)](mock-everything.md)

## Overlaps

active-record or data-mapper is the persistence choice. repository sits on a data mapper and speaks the domain's language; generic-repository is a repository that just re-exposes the ORM.

## Sources

- [Oren Eini (Ayende Rahien), Repository is the new Singleton (2009)](https://ayende.com/blog/3955/repository-is-the-new-singleton) (recalled)
- [Steve Smith (Ardalis), Ardalis.Specification](https://github.com/ardalis/Specification) (recalled)
- [Microsoft, Design the infrastructure persistence layer (.NET microservices guide)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design) (recalled)
