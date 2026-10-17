<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Identity Map

`identity-map` · design patterns, design

Keep a map of every object loaded in the current operation, keyed by id, so loading the same record twice returns the same object instead of two copies that can disagree.

*Names:* Named in Fowler's PoEAA (2002). Built into Hibernate and JPA's persistence context, EF Core's change tracker, SQLAlchemy's Session and MikroORM; rarely written by hand.

*Matters most for:* databases-storage

## But

It only guarantees one copy per session, not per process or database, so it is not a cache and not a concurrency control; you still need optimistic locking across requests. Long sessions make the map grow and serve stale data. Code without an ORM, working with immutable values passed explicitly, usually has no need for it.

## Quality axes

- **reliability** ⊕ (primary): Loading the same record twice in one operation returns one object, so two copies can't be changed separately with the last write silently winning.
- **runtime** +: A record already loaded in the operation isn't fetched again.

**Flips:** Made long-lived or global it grows and serves stale data across requests, turning reliability and runtime "-"; it is not a cache or a substitute for optimistic locking.

## Warranted when

- Two parts of one operation load the same record, change their copies, and the last write silently wins.
- The same row is fetched repeatedly within one request.
- Object graphs with cycles need one instance per row to link correctly.

## How it shows

- A per-session or per-request cache of loaded entities keyed by type and id.
- Repository get methods that check the map before querying.
- Hand-written loaders with a request-scoped dictionary (DataLoader in GraphQL servers has a similar per-request cache).

## Overdone when

- A long-lived or global map that becomes a stale cache shared across requests.
- Hand-rolling one where the ORM already provides it.

## Example

Before:

```
fn book_seats(event_id, seat_a, seat_b):
    ev1 = events.load(event_id)
    ev1.reserve(seat_a)
    ev2 = events.load(event_id)       # a second, separate copy of the same event
    ev2.reserve(seat_b)
    events.save(ev1)
    events.save(ev2)                  # overwrites seat_a's reservation
```

After:

```
class EventLoader:
    loaded: map[EventId, Event]
    fn load(id) -> Event:
        if id not in self.loaded: self.loaded[id] = self.db.fetch_event(id)
        return self.loaded[id]

fn book_seats(events: EventLoader, event_id, seat_a, seat_b):
    events.load(event_id).reserve(seat_a)
    events.load(event_id).reserve(seat_b)   # same object, both seats kept
```

Within one operation each record has a single in-memory object, so changes can't overwrite each other.

## By language

**python:** SQLAlchemy's Session keeps an identity map (session.get checks it first). Django has none, so two queries return two separate model instances.

**csharp:** EF Core's change tracker is one; AsNoTracking turns it off for read-only queries, which is faster.

**java:** The JPA persistence context guarantees one entity instance per id within a transaction.

**typescript:** MikroORM has one per request context; TypeORM and Prisma do not, so separate loads give separate objects.

## Related

[Unit of Work](unit-of-work.md) · [Data Mapper](data-mapper.md) · [Repository](repository.md) · [Global state](global-state.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Identity Map (catalog summary)](https://martinfowler.com/eaaCatalog/identityMap.html) (read)
