<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Pipes and Filters

`pipes-and-filters` · design patterns, architecture

Break processing into a chain of independent steps (filters), each taking input and producing output, joined by pipes that carry data from one to the next and hold no logic of their own.

*Names:* The Unix pipeline, proposed by Doug McIlroy and built into Unix in 1973, is the original. Named as an architectural style by Mary Shaw and David Garlan (Software Architecture, 1996) and as a pattern in Buschmann et al., POSA vol. 1 (1996). Also called a pipeline architecture (Richards and Ford). Hohpe and Woolf's Enterprise Integration Patterns (2003) use it as the base messaging style.

*Matters most for:* data-pipeline, cli-devtool, compilers-tooling, ml-training, event-driven

## But

Pipelines suit independent, ordered transformations; they fit poorly when steps must share a lot of context, run in one transaction, or answer a synchronous request. Distributed pipelines bring duplicate messages and partial failures, so each filter must be idempotent and the pipe must not lose data. A common schema between filters keeps them reorderable but can push every filter to carry fields it doesn't use. Error handling is the weak point: decide early whether a failing filter stops the pipeline, skips the item or sends it to a dead-letter queue.

## Quality axes

- **change_cost** ⊕ (primary): Each step is a separate filter, tested alone, and steps are reordered, added or removed per source instead of copied.
- **runtime** +: Data streams through, so later steps start before earlier ones finish and expensive stages can be scaled or run in parallel.
- **reliability** −: Error handling is the weak point - a failing filter needs a deliberate stop, skip or dead-letter policy, or items are lost or half-processed.

**Flips:** For a few fixed steps, or work that must share context, run in one transaction or answer synchronously, it is needless structure; distributing each filter as a service brings duplicates and partial failures, turning reliability and operability further "-".

## Warranted when

- A long function does several sequential transformations that are hard to test or reuse separately.
- Steps need to be reordered, added or removed per input source or customer.
- Some steps are much more expensive than others and need to scale or run in parallel on their own.
- The data can be processed as a stream, so later steps can start before earlier ones finish.

## How it shows

- A list of stage functions or objects with the same input/output type applied in order.
- Stream or iterator chains (shell pipes, generators, Rx operators, Rust iterator adapters).
- Queues between workers, each worker reading one queue and writing the next.
- ETL or build pipelines defined as an ordered set of steps in configuration.

## Overdone when

- A pipeline framework for three steps that will never change order.
- Distributing each filter as its own service with queues between, for work that fits in one process.
- Filters that secretly share state or depend on each other's order, so the pipeline only looks composable.
- Forcing request/response work into a pipeline when the caller needs the answer now.

## Example

Before:

```
fn ingest(lines):
    for line in lines:
        record = parse_log_line(line)
        if record is None: continue
        record.ip = mask_last_octet(record.ip)
        record.country = geo_lookup(record.ip)
        warehouse.write(record)
# a second source that skips geo lookup means copying the whole loop
```

After:

```
fn parse(lines):   for l in lines: r = parse_log_line(l); if r: yield r
fn redact(records): for r in records: r.ip = mask_last_octet(r.ip); yield r
fn enrich(records): for r in records: r.country = geo_lookup(r.ip); yield r

fn run(source, filters, sink):
    stream = source
    for f in filters: stream = f(stream)
    for r in stream: sink.write(r)

run(web_logs, [parse, redact, enrich], warehouse)
run(vpn_logs, [parse, redact], warehouse)
```

Each step is a filter over a stream; pipelines for new sources are assembled rather than copied.

## By language

**python:** Generator functions chained together give lazy, streaming pipelines in a few lines; a list of callables folded over the input is the simple form.

**typescript:** Array method chains are eager; Node streams and async iterators give streaming with backpressure.

**java:** java.util.stream is the in-process form; Spring Integration and Apache Camel provide message-based pipes and filters.

**csharp:** LINQ chains for in-process work; System.Threading.Channels or TPL Dataflow for concurrent pipelines with bounded buffers.

**go:** The goroutine-per-stage, channel-per-pipe pattern is idiomatic and described in the Go blog's "Pipelines and cancellation"; pass a context for cancellation and close channels downstream.

**rust:** Iterator adapters are zero-cost in-process pipes; for concurrent stages, channels (std::sync::mpsc, crossbeam, tokio::mpsc) between threads or tasks.

## Related

[Chain of Responsibility](chain-of-responsibility.md) · [Decorator](decorator.md) · [Functional decomposition](functional-decomposition.md)

## Sources

- [Azure Architecture Center, Pipes and Filters pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters) (read)
- Mary Shaw and David Garlan, Software Architecture, Perspectives on an Emerging Discipline (1996) (recalled)
- Buschmann et al., Pattern-Oriented Software Architecture vol. 1 (1996), Pipes and Filters (recalled)
