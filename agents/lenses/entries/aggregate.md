<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Aggregate

`aggregate` · design patterns, design

A cluster of entities and value objects treated as one unit for change, reached only through its root entity, which enforces the cluster's invariants; one transaction changes one aggregate, and other aggregates are updated afterwards.

*Names:* Also called Aggregate root (the entry entity), Consistency boundary. Eric Evans, Domain-Driven Design (2003), ch. 6. Vaughn Vernon's essay series Effective Aggregate Design (2011) gave the widely used rules of thumb.

*Matters most for:* web-api, fullstack-web, distributed, event-driven

## But

Evans and Vernon both frame this for domains with real invariants. For CRUD and for generic or supporting subdomains, the ceremony (roots, repositories per root, events between aggregates) costs more than it saves, and a transaction script or active record is the better fit. One transaction per aggregate is a guideline. Vernon lists four reasons to break it: user-interface convenience, missing technical mechanisms such as reliable messaging, global transactions imposed from outside, and query performance. He also advises asking whose job the consistency is: if the same user expects it at once, keep it transactional. Eventual consistency adds messaging, retries and states the business has to accept, so keep two things in one aggregate when the business truly needs them consistent at once. Aggregates also fight ORMs that encourage navigating the whole object graph.

## Quality axes

- **reliability** ⊕ (primary): Rules spanning several objects are enforced by the root after every change, and a version on the root stops two concurrent requests both taking the last seat.
- **runtime** +: A clear boundary limits how much of the graph is loaded, saved and locked per operation.
- **delivery** −: Roots, per-root repositories and messaging between aggregates are ceremony to build.

**Flips:** In CRUD screens with no invariants it costs more than it saves; one giant aggregate locks and loads everything (runtime "-"), and forcing eventual consistency where the business needs it immediate turns reliability "-".

## Warranted when

- A rule spans several objects (a total, a capacity, a "no overlapping bookings" rule) and must hold after every change.
- Code elsewhere reaches into child objects and changes them, bypassing the rule.
- Concurrent users corrupt data, or broad locking makes them block each other.
- Loading or saving a large object graph is slow because nothing marks where the graph ends.

## How it shows

- A root class whose methods are the only way to change its children (session.register(attendee), not session.registrations.append).
- One repository per aggregate root, none for the internal parts.
- Other aggregates referenced by id, not by object reference or ORM navigation.
- Each command handler or use case loads one aggregate, calls one method, and saves it in one transaction.
- A version column or ETag for optimistic concurrency on the root.

## Overdone when

- One giant aggregate holding everything related to a customer, so every change locks and loads it all.
- Aggregates drawn around "has-a" relationships rather than around rules that must hold together.
- Aggregates, roots and repositories in CRUD screens with no invariants beyond field validation.
- Forcing eventual consistency between two things the business needs consistent at once.

## Example

Before:

```
fn register(session_id, attendee_id):
    session = sessions.get(session_id)
    taken = registrations.count(session_id)       # a second request can pass here too
    if taken >= session.capacity: raise Full
    registrations.insert(Registration(session_id, attendee_id))

fn cancel(registration_id):
    registrations.delete(registration_id)         # waiting list never promoted
```

After:

```
class Session:                                    # aggregate root
    capacity: int
    registrations: list                           # changed only here
    waiting: list
    version: int

    fn register(attendee_id: AttendeeId):     # saved in one transaction, version-checked
        if len(self.registrations) >= self.capacity: self.waiting.append(attendee_id)
        else: self.registrations.append(Registration(attendee_id))

    fn cancel(attendee_id: AttendeeId):
        self.registrations.remove_for(attendee_id)
        if self.waiting: self.register(self.waiting.pop_first())
```

The capacity and waiting-list rules live on the root and are saved with its version check, so two concurrent requests can't both take the last seat; the attendee is held by id, not loaded.

## By language

**python:** Python can't enforce private children, so the root returns copies or tuples of its children and conventions plus tests keep outsiders out. SQLAlchemy relationships across aggregate roots invite the graph-walking the pattern forbids; hold the other root's id instead.

**typescript:** private and readonly are compile-time only; use #private fields if outside code must really be kept from the children. Return ReadonlyArray from getters. TypeORM and Prisma relations across roots work against the pattern; store the other root's id.

**java:** With JPA, map children with cascade and orphanRemoval from the root, and reference other roots by id rather than @ManyToOne. Spring Data repositories should exist only for roots. jMolecules offers @AggregateRoot annotations and ArchUnit rules to check this.

**csharp:** In EF Core, expose children as IReadOnlyCollection backed by a private field, map them as owned entities where they have no identity of their own, and leave out navigation properties to other roots. A concurrency token on the root gives optimistic locking.

**go:** The package is the encapsulation boundary: unexported child fields and exported methods on the root. Repositories load and save the root struct as a whole inside one transaction.

**rust:** Ownership fits the pattern: the root owns its children (a Vec of them), outsiders get only shared references through methods, and the borrow checker stops a reference to a child from outliving the operation. Mutation goes only through the root's &mut self methods.

## Related

[Entity](entity.md) · [Value Object](value-object.md) · [Domain Event](domain-event.md) · [Factory (DDD)](factory-ddd.md) · [Bounded Context](bounded-context.md) · [Law of Demeter](law-of-demeter.md) · [Over-Engineering](over-engineering.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Aggregates](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 6](https://www.domainlanguage.com/ddd/) (recalled)
- [Vaughn Vernon, Effective Aggregate Design, parts I to III (2011)](https://www.dddcommunity.org/library/vernon_2011/) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 10 (recalled)
- [Martin Fowler, bliki, DDD_Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html) (recalled)
