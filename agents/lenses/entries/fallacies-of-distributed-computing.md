<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fallacies of Distributed Computing

`fallacies-of-distributed-computing` · laws, architecture

Eight false assumptions about networks, such as that they are reliable, fast, secure and unchanging, that lead to fragile distributed systems.

*Matters most for:* distributed, web-api, event-driven, serverless, mobile

## But

Not every call needs the full resilience kit. A script or internal tool can accept a crash on network failure, and piling on retries without idempotency or backoff can cause duplicate writes and retry storms. Pick the defences that match what failure actually costs.

## Quality axes

*Bears on:* reliability, security, runtime. Code that assumes the network is reliable, fast and secure hangs or duplicates writes on failures, pays latency per call, and trusts traffic it shouldn't.

## How it shows

- remote calls with no timeout, retry policy or error handling
- chatty loops that make one network call per item
- service-to-service traffic sent unencrypted or unauthenticated because it is internal
- hard-coded hostnames or IPs instead of discovery or configuration

## What to do

Treat every remote call as slow and fallible; add timeouts, bounded retries with backoff, idempotency, batching, authentication and configurable endpoints.

## Example

Before:

```
fn latest_readings(station_ids: list) -> list:
    readings = []
    for id in station_ids:
        resp = http.get("http://10.0.4.17/stations/" + id + "/latest")
        readings.append(parse(resp.body))
    return readings
```

After:

```
fn latest_readings(station_ids: list) -> list:
    resp = retry(
        fn(): http.get(
            config.weather_api_url + "/stations/latest",
            query={"ids": join(station_ids, ",")},
            timeout=5.0,
            auth=config.weather_api_token,
        ),
        attempts=3, backoff=exponential(0.5),
    )
    if resp.status != 200:
        raise WeatherApiError(resp.status)
    return parse_all(resp.body)
```

One batched, authenticated call with a timeout and bounded retries replaces a call per station to a hard-coded host that assumed the network never fails or slows down.

## One-file tell

An HTTP or RPC client call with no timeout argument, such as requests.get without timeout=.

## By language

**python:** requests and urllib3 have no default timeout, so a call without one can hang forever.

## Related

[CAP Theorem](cap-theorem.md) · [The Law of Leaky Abstractions](law-of-leaky-abstractions.md)

## Sources

- [Milanović, Laws of Software Engineering, Fallacies of Distributed Computing](https://lawsofsoftwareengineering.com/laws/fallacies-of-distributed-computing/) (read)
