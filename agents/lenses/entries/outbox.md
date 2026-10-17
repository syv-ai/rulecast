<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Transactional Outbox

`outbox` · design patterns, architecture

To change your database and publish a message reliably, write the message to an outbox table in the same local transaction as the change, and let a separate relay read the outbox and publish it to the broker.

*Names:* Catalogued by Chris Richardson on microservices.io and in Microservices Patterns (2018), with transaction log tailing (change data capture) and polling publisher as its two relay styles. Also called the outbox pattern. Its mirror on the receiving side is the idempotent consumer, sometimes with an inbox table.

*Matters most for:* distributed, event-driven, web-api

## But

The outbox gives at-least-once delivery, not exactly-once: a relay that crashes after publishing but before marking the row will publish again, so consumers must be idempotent, which brokers usually require anyway. The relay is another moving part to run, monitor and scale, and polling adds latency. Ordering is only preserved per outbox and per partition key. If the event store is the source of truth (event sourcing), it already plays this role. Its value is that each service keeps its own database instead of sharing one, so it is part of the cost of avoiding a shared database.

## Quality axes

- **reliability** ⊕ (primary): The message is stored in the same transaction as the change, so a crash can neither lose the event nor announce a rolled-back change.
- **operability** −: A relay worker or CDC connector to run, monitor and scale.
- **runtime** −: Polling the outbox adds latency between the change and its message.

**Flips:** For fire-and-forget notifications or a single process with no broker it is a moving part for nothing; with non-idempotent consumers its at-least-once duplicates cause harm.

## Warranted when

- Code commits to the database and then publishes to a broker, so a crash between the two loses the event, or publishes first and announces a change that was rolled back.
- Two-phase commit across the database and broker isn't available or isn't wanted.
- Downstream services, read models or sagas depend on every state change being announced, in order.

## How it shows

- An outbox or outgoing_messages table written inside the same transaction as the business change.
- A relay worker or CDC connector (Debezium) that reads the outbox and publishes to Kafka, RabbitMQ or a cloud queue, then marks rows sent.
- Consumers that record processed message ids to discard duplicates.

## Overdone when

- An outbox for a fire-and-forget notification where losing an occasional message is fine.
- An outbox in a single-process app with no broker, where an in-process event after commit, or a database job table, would do.
- Using it but leaving consumers non-idempotent, so the duplicates it can produce cause harm.

## Example

Before:

```
fn register_member(form):
    tx = db.begin()
    member = members.insert(tx, form)
    tx.commit()
    broker.publish("member.registered", {"id": member.id})
    # crash here or broker down: the member exists but nobody hears about it
```

After:

```
fn register_member(form):
    tx = db.begin()
    member = members.insert(tx, form)
    outbox.insert(tx, topic="member.registered", payload={"id": member.id})
    tx.commit()                      # both rows or neither

fn relay_loop():                     # separate worker
    for msg in outbox.unsent(limit=100):
        broker.publish(msg.topic, msg.payload)
        outbox.mark_sent(msg.id)     # a crash before this republishes; consumers dedupe
```

The event is saved atomically with the change, and publishing becomes a retryable background job.

## One-file tell

Python, TypeScript, Java, C#, Go: inside one function, a database commit or save immediately followed (or preceded) by a publish or send to a message broker client (kafka, rabbitmq, sns, sqs, pubsub) with no outbox write. Only meaningful where the repo has adopted the outbox as its convention.

## By language

**java:** Debezium's outbox event router is the common CDC-based relay; Spring Modulith and Axon also ship outbox support.

**csharp:** MassTransit and NServiceBus provide transactional outboxes on top of EF Core or SQL Server; Wolverine does the same.

**python:** Usually hand-rolled: an SQLAlchemy model for the outbox written in the same session, plus a worker that polls with SELECT ... FOR UPDATE SKIP LOCKED.

**go:** Hand-rolled or via libraries such as Watermill's forwarder; pass the same *sql.Tx to the business write and the outbox insert.

## Related

[Shared Database](shared-database.md) · [Saga](saga.md) · [Event Sourcing](event-sourcing.md) · [CQRS (Command Query Responsibility Segregation)](cqrs.md) · [Fallacies of Distributed Computing](fallacies-of-distributed-computing.md)

## Sources

- [Chris Richardson, microservices.io, Pattern - Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) (read)
- Chris Richardson, Microservices Patterns (2018), ch. 3 (recalled)
