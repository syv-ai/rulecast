<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Little's Law

`littles-law` · laws, scale

In a stable system, the average number of items in it equals the average arrival rate times the average time each item spends inside (L = λW). Fix any two and the third follows.

*Names:* Proved by John D. C. Little, "A Proof for the Queuing Formula L = λW" (Operations Research, 1961); the relation was used informally before. In software it sizes thread pools, connection pools, queues and concurrency limits (in-flight requests = throughput x latency).

*Matters most for:* web-api, distributed, databases-storage, data-pipeline, serverless

## But

It holds only for long-run averages in a stable system, where arrivals and departures balance; it says nothing about variance, tail latency or what happens during a spike. It tells you the relation, not the service time itself, so you still need measurements. Near full utilisation queueing delay grows sharply (Kingman's formula, queueing theory generally), so a pool sized exactly to λW has no headroom; leave margin. The bottleneck can also be downstream, where more concurrency just moves the queue.

## Quality axes

*Bears on:* runtime, reliability. In-flight work equals throughput times latency, so mis-sized pools and queues either cap throughput or grow without bound and time out under load.

## Warranted when

- Sizing a thread, connection or worker pool.
- Explaining why latency grows when a queue fills up, or why adding workers didn't raise throughput.
- Setting rate limits and concurrency limits for a dependency.

## How it shows

- Pool sizes, worker counts and concurrency limits set as round numbers with no rationale.
- Queues that grow without bound under load, or workers sitting idle while latency is high.
- Capacity plans and load tests that relate throughput, latency and concurrency.

## Overdone when

- Applying it to a system that is not in steady state (a burst, a startup ramp) and trusting the result.
- Treating averages as the whole story, when tail latency is what users feel.

## Example

Before:

```
# the export API sees about 200 requests/s, each holding a DB connection ~50 ms
db_pool = ConnectionPool(size=8)       # picked once, never revisited
fn export(request): conn = db_pool.acquire(); ...
# under load, requests queue for connections and p99 latency climbs
```

After:

```
ARRIVALS_PER_SEC = 200                 # measured peak
HOLD_TIME_SEC = 0.050                  # measured mean connection hold time
HEADROOM = 1.5

in_flight = ARRIVALS_PER_SEC * HOLD_TIME_SEC     # L = λW = 10 connections busy on average
db_pool = ConnectionPool(size=ceil(in_flight * HEADROOM))   # 15
```

The pool is sized from measured rate times time-in-system, with headroom because the law gives only the average.

## Related

[Amdahl's Law](amdahls-law.md) · [Gustafson's Law](gustafsons-law.md) · [Premature Optimization](premature-optimization.md) · [Circuit Breaker](circuit-breaker.md)

## Sources

- [John D. C. Little, A Proof for the Queuing Formula L = λW, Operations Research 9(3), 1961](https://doi.org/10.1287/opre.9.3.383) (recalled)
