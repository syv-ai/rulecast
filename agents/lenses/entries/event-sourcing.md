<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Event Sourcing

`event-sourcing` · design patterns, architecture · **contested**

Store every change as an immutable event in an append-only log and derive current state by replaying the events, instead of overwriting the current state in place.

*Names:* Described by Martin Fowler (eaaDev, 2005) and championed by Greg Young from around 2007 alongside CQRS. The idea is much older: accounting ledgers and database write-ahead logs work this way. Rebuilding state from events is called rehydration; read models derived from events are projections.

*Matters most for:* event-driven, distributed, databases-storage

## But

Both Fowler and Microsoft's guidance stress that it is costly to adopt and costly to leave, and that most systems, and most parts of any system, are better served by storing current state. Schema evolution of events is permanent work, projections are eventually consistent, replays must not resend side effects to external systems, and an immutable log fights with deletion rights such as GDPR's right to be forgotten (handled by keeping personal data outside events or by crypto-shredding). Teams new to event-driven systems often struggle with it. An audit table next to normal state often meets the real need.

## Quality axes

- **operability** ⊕ (primary): The full history is kept, so you can see what the state was at any time and why it changed.
- **change_cost** −: Event schemas can never be dropped, so evolving them with upcasters is permanent work, and the approach is costly to leave.
- **delivery** −: An event store, projections, snapshots and replay rules to build before the first feature.

**Flips:** Across a whole system, for reference data nobody replays, or with events that record state rather than intent, it is all cost and an audit table next to normal state often meets the need; where audit and history are core requirements and new read models must be built from history, the costs pay back.

## Warranted when

- Audit and history are core requirements (ledgers, payments, compliance), not afterthoughts.
- The business needs to ask what the state was at a past time, or why it changed.
- New read models must be built later from history that would otherwise be lost.
- Many concurrent writers on the same entity, where appends with optimistic concurrency beat row locks.

## How it shows

- Event classes named in the past tense (SeatsReserved, OrderCancelled) and an event store or events table keyed by stream id and version.
- An aggregate with an apply or when method per event type, rebuilt by folding over its stream.
- Projections that subscribe to events to build read tables, plus snapshot tables.
- Upcasters or versioned event types for old event shapes.

## Overdone when

- Event sourcing a whole system, including reference data, settings and user profiles that nobody will ever replay.
- Events that record state ("quantity set to 42") rather than intent, which gives a change log with the costs of event sourcing and none of the meaning.
- Using a message broker such as Kafka as the event store without per-stream reads or concurrency control.
- Choosing it for a prototype or MVP with a short expected life.

## Example

Before:

```
class BinStock:
    fn receive(qty):
        self.quantity = self.quantity + qty
        db.update("bins", self.id, quantity=self.quantity)
    fn pick(qty):
        self.quantity = self.quantity - qty
        db.update("bins", self.id, quantity=self.quantity)
# "why is bin 7 short by 3 since Tuesday?" has no answer
```

After:

```
class BinStock:
    fn receive(qty): self.record(StockReceived(self.id, qty))
    fn pick(qty):
        if qty > self.quantity: raise NotEnoughStock()
        self.record(StockPicked(self.id, qty))

    fn apply(event):
        if event is StockReceived: self.quantity = self.quantity + event.qty
        if event is StockPicked: self.quantity = self.quantity - event.qty

fn load(bin_id) -> BinStock:
    bin = BinStock(bin_id)
    for event in store.read_stream(bin_id): bin.apply(event)
    return bin
```

The events are the record; current quantity is derived from them, so history and past states come for free.

## By language

**csharp:** Mature libraries exist (Marten on PostgreSQL, EventStoreDB's client, Eventuous). Records make immutable event types cheap to declare.

**java:** Axon Framework is the common full stack; sealed interfaces and records (Java 17+) suit event hierarchies and exhaustive handling.

**typescript:** Discriminated unions model the event set well, and a reducer over the stream is the natural shape of rehydration.

**rust:** Enums model the event set and match makes apply exhaustive; serde with tagged enums handles storage, with versioning done by explicit variants or upcasting.

**python:** Fewer mature frameworks (eventsourcing is the main one); hand-rolled stores over PostgreSQL are common. Dataclasses with frozen=True suit event types.

## Related

[CQRS (Command Query Responsibility Segregation)](cqrs.md) · [Transactional Outbox](outbox.md) · [Saga](saga.md) · [Memento](memento.md)

## Sources

- [Martin Fowler, Event Sourcing (2005)](https://martinfowler.com/eaaDev/EventSourcing.html) (read)
- [Azure Architecture Center, Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) (read)
- Greg Young, talks and CQRS Documents (2010) (recalled)
