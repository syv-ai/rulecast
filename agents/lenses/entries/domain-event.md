<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Domain Event

`domain-event` · design patterns, design

An immutable record, named in the past tense, of something that happened in the domain that experts care about (ClaimApproved, PaymentFailed), raised by the model so other parts can react without the source knowing them.

*Names:* Not in Evans's 2003 book; Evans added it to his DDD Reference (2015) as a new pattern, after the CQRS and event sourcing work of Greg Young and Udi Dahan. Fowler described it on his site around 2005.

*Matters most for:* event-driven, distributed, web-api

## But

Events trade a visible call for an invisible one. Fowler's write-up on event-driven styles warns that event notification makes the overall flow hard to see and debug, and that is the main cost. A single side effect is clearer as a direct call. Dispatching before the commit risks reacting to something that then rolls back; dispatching after needs an outbox or similar to avoid losing events. Keep domain events inside a context, and translate them into separate integration events, a published language, for other contexts, so internal refactoring doesn't break consumers. Domain events are not event sourcing; you can use one without the other.

## Quality axes

- **change_cost** ⊕ (primary): Side effects and other contexts react to an event, so the changing method doesn't grow a call for each new reaction.
- **operability** −: The overall flow is spread across handlers, which makes it hard to see and debug.
- **delivery** −: Event types, handlers, dispatch after commit and usually an outbox are more to build than a direct call.

**Flips:** Dispatched before commit, or after commit without an outbox, events react to rollbacks or get lost (reliability "-"); for a single side effect a direct call is clearer, and publishing internal events to other services makes their shape a public contract that raises change_cost.

## Warranted when

- One state change triggers several side effects, and the method doing the change keeps growing calls to email, billing and analytics.
- Another bounded context or service must react, and calling it directly couples the two.
- The business wants to know why state changed, not just what it is now.
- Updates across aggregates must happen after the first one commits (eventual consistency).

## How it shows

- Small immutable classes named in the past tense, carrying the ids involved and the time it happened.
- Aggregates that record events during a command, which are dispatched after the transaction commits.
- Handlers subscribed to an event type, each doing one side effect (notify, update a read model, start a process).
- An outbox table or similar so events published to other services aren't lost if the process dies.

## Overdone when

- An event for every setter, so the flow of a simple feature is scattered across handlers nobody can follow.
- Events used as disguised commands ("SendEmailRequested") where a direct call would be clearer.
- Publishing internal domain events straight to other services, so their shape becomes a public contract.

## Example

Before:

```
class WarrantyClaim:
    fn approve(adjuster):
        self.status = APPROVED
        mailer.send(self.customer_email, "Your claim was approved")
        ledger.reserve(self.payout)
        analytics.track("claim_approved", self.id)
        # every new reaction edits this method
```

After:

```
class ClaimApproved:                  # immutable, past tense
    claim_id: ClaimId
    payout: Money
    approved_by: AdjusterId
    occurred_at: Timestamp

class WarrantyClaim:
    fn approve(adjuster):
        self.status = APPROVED
        self.record(ClaimApproved(self.id, self.payout, adjuster.id, now()))

# after commit, the unit of work dispatches recorded events
on ClaimApproved: notify_customer, reserve_payout, track_approval
```

The claim states what happened and stops; each reaction subscribes on its own, and a new one is added without touching the claim.

## By language

**python:** No standard mechanism; a list of pending events on the aggregate, drained by the unit of work after commit, is the common shape (as in Percival and Gregory's Architecture Patterns with Python). Frozen dataclasses suit the events.

**typescript:** A discriminated union of event types gives exhaustive handling. Node's EventEmitter is synchronous and in-process; it's not a reliable bus for events other services depend on.

**java:** Spring Data's AbstractAggregateRoot (or @DomainEvents) publishes registered events when the repository saves, and @TransactionalEventListener can run handlers after commit. Records suit the events.

**csharp:** A common shape is a DomainEvents list on a base entity, dispatched from an overridden SaveChanges or an EF Core SaveChanges interceptor, through MediatR notifications (dual-licensed since 13.0) or a small hand-written dispatcher. Decide whether handlers run inside or after the transaction; both are seen.

**go:** Commands often return the events they produced as a slice, and the caller publishes them; channels are a poor fit for events that must survive a crash.

**rust:** An enum of events returned from command methods (Result<Vec<Event>, Error>) is idiomatic and keeps the model free of a bus.

## Related

[Observer](observer.md) · [Aggregate](aggregate.md) · [Bounded Context](bounded-context.md) · [Anti-Corruption Layer](anti-corruption-layer.md) · [Mediator](mediator.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Domain Events](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Martin Fowler, What do you mean by "Event-Driven"? (2017)](https://martinfowler.com/articles/201701-event-driven.html) (recalled)
- [Martin Fowler, Domain Event (2005)](https://martinfowler.com/eaaDev/DomainEvent.html) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 8 (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 6 and 15](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
