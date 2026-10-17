<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Amdahl's Law

`amdahls-law` · laws, scale

The part of the work that has to run in sequence caps how much faster you can get by adding parallel workers.

*Matters most for:* distributed, data-pipeline, scientific, ml-training, databases-storage

## But

It assumes a fixed problem size. When the workload grows with the hardware, Gustafson's view fits better and the ceiling is much less gloomy. The page also stretches it to teams and decision-making; that is an analogy, not the law, and the maths doesn't carry over cleanly. For I/O-bound work, latency and contention usually matter more than the serial fraction.

## Quality axes

*Bears on:* runtime. The serial part of the work (a global lock, a single reducer, one shared database) caps the speedup you get from adding workers or machines.

## How it shows

- a global lock, mutex or single-writer queue that every worker goes through
- a parallel pipeline with one serial stage, such as a single reducer or a final merge step
- many stateless app servers in front of one database instance or one shared auth or billing service

## What to do

Profile to find the serial fraction and shrink it before adding cores, machines or replicas.

## Example

Before:

```
lock = Mutex()
results = []

fn make_thumbnail(photo: Photo):
    lock.acquire()
    image = decode(photo.bytes)
    small = resize(image, 256, 256)
    results.append(encode_jpeg(small))
    lock.release()

pool.run(make_thumbnail, photos, workers=32)
```

After:

```
lock = Mutex()
results = []

fn make_thumbnail(photo: Photo):
    image = decode(photo.bytes)
    small = resize(image, 256, 256)
    data = encode_jpeg(small)
    lock.acquire()
    results.append(data)
    lock.release()

pool.run(make_thumbnail, photos, workers=32)
```

The lock held the whole job, so 32 workers ran one at a time; now only the shared append runs in sequence, and that serial part is what limits the speedup.

## Related

[Gustafson's Law](gustafsons-law.md)

## In the interview

- [Spend the interview where the work is.](../THINKING.md#find-where-changes-concentrate)

## Sources

- [Milanović, Laws of Software Engineering, Amdahl's Law](https://lawsofsoftwareengineering.com/laws/amdahls-law/) (read)
