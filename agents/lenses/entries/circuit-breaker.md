<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Circuit Breaker

`circuit-breaker` · design patterns, architecture

Wrap calls to a remote dependency in an object that counts failures and, past a threshold, fails calls immediately for a while instead of waiting on a service that is down, then lets a trial call through to see whether it has recovered.

*Names:* Named and popularised by Michael Nygard in Release It! (2007), after electrical circuit breakers. Fowler's bliki entry (2014) is the common short reference. Netflix Hystrix (now in maintenance) made it mainstream; resilience4j, Polly and service meshes (Envoy, Istio) carry it now. States are closed, open and half-open.

*Matters most for:* distributed, web-api, serverless, platforms

## But

A breaker is only as good as its thresholds, timeouts and fallback. With long timeouts, threads still pile up before it trips; with tripping too eager, it flaps and causes outages of its own. Not every error should count (a 404 or a validation error isn't the dependency failing). In message-driven systems, retries with backoff and a dead-letter queue often do the job without a breaker, and Microsoft's guidance says to skip it where the platform already isolates failures. It complements retry rather than replacing it, and retry logic must stop when the breaker says the fault isn't transient.

## Quality axes

- **reliability** ⊕ (primary): A dead or slow dependency stops dragging its callers and unrelated requests down with it.
- **runtime** +: Calls fail immediately instead of tying up threads and connections waiting on timeouts.
- **operability** +: Breaker state shows which dependency is failing.
- **delivery** −: Thresholds, timeouts and fallbacks to design and tune.

**Flips:** Badly tuned it flaps and causes outages of its own, turning reliability "-"; around local calls, or where the mesh already isolates failures, it is overhead only.

## Warranted when

- A slow or failing dependency ties up threads, connections or memory and drags down unrelated requests (cascading failure).
- Retries are hammering a service that is already struggling to recover.
- A degraded answer (cached, default, queued for later) is better than waiting for a timeout.
- Many instances call the same dependency, so failures multiply.

## How it shows

- A wrapper around an HTTP or RPC client with failure thresholds, an open-state timeout and a fallback.
- Resilience library configuration (resilience4j, Polly, opossum, gobreaker) or a service-mesh outlier detection policy.
- Fallback paths that return cached or default data when the breaker is open.
- Metrics or alerts on breaker state changes.

## Overdone when

- Breakers around in-process or local calls, where they add overhead and nothing else.
- A breaker standing in for proper error handling in business logic.
- One breaker for a whole multi-tenant or sharded dependency, so one bad shard blocks all of them.
- Application-level breakers duplicating what the service mesh or load balancer already does.

## Example

Before:

```
fn address_for(order) -> Coordinates:
    for attempt in range(3):
        try: return geocoder.lookup(order.address, timeout=10s)
        except Timeout: continue
    raise GeocodingFailed()
# when the geocoder is down, every order waits 30s and holds a worker
```

After:

```
breaker = CircuitBreaker(failure_threshold=5, window=60s, open_for=30s)

fn address_for(order) -> Coordinates:
    if breaker.is_open():
        return cached_coordinates(order.postcode)       # fail fast with a fallback
    try:
        coords = geocoder.lookup(order.address, timeout=2s)
        breaker.record_success()
        return coords
    except Timeout:
        breaker.record_failure()                        # trips to open past the threshold
        return cached_coordinates(order.postcode)
```

After repeated failures, calls stop going to the geocoder for a while and return a fallback at once; a later trial call decides whether to close the breaker.

## By language

**java:** resilience4j is the standard (Hystrix is in maintenance mode); Spring Cloud Circuit Breaker wraps it.

**csharp:** Polly provides circuit breakers, and Microsoft.Extensions.Http.Resilience builds Polly pipelines into HttpClient in .NET 8 and later.

**typescript:** opossum is the common Node library; in browsers the need is rarer, since the user is the retry loop.

**python:** Libraries exist (pybreaker, purgatory for asyncio) but are less standard than in Java or .NET; many Python services lean on the mesh or gateway instead.

**go:** sony/gobreaker is the common library; breakers usually wrap an http.RoundTripper so all calls through a client are covered.

**rust:** Less standardised; tower's middleware ecosystem and crates such as failsafe provide breakers, often layered on a tower Service.

## Related

[Proxy](proxy.md) · [Fallacies of Distributed Computing](fallacies-of-distributed-computing.md) · [State](state.md) · [Murphy's Law](murphys-law.md)

## Sources

- Michael Nygard, Release It! (2007; 2nd ed. 2018), Circuit Breaker (recalled)
- [Martin Fowler, CircuitBreaker (bliki, 2014)](https://martinfowler.com/bliki/CircuitBreaker.html) (read)
- [Azure Architecture Center, Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) (read)
