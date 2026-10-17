<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Unit of Work

`unit-of-work` · design patterns, design

Track every object a business operation loads, creates or changes, then write all the changes out together in one commit, so the operation succeeds or fails as a whole.

*Names:* Named in Fowler's PoEAA (2002). Implemented as Hibernate's Session and JPA's EntityManager, EF Core's DbContext, SQLAlchemy's Session.

*Matters most for:* web-api, databases-storage

## But

Change tracking is implicit magic: objects mutated anywhere get written at commit, which surprises people and makes it easy to persist something by accident. Without an ORM, a plain database transaction around the operation gives the same all-or-nothing behaviour more visibly. Writing your own unit of work is rarely worth it when the ORM has one.

## Quality axes

- **reliability** ⊕ (primary): All changes in an operation commit together or not at all, so a failure halfway leaves no partial writes.
- **runtime** +: Writes are batched at commit instead of a round trip per object.
- **change_cost** −: Implicit change tracking writes whatever was mutated, which surprises readers and makes accidental persistence easy.

**Flips:** Units spanning user think-time or long jobs hold locks and stale state, turning reliability "-"; re-wrapping an ORM session that already is one is pure ceremony.

## Warranted when

- One operation changes several objects or tables that must stay consistent.
- Code saves each object as it goes, so a failure halfway leaves partial writes.
- Writes are chatty, and batching them would cut round trips.

## How it shows

- A session or context object opened per request or per use case, with a single commit at the end.
- Domain code that changes objects and never calls save on each one.
- Context managers or middleware that commit on success and roll back on error.

## Overdone when

- Wrapping an ORM session that already is a unit of work in a custom one with the same methods.
- Units of work that span user think-time or long jobs, holding locks or stale state.

## Example

Before:

```
fn transfer_stock(sku, qty, from_wh, to_wh):
    src = warehouses.get(from_wh)
    src.remove(sku, qty)
    warehouses.save(src)
    dst = warehouses.get(to_wh)
    dst.add(sku, qty)               # raises: destination full
    warehouses.save(dst)
    # stock has left the source and arrived nowhere
```

After:

```
fn transfer_stock(uow, sku, qty, from_wh, to_wh):
    with uow:
        src = uow.warehouses.get(from_wh)
        dst = uow.warehouses.get(to_wh)
        src.remove(sku, qty)
        dst.add(sku, qty)
        uow.commit()                # both changes, or neither
```

The changes are collected and written once, so a failure partway rolls back the whole transfer.

## By language

**python:** SQLAlchemy's Session is the unit of work; Cosmic Python wraps it in an explicit UoW context manager to keep the service layer storage-agnostic. Django uses transaction.atomic around explicit saves instead.

**java:** The JPA persistence context, with Spring's @Transactional marking the boundary; dirty checking flushes changed entities at commit.

**csharp:** DbContext tracks changes and SaveChanges commits them; one DbContext per request is the ASP.NET Core default lifetime.

**typescript:** TypeORM's EntityManager inside a transaction and MikroORM's EntityManager (an explicit unit of work with identity map) fit; Prisma has no change tracking, so $transaction groups explicit writes instead.

**go:** No change tracking; the idiom is a *sql.Tx passed to every write in the operation, committed once, often through a helper that takes a function and handles rollback.

**rust:** A sqlx Transaction or Diesel's conn.transaction closure; dropping a sqlx transaction without commit rolls it back, which gives all-or-nothing by construction.

## Related

[Identity Map](identity-map.md) · [Repository](repository.md) · [Data Mapper](data-mapper.md) · [Service Layer](service-layer.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Unit of Work (catalog summary)](https://martinfowler.com/eaaCatalog/unitOfWork.html) (read)
- [Harry Percival and Bob Gregory, Architecture Patterns with Python (Cosmic Python), ch. 6](https://www.cosmicpython.com/book/chapter_06_uow.html) (recalled)
