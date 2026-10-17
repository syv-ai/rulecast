<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# CAP Theorem

`cap-theorem` · laws, architecture

When a network partition splits a distributed data store, it has to choose between staying consistent and staying available; also called Brewer's theorem.

*Matters most for:* distributed, databases-storage

*Applies only to:* distributed, databases-storage

## But

The "pick two of three" framing is misleading: partitions aren't optional, so the real choice only shows up during one. Martin Kleppmann argues its definitions are too narrow and ambiguous to guide design, and Brewer's own 2012 follow-up softened it. PACELC (Daniel Abadi) adds the latency versus consistency trade-off that matters when there is no partition. Labelling whole databases CP or AP, as the page does with MongoDB and Cassandra, oversimplifies: both behave differently depending on configuration.

## Quality axes

*Bears on:* reliability. During a partition a replicated store must either refuse requests or serve stale or conflicting data, and code that doesn't choose gets whichever happens.

## How it shows

- replicated data stores or caches where the code doesn't say what happens when replicas disagree
- read and write calls with no stated consistency level, quorum or conflict-resolution choice

## What to do

Decide per operation whether to fail or serve possibly stale data during a partition, and make that choice explicit in configuration and code.

## Example

Before:

```
fn points_balance(member_id: str) -> int:
    return replicas.any().get("points", member_id)

fn redeem(member_id: str, cost: int):
    balance = replicas.any().get("points", member_id)
    if balance >= cost:
        replicas.any().put("points", member_id, balance - cost)
```

After:

```
fn points_balance(member_id: str) -> int:
    # shown on the dashboard: a stale number is fine, stay available
    return replicas.any().get("points", member_id)

fn redeem(member_id: str, cost: int):
    # spends points: refuse during a partition rather than spend from a stale balance
    balance = replicas.quorum().get("points", member_id)
    if balance >= cost:
        replicas.quorum().put("points", member_id, balance - cost)
```

Each operation now states what it gives up when replicas can't reach each other, availability for redeeming and consistency for display.

## Related

[Fallacies of Distributed Computing](fallacies-of-distributed-computing.md)

## Sources

- [Milanović, Laws of Software Engineering, CAP Theorem](https://lawsofsoftwareengineering.com/laws/cap-theorem/) (read)
