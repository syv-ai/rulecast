<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Gustafson's Law

`gustafsons-law` · laws, scale

If the problem grows with the hardware, parallel speedup can stay close to linear, because the serial part stays roughly fixed while the parallel part grows.

*Matters most for:* distributed, data-pipeline, scientific, ml-training

## But

It only helps when you actually want to process more, not when you need the same job done faster, such as lowering latency for a single request; there Amdahl's limit still holds. Communication and coordination costs often grow with the cluster, so near-linear scaled speedup is an ideal.

## Quality axes

*Bears on:* runtime. When the workload grows with the hardware, partitioned work gains throughput almost linearly as machines are added.

## How it shows

- jobs that partition data by a configurable shard or partition count tied to the number of workers
- a fixed partition count hard-coded so extra nodes sit idle

## What to do

Design work to scale out by partitioning the data so added machines take on more of it.

## Example

Before:

```
PARTITIONS = 8

fn index_logs(day: Date, cluster: Cluster):
    chunks = split_by_hash(log_files(day), PARTITIONS)
    for chunk in chunks:
        cluster.submit(build_index, chunk)
```

After:

```
fn index_logs(day: Date, cluster: Cluster):
    partitions = cluster.worker_count() * config.partitions_per_worker
    chunks = split_by_hash(log_files(day), partitions)
    for chunk in chunks:
        cluster.submit(build_index, chunk)
```

The partition count follows the cluster size, so added workers take on more of the growing log volume instead of sitting idle past the eighth.

## Related

[Amdahl's Law](amdahls-law.md)

## Sources

- [Milanović, Laws of Software Engineering, Gustafson's Law](https://lawsofsoftwareengineering.com/laws/gustafsons-law/) (read)
