<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# N+1 Queries

`n-plus-one-queries` · smells, code · **agents do this**

Code fetches a list with one query and then runs one more query per item to load something related, so a page of 100 rows costs 101 round trips; usually hidden by an ORM's lazy loading.

*Names:* Also called the N+1 selects problem. The name grew up around Hibernate and Rails in the mid-2000s and has no single coiner; Fowler's Lazy Load pattern (PoEAA, 2002) describes the mechanism that causes it and warns about this ripple of loads.

*Matters most for:* web-api, fullstack-web, databases-storage

## But

With a handful of items, a fast local database or a cached lookup, the extra queries cost nothing worth the complexity, so measure before rewriting. Sometimes N small indexed queries beat one large join that multiplies rows. Batch jobs that stream records one at a time may do per-item queries on purpose to bound memory.

## Quality axes

- **delivery** +: Lazy loading makes the per-item query the obvious code, and it is fast against tiny dev datasets.
- **runtime** −: One round trip per row makes latency and database load grow with page size.

**Flips:** With a few items, a fast local database or a cache, it costs nothing worth fixing; batch jobs may query per item on purpose to bound memory, and N indexed queries can beat a join that multiplies rows.

## Why people fall into it

- ORM lazy loading makes a related object look like a plain field access.
- Code is written and tested against tiny datasets where the cost doesn't show.
- Gateway or repository methods are per-record, so composing them in a loop is the obvious move.
- Serialisers or templates touch relations nobody loaded on purpose.

## How it shows

- A loop over query results that touches a relation (order.customer.name) or calls a repository per item.
- Query logs or traces showing the same SELECT repeated with different ids in one request.
- Endpoints whose latency grows with the page size.
- GraphQL resolvers that load a field per parent object without a batching loader.

## Overcorrecting looks like

- Eager-loading every relation everywhere, which produces huge joins, cartesian blow-ups and loads data that is never used.
- Hand-writing one giant query per screen, losing the reuse and readability of simpler queries.

## What to do

Load the relation with the list: eager loading or a join (select_related or prefetch_related, selectinload or joinedload, JOIN FETCH or entity graphs, Include, Prisma include), or batch the second query with WHERE id IN (...) and stitch in memory (a DataLoader in GraphQL). Add a test or a query-count assertion for hot endpoints.

## Example

Before:

```
fn playlist_page(playlist_id):
    tracks = db.query("SELECT * FROM playlist_tracks WHERE playlist_id = ?", playlist_id)
    rows = []
    for t in tracks:
        artist = db.query_one("SELECT name FROM artists WHERE id = ?", t.artist_id)
        rows.append((t.title, artist.name))
    return rows
    # 1 query for the tracks, then 1 per track
```

After:

```
fn playlist_page(playlist_id):
    tracks = db.query("SELECT * FROM playlist_tracks WHERE playlist_id = ?", playlist_id)
    ids = unique(map(tracks, fn(t): t.artist_id))
    artists = index_by_id(db.query("SELECT id, name FROM artists WHERE id IN (?)", ids))
    return map(tracks, fn(t): (t.title, artists[t.artist_id].name))
    # 2 queries, whatever the playlist length
```

The per-item lookups become one batched query, so the cost no longer grows with the number of rows.

## By language

**python:** Django: select_related for foreign keys, prefetch_related for many-to-many and reverse relations; django-debug-toolbar or nplusone show it. SQLAlchemy: selectinload or joinedload options, and lazy="raise" to make accidental lazy loads fail loudly.

**java:** JPA and Hibernate: JOIN FETCH, @EntityGraph or batch fetching (@BatchSize). JPA's default EAGER fetching on @ManyToOne and @OneToOne triggers a select per row for JPQL and Spring Data queries, so mark them LAZY and fetch explicitly; lazy collections touched in loops, and open-session-in-view (on by default in Spring Boot), then make it easy to hit in controllers and serializers.

**csharp:** EF Core: Include and ThenInclude, or projection with Select; lazy-loading proxies are off by default, which prevents most cases. AsSplitQuery avoids cartesian blow-ups.

**typescript:** TypeORM relations with leftJoinAndSelect, Prisma include or select (Prisma batches findUnique calls in a tick); DataLoader is standard for GraphQL resolvers.

**go:** No lazy loading, so it shows as an explicit query call inside a for loop over rows; fix with a join or WHERE id = ANY($1) and a map.

**rust:** Same as Go with sqlx or Diesel: a query inside a loop over rows; Diesel's belonging_to with grouped_by loads children for many parents in one query.

## Related

[Premature Optimization](premature-optimization.md) · [The Law of Leaky Abstractions](law-of-leaky-abstractions.md) · [Table Data Gateway](table-data-gateway.md) · [Repository](repository.md) · [Data Mapper](data-mapper.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Lazy Load (catalog summary)](https://martinfowler.com/eaaCatalog/lazyLoad.html) (read)
- [Django documentation, QuerySet select_related and prefetch_related](https://docs.djangoproject.com/en/stable/ref/models/querysets/) (recalled)
- [Hibernate ORM documentation, Fetching](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#fetching) (recalled)
