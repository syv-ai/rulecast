<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Idempotency

`idempotency` · principles, architecture

Design operations so that doing one twice has the same effect as doing it once, because networks, clients, queues and schedulers will repeat it: idempotent HTTP methods, idempotency keys for POST, and consumers that recognise a message they have already handled.

*Names:* From mathematics. For HTTP, RFC 9110 section 9.2.2 (Fielding, Nottingham and Reschke, 2022) defines PUT, DELETE and the safe methods as idempotent and says clients shouldn't retry other methods automatically. The IETF httpapi draft "The Idempotency-Key HTTP Header Field" (Jayadeba Jena and Sanjay Dalal, last revision -07, 2025, expired without becoming an RFC) standardises the key header that payment APIs popularised. In messaging, Gregor Hohpe and Bobby Woolf's Enterprise Integration Patterns (2003) name the Idempotent Receiver; microservices.io calls it the Idempotent Consumer.

*Matters most for:* web-api, distributed, event-driven, serverless, data-pipeline

## But

Idempotency is not free: it needs a store, a retention window, handling of in-flight duplicates and a fingerprint check so a reused key with a different body is refused. Where a duplicate is harmless (a view counter, a cache warm-up) or the system is exactly-once end to end inside one transactional store, the machinery isn't worth it. RFC 9110 notes the property is about the intended effect only, so logs and audit rows may still differ per request. The idempotency-key draft expired in 2026 without becoming an RFC, so its status codes (400 for a missing key, 409 for a request still in flight, 422 for a key reused with another body) are a widely copied convention, not a standard.

## Quality axes

- **reliability** ⊕ (primary): Retries after timeouts, at-least-once delivery and platform reruns don't double a charge, an order or a message.
- **operability** +: Operators can safely rerun a failed job or replay messages, because a rerun replaces the output instead of doubling it.
- **runtime** −: Each guarded request does an extra key lookup and write in the dedupe store.
- **delivery** −: Needs a key store, a retention window, handling of in-flight duplicates and a check that a reused key has the same body.

**Flips:** On operations that are already naturally idempotent, or where duplicates are harmless, the machinery is cost only. Keeping keys forever makes the store grow without bound.

## Warranted when

- Clients or proxies retry on timeout, and the original request may have succeeded.
- The broker delivers at least once (most do), or the Outbox pattern can publish a message twice.
- Jobs, serverless functions and pipeline runs are retried by the platform after partial failure.
- The operation moves money, sends something to a person or creates a record a duplicate of which is costly.

## How it shows

- POST endpoints that create money movements, orders or messages accept an Idempotency-Key header and store the key with the result.
- A processed-messages table or a unique constraint on a message or event id, checked in the same transaction as the consumer's write.
- Writes expressed as upserts or set-to-value ("status = shipped") rather than increments or appends.
- Pipeline steps that overwrite a partition or use merge, so a rerun replaces output instead of doubling it.
- Outbound calls to payment or messaging providers passing an idempotency key of their own.

## Overdone when

- Idempotency keys and a dedupe store on endpoints that are already naturally idempotent (PUT of a full value, DELETE) or whose duplicates are harmless.
- Keeping every key forever instead of for a published window, so the store grows without bound.
- Adding a dedupe table where a unique constraint on a natural key would do the same job.

## Example

Before:

```
route POST "/refunds"
fn create_refund(body: RefundRequest, user: User) -> Refund:
    refund = refunds.insert(order_id=body.order_id, amount=body.amount)
    payments.send_refund(body.order_id, body.amount)
    return refund
# a client that times out and retries refunds the customer twice
```

After:

```
route POST "/refunds"
fn create_refund(body: RefundRequest, key: str, user: User) -> Response:
    prior = idempotency.find(user.id, key)
    if prior and prior.fingerprint != fingerprint(body):
        return error(422, "key reused with a different request")
    if prior and prior.in_progress:
        return error(409, "original request still running")
    if prior:
        return prior.response
    idempotency.start(user.id, key, fingerprint(body))    # unique on (user, key)
    refund = refunds.insert(order_id=body.order_id, amount=body.amount)
    payments.send_refund(body.order_id, body.amount, idempotency_key=key)
    return idempotency.finish(user.id, key, created(refund))
```

A retried request with the same key gets the first response back instead of a second refund, and the key is passed on so the payment provider dedupes too.

## By language

**python:** Celery with acks_late and retries can run a task more than once, so tasks should be written to be repeatable. requests and httpx don't retry POST by default; urllib3's Retry skips non-idempotent methods unless allowed_methods says otherwise.

**typescript:** BullMQ ignores a job added with a jobId that already exists, but only while that job is still stored; once removeOnComplete or removeOnFail has removed it, the same id is accepted again, so the dedupe window is the retention window (BullMQ's deduplication option gives an explicit one). Retry wrappers around fetch apply to POST too unless you restrict them.

**java:** Kafka's enable.idempotence stops producer retries from writing duplicates to the log, but it doesn't make consumers idempotent; a consumer that crashes before committing offsets reprocesses records.

**csharp:** MassTransit's transactional outbox includes an inbox that records received message ids, which gives an idempotent consumer when the handler's writes share its transaction.

## Related

[Transactional Outbox](outbox.md) · [Saga](saga.md) · [Fallacies of Distributed Computing](fallacies-of-distributed-computing.md) · [Pipes and Filters](pipes-and-filters.md) · [Circuit Breaker](circuit-breaker.md) · [Command-Query Separation (CQS)](command-query-separation.md)

## Sources

- [RFC 9110, HTTP Semantics, section 9.2.2 Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) (read)
- [IETF httpapi, The Idempotency-Key HTTP Header Field, draft-ietf-httpapi-idempotency-key-header-07](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) (read)
- [Gregor Hohpe and Bobby Woolf, Enterprise Integration Patterns (2003), Idempotent Receiver](https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html) (recalled)
- [Chris Richardson, microservices.io, Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html) (recalled)
