<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Premature Optimization

`premature-optimization` · principles, planning · **contested**

Don't make code faster before you know it is a bottleneck; write it clearly, measure, then optimise the hot spots. Also called Knuth's optimization principle.

*Matters most for:* games, embedded, scientific, databases-storage

## But

Knuth's full quote also says not to pass up the critical 3%. The slogan is often used to excuse slow designs: choosing the wrong algorithm, data layout or architecture is expensive to fix later and is not "premature" to think about. Randall Hyde's "The Fallacy of Premature Optimization" makes this case. Performance budgets in latency-sensitive work (games, embedded, hot request paths) are design, not premature tuning.

## Quality axes

- **change_cost** ⊕ (primary): Code stays clear instead of filling with hand-rolled caches and tricks in paths that rarely run.
- **delivery** +: No time spent tuning code before a measurement shows it matters.

**Flips:** When it is used as an excuse to ignore algorithm, data-layout or architecture choices, or performance budgets in games, embedded or hot paths, runtime turns "-" and the fix later is expensive.

## How it shows

- hand-rolled caches, custom data structures or bit tricks in code that runs rarely
- performance commits with no profile, benchmark or measurement mentioned
- readability traded for speed in setup or configuration paths

## What to do

Profile or benchmark first, and keep an optimisation only where the measurement shows it matters.

## Example

Before:

```
_flag_cache = {}
_flag_cache_keys = []

fn load_flags(path: str) -> dict:
    if path in _flag_cache:
        return _flag_cache[path]
    flags = parse_toml(read_file(path))
    if len(_flag_cache_keys) >= 4:
        del _flag_cache[_flag_cache_keys.pop(0)]
    _flag_cache[path] = flags
    _flag_cache_keys.append(path)
    return flags

# called once at startup
```

After:

```
fn load_flags(path: str) -> dict:
    return parse_toml(read_file(path))

# called once at startup
```

The hand-rolled eviction cache sped up a function that runs once per process; without a measurement showing it mattered, the plain version is kept.

## Related

[Pareto Principle](pareto-principle.md) · [YAGNI](yagni.md)

## Sources

- [Milanović, Laws of Software Engineering, Premature Optimization (Knuth's Optimization Principle)](https://lawsofsoftwareengineering.com/laws/premature-optimization/) (read)
