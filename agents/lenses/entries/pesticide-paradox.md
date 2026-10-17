<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Pesticide Paradox

`pesticide-paradox` · laws, quality

Running the same tests over and over finds fewer and fewer new bugs, so the suite has to grow and change with the code.

*Matters most for:* compilers-tooling, databases-storage, library-sdk

## But

A stable regression suite is still doing its job when it stays green: it guards behaviour that already works. The paradox is about finding new defects, not a reason to churn existing tests for its own sake.

## Quality axes

*Bears on:* reliability. A suite that never changes stops finding new bugs, so defects in new code and on unexplored inputs slip past a green build.

## How it shows

- new features or modules landing with no matching test files
- a test directory that has barely changed while the source tree grew
- bug fixes merged without a regression test

## What to do

Add a test for every escaped bug, cover new features as they land, and vary inputs with property-based, fuzz or exploratory testing.

## Example

Before:

```
fn test_parse_duration():
    assert parse_duration("1h30m") == 90
    assert parse_duration("45m") == 45
    assert parse_duration("2h") == 120
```

After:

```
fn test_parse_duration():
    assert parse_duration("1h30m") == 90
    assert parse_duration("45m") == 45
    assert parse_duration("2h") == 120

fn test_parse_duration_minutes_over_sixty():
    # escaped bug: "0h75m" was read as 15
    assert parse_duration("0h75m") == 75

fn test_parse_duration_round_trips():
    for minutes in random_ints(0, 10000, count=500):
        assert parse_duration(format_duration(minutes)) == minutes
```

The same three inputs kept passing while a bug got past them; the suite now gains a regression test for that bug and varied inputs that can find the next one.

## Related

[Testing Pyramid](testing-pyramid.md)

## Sources

- [Milanović, Laws of Software Engineering, Pesticide Paradox](https://lawsofsoftwareengineering.com/laws/pesticide-paradox/) (read)
