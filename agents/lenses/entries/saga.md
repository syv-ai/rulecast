<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Saga

`saga` · design patterns, architecture

Run a business transaction that spans several services as a sequence of local transactions, each triggering the next, and undo the completed steps with compensating actions if a later step fails.

*Names:* Named by Hector Garcia-Molina and Kenneth Salem, "Sagas" (SIGMOD 1987), for long-lived transactions in a single database. Applied to microservices by Chris Richardson (microservices.io, Microservices Patterns, 2018) and others. Comes in two styles: choreography (services react to each other's events) and orchestration (a coordinator tells each service what to do). Also related to process managers (Hohpe and Woolf) and durable workflow engines (Temporal, AWS Step Functions).

*Matters most for:* distributed, event-driven, serverless

## But

Sagas give up isolation: other transactions see intermediate states, so lost updates and dirty reads are possible unless you add countermeasures (semantic locks, commutative updates, rereading values, putting risky steps after the pivot). Compensations must be designed, tested and can themselves fail, and every step must be idempotent because messages get redelivered. Debugging is hard as the number of services grows. Often the better fix is to redraw service boundaries so the transaction is local, or to keep the operation in a modular monolith. Choose orchestration once the flow has more than a few steps; choreography hides the process.

## Quality axes

- **reliability** ⊕ (primary): A failure partway undoes the completed steps with compensations instead of leaving services inconsistent.
- **delivery** −: Every step needs a designed, tested compensation, idempotent handling and saga state.
- **operability** −: Following one business transaction across many services is hard to debug, especially with choreography.

**Flips:** Sagas give up isolation, so without countermeasures other transactions see intermediate states, and compensations that can't really undo turn reliability "-"; a saga stitching back what could be one local transaction signals a wrong service boundary.

## Warranted when

- One business operation must change data owned by several services, each with its own database.
- A distributed transaction (two-phase commit) is unavailable, too slow or too coupling.
- Steps can take long (human approval, external providers), so locks can't be held.

## How it shows

- An orchestrator or process manager class with an explicit state per step and a compensation for each.
- Pairs of actions such as reserve/release, charge/refund, book/cancel across services.
- Saga state tables, or workflow definitions in Temporal, Step Functions or Camunda.
- Events chaining services (OrderCreated, CreditReserved, CreditLimitExceeded) with no central coordinator.

## Overdone when

- Splitting a single operation across services that could share one database transaction, then needing a saga to stitch it back together (a sign the service boundary is wrong).
- Choreographed sagas across many services, where nobody can see the whole flow.
- Compensations that can't really undo (sent emails, shipped goods) treated as if they could.

## Example

Before:

```
fn rent_equipment(request):
    inventory_service.reserve(request.item_id, request.dates)
    payments_service.charge_deposit(request.customer_id, request.deposit)
    delivery_service.schedule(request.address, request.dates)
    # if scheduling fails, the item stays reserved and the deposit stays charged
```

After:

```
class RentalSaga:                                    # orchestrator
    fn run(request):
        done = []
        try:
            inventory_service.reserve(request.item_id, request.dates)
            done.append(fn: inventory_service.release(request.item_id, request.dates))
            payments_service.charge_deposit(request.customer_id, request.deposit)
            done.append(fn: payments_service.refund_deposit(request.customer_id))
            delivery_service.schedule(request.address, request.dates)
        except StepFailed:
            for undo in reversed(done): undo()       # compensate in reverse order
            raise RentalFailed()
# each call is a local transaction in its own service; state is persisted between steps
```

Each step is paired with a compensation, and a failure undoes the steps already done in reverse order instead of leaving partial changes.

## By language

**java:** Axon, Eventuate Tram Sagas and Camunda are common; Temporal's Java SDK runs sagas as durable workflow code.

**csharp:** MassTransit state machines and NServiceBus sagas persist saga state; Durable Functions and Temporal's .NET SDK do workflow-style orchestration.

**go:** Temporal (written in Go) is the usual choice for orchestration; otherwise hand-rolled state machines over the outbox.

**typescript:** Temporal's TypeScript SDK or AWS Step Functions for orchestration; NestJS CQRS has a saga concept that is an event-stream reactor, not a compensating transaction, which confuses the name.

**python:** Temporal's Python SDK or Celery chains with explicit compensation; Celery alone gives no saga state or compensation.

## Related

[Transactional Outbox](outbox.md) · [Event Sourcing](event-sourcing.md) · [Shared Database](shared-database.md) · [Distributed Monolith](distributed-monolith.md) · [Command](command.md)

## Sources

- [Hector Garcia-Molina and Kenneth Salem, Sagas, SIGMOD 1987](https://dl.acm.org/doi/10.1145/38713.38742) (recalled)
- [Chris Richardson, microservices.io, Pattern - Saga](https://microservices.io/patterns/data/saga.html) (read)
- [Azure Architecture Center, Saga design pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga) (read)
