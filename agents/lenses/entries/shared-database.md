<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Shared Database

`shared-database` · anti-patterns, architecture · **contested**

Two or more services directly reading and mutating the same tables, so no service owns its data and a schema change or a long transaction in one breaks the others. Also called the integration database.

*Matters most for:* distributed, platforms, data-pipeline

## But

microservices.io presents Shared Database as a pattern with trade-offs, not an anti-pattern: it gives you local ACID transactions for invariants that span services and is simpler to operate, at the cost of development- and runtime coupling. The anti-pattern is services mutating each other's data with no clear ownership. One database instance with separate schemas per service, or a read-only reporting replica, is fine. A modular monolith sharing a database is not this problem. Database per service brings its own costs: eventual consistency, sagas and harder reporting.

## Quality axes

- **operability** +: One database is simpler to run, back up and pay for than one per service.
- **delivery** +: A cross-service query is one SQL statement away, with no waiting on another team's API.
- **reliability** −: One service's long transaction or lock blocks another, and rules about valid states duplicated across services let one write data another considers invalid.
- **change_cost** −: A schema change in one service breaks others, so migrations need coordinated releases.

**Flips:** As a deliberate choice (one instance with a private schema per service, a read-only reporting replica, or a modular monolith) it buys local ACID transactions and simpler operation and is fine.

## Why people fall into it

- ACID transactions across services' data are easy and familiar, while the alternatives (sagas, events) are not
- cross-service queries and joins are one SQL statement away
- one database is simpler to run, back up and pay for
- a monolith was split into services but the data was never split
- the deadline is near and calling another team's API means waiting for them

## How it shows

- SQL in one service's repo that writes tables named after another service's domain
- several services sharing one database connection string or schema
- migrations that need coordinated releases across services
- business rules about a table's valid states duplicated in more than one service
- incidents where one service's long-running transaction or lock blocks another

## Overcorrecting looks like

- a separate database server per service even where one shared instance with a schema per service would do
- replacing every cross-service read with events and eventual consistency where a strongly consistent API call was simpler

## What to do

Give each table a single owning service (Database per Service, or at least a private schema per service), and have other services go through that owner's API or consume its events; split the data step by step, writers first.

## Example

Before:

```
# booking-service
fn cancel(reservation_id: id):
    db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", reservation_id)

# billing-service, same database
fn refund(reservation_id: id):
    row = db.query("SELECT status, price FROM reservations WHERE id = ?", reservation_id)
    if row.status == "cancelled":
        payments.refund(row.price)
        db.execute("UPDATE reservations SET status = 'refunded' WHERE id = ?", reservation_id)
```

After:

```
# booking-service owns reservations
fn cancel(reservation_id: id):
    db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", reservation_id)
    events.publish("reservation.cancelled", {"id": reservation_id, "price": price_of(reservation_id)})

# billing-service owns refunds, in its own schema
on_event("reservation.cancelled", fn(evt):
    payments.refund(evt.price)
    billing_db.execute("INSERT INTO refunds (reservation_id, amount) VALUES (?, ?)", evt.id, evt.price)
)
```

Each table now has one writer, so booking can change its status values or schema without breaking billing. The price is that billing learns of cancellations asynchronously, and in real code the event should go out through a transactional outbox so a failed publish can't lose a refund.

## Related

[Distributed Monolith](distributed-monolith.md) · [Over-Modularization](over-modularization.md) · [Law of Demeter](law-of-demeter.md) · [Hyrum's Law](hyrums-law.md)

## Sources

- [Richardson, microservices.io, Pattern: Shared database](https://microservices.io/patterns/data/shared-database.html) (read)
- [Richardson, microservices.io, Pattern: Database per service](https://microservices.io/patterns/data/database-per-service.html) (recalled)
- [Fowler, IntegrationDatabase](https://martinfowler.com/bliki/IntegrationDatabase.html) (recalled)
