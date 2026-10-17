<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# CQRS (Command Query Responsibility Segregation)

`cqrs` · design patterns, architecture · **contested**

Use one model to change data (commands) and a separate model to read it (queries), so each can be shaped, stored and scaled for its own job.

*Names:* Named by Greg Young around 2010, building on Bertrand Meyer's Command-Query Separation (Object-Oriented Software Construction, 1988), which applies the same split to single methods. Udi Dahan wrote widely on it at the same time. Fowler's bliki entry (2011) is the usual short reference.

*Matters most for:* event-driven, distributed, web-api

## But

Fowler warns that most systems fit CRUD and that CQRS is a significant mental leap which, in most cases he saw, made the project harder. Separate stores bring eventual consistency, so users can act on stale data, and messaging brings duplicates and retries. If the only need is heavy reporting, a reporting database or read replica may be enough. The light form, separate query objects that select straight into DTOs over the same database, gets much of the benefit at little cost and is often what people actually need.

## Quality axes

- **change_cost** ⊕ (primary): The write model enforces rules without display getters and joins, and read models are shaped for screens independently.
- **runtime** +: Read models are stored and indexed for the queries they serve and can scale apart from writes.
- **reliability** −: Separate stores are eventually consistent, so users can act on stale data and projections must cope with duplicates and retries.
- **delivery** −: Two models, projections and usually a bus are a large step up from CRUD.

**Flips:** Labelled for separate read and write stores, which is what the entry's "stored and scaled" describes. For most CRUD systems it makes the project harder; the light form, query objects selecting into DTOs over the same database, keeps most of the change_cost benefit without the reliability and delivery cost.

## Warranted when

- The shapes needed for screens and reports differ sharply from the shape needed to enforce rules on writes.
- Reads vastly outnumber writes, or need a different store (search index, document cache).
- The domain model is bloated with getters, lazy loads and joins that exist only for display.
- Collaborative domains where many users act on the same data and intent-level commands reduce conflicts.

## How it shows

- Command and query classes or handlers in separate folders (Commands/, Queries/), often dispatched through a mediator.
- Read models or projections (denormalised tables, documents, materialised views) updated from events written by the command side.
- Query handlers that bypass the domain model and select straight into view DTOs.

## Overdone when

- Separate read and write databases, a bus and eventual consistency for a CRUD app.
- Applying it across the whole system instead of the one bounded context that needs it.
- A mediator library and a command/handler pair for every trivial operation, adding ceremony with one store underneath.
- Assuming CQRS requires event sourcing; it doesn't.

## Example

Before:

```
class Shipment:
    fn mark_delivered(at): ...                 # rule-heavy writes
    fn dashboard_row() -> dict:                # display concerns on the same model
        return {"carrier": self.carrier.name,
                "region": self.route.region.name,
                "late_days": self.lateness(),
                "customer": self.order.customer.name}

rows = [s.dashboard_row() for s in repo.all_open()]   # loads every graph to build a table
```

After:

```
# command side: the model enforces rules
fn handle(cmd: MarkDelivered):
    shipment = repo.get(cmd.shipment_id)
    shipment.mark_delivered(cmd.at)
    repo.save(shipment)

# query side: a flat read model shaped for the screen
fn open_shipments_dashboard() -> list[ShipmentRow]:
    return db.query("select carrier, region, late_days, customer from shipment_dashboard
                     where status = 'open'")
```

Writes go through the rich model; the dashboard reads a table built for it, kept up to date by a projection or a view.

## By language

**csharp:** Very common in .NET via MediatR with IRequest handlers. From 13.0, MediatR is dual-licensed (RPL-1.5 or a paid commercial licence, with a free tier for small companies); 12.x stays Apache 2.0. The mediator is optional, and it is criticised as needless indirection when handlers have only one caller.

**java:** Axon Framework provides CQRS with event sourcing; in plain Spring the light form is separate query repositories or projections returning DTOs.

**python:** Usually the light form: separate query functions returning plain dicts or Pydantic models, with SQL written for the screen, next to a richer write model.

**typescript:** NestJS ships a @nestjs/cqrs module with command, query and event buses; outside Nest, separate query functions are the norm.

## Related

[Event Sourcing](event-sourcing.md) · [Transactional Outbox](outbox.md) · [Saga](saga.md) · [YAGNI](yagni.md)

## Sources

- [Martin Fowler, CQRS (bliki, 2011)](https://martinfowler.com/bliki/CQRS.html) (read)
- [Azure Architecture Center, CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) (read)
- Greg Young, CQRS Documents (2010) (recalled)
