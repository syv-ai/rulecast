<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Assertion Roulette

`assertion-roulette` · smells, testing · **contested**

A test has several assertions and when it fails you can't tell which one, usually because it is an Eager Test or the assertions have no messages.

## But

Modern runners report the failing line and diff the values, so much of the original pain is gone. Several assertions that check one logical outcome are fine and widely accepted; Roy Osherove and others argue for "one concept per test", not one assert. Soft-assertion features also report every failure at once.

## Quality axes

- **change_cost** −: When the test fails you can't tell which of the bare assertions broke, so each red build starts with a hunt for the failing check.

## Why people fall into it

- minimising the number of tests, the way manual test scripts chain steps
- automating long customer workflows in a unit-test framework

## How it shows

- a long run of bare boolean assertions with no messages in one test
- a test that calls the code under test several times with setup and assertions interleaved
- CI failure output that shows only "expected true, got false"

## Overcorrecting looks like

- a strict one-assert-per-test rule that splits a single logical check (all fields of one result) into many tests with duplicated setup

## What to do

Split Eager Tests into Single Condition Tests, add assertion messages, or replace a run of field checks with one equality assertion on an expected object.

## Example

Before:

```
fn test_parse_sensor_frame():
    frame = parse_frame(bytes_from_hex("01 2A 00 FF 19"))
    assert frame.valid
    assert frame.sensor_id == 1
    assert frame.celsius == 4.2
    frame = parse_frame(bytes_from_hex("01 2A"))
    assert not frame.valid
```

After:

```
fn test_parses_a_complete_frame():
    frame = parse_frame(bytes_from_hex("01 2A 00 FF 19"))
    assert frame == Frame(valid = true, sensor_id = 1, celsius = 4.2)

fn test_rejects_a_truncated_frame():
    assert not parse_frame(bytes_from_hex("01 2A")).valid
```

Two conditions become two tests, and one equality check on the whole frame shows every wrong field in its diff.

## Related

[Obscure Test](obscure-test.md) · [Frequent Debugging](frequent-debugging.md)

## Sources

- [Meszaros, xUnit Test Patterns, Assertion Roulette](http://xunitpatterns.com/Assertion%20Roulette.html) (read)
