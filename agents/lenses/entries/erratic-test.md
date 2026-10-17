<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Erratic Test

`erratic-test` · smells, testing

A test passes sometimes and fails other times with no code change, today usually called a flaky test. Causes include Interacting Tests, Test Run War, Unrepeatable Test, Resource Leakage, Resource Optimism and Nondeterministic Test.

*Matters most for:* distributed, event-driven, web-frontend, mobile, databases-storage, tui

## But

Some nondeterminism is the point: fuzzing, property-based tests and chaos tests explore inputs on purpose. Record the seed so a failure can be replayed. At large scale some flakiness in end-to-end tests is accepted and managed with quarantine and statistics (Google has written about this), rather than driven to zero.

## Quality axes

- **reliability** −: Once failures are routinely rerun, real races and order dependencies get dismissed as flakes.
- **change_cost** −: A suite that fails at random can't be trusted, so every change needs reruns and second-guessing.
- **delivery** −: Random red builds block merges and burn CI reruns this week.

**Flips:** Fuzzing, property-based and chaos tests are nondeterministic on purpose; record the seed so failures replay.

## Why people fall into it

- a shared fixture adopted to make slow tests faster
- not being able to control time, randomness or concurrency in the code under test
- pressure to keep the build green, which leads to retries rather than fixes

## How it shows

- tests reading the real clock, random values without a seed, or environment-specific paths
- shared mutable fixtures, static state or a shared database that tests write to
- fixed sleeps waiting for background work
- tests that pass alone and fail in the full suite, or the other way round
- retry or rerun-on-failure settings in the CI config, and skip markers labelled flaky

## Overcorrecting looks like

- removing all randomness, including property-based and fuzz tests that find real bugs, instead of seeding and logging it

## What to do

Use a Fresh Fixture per test, inject the clock and random source, replace sleeps with waiting on a condition or testing the logic synchronously, give each runner its own sandbox, and quarantine a flaky test while you fix the cause.

## Example

Before:

```
fn test_coupon_is_still_valid():
    coupon = Coupon(code = "SPRING", expires = now() + hours(1))
    assert coupon.is_valid()
    # fails near midnight when expiry rounds to the day
```

After:

```
fn test_coupon_is_valid_until_its_expiry_day_ends():
    clock = FixedClock("2024-04-10T23:30")
    coupon = Coupon(code = "SPRING", expires = date(2024, 4, 10))
    assert coupon.is_valid(clock)
```

A fixed clock makes the test repeatable and pins the edge case the real clock only hit sometimes.

## One-file tell

A test body that reads the real current time, calls random without a seed, or sleeps for a fixed duration.

## Related

[Slow Tests](slow-tests.md) · [Fragile Test](fragile-test.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Conditional Test Logic](conditional-test-logic.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Erratic Test](http://xunitpatterns.com/Erratic%20Test.html) (read)
