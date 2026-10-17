<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Conditional Test Logic

`conditional-test-logic` · smells, testing · **agents do this**

A test contains branches or loops, so you can't be sure which path runs or whether it checks anything at all. Also called Indented Test Code; its causes include Flexible Test, Conditional Verification Logic, Production Logic in Test and Complex Teardown.

## But

A loop in a property-based test or a table-driven test is the whole point of the technique, not a smell, as long as each case reports itself on failure. Go's table-driven style puts a for loop in nearly every test and is idiomatic there. Waiting loops in integration tests against an async system are sometimes unavoidable; put them in a named helper with a timeout.

## Quality axes

- **reliability** −: An if around the assertions, or an expected value computed with the production formula, lets the test pass while checking nothing.
- **change_cost** −: You have to trace which branch ran before you can trust or edit the test.

**Flips:** Table-driven and property-based tests loop over cases on purpose (idiomatic in Go) and are right when each case reports itself on failure.

## Why people fall into it

- wanting one test to cover many input combinations without a parameterised-test feature to hand
- not being able to control a dependency like the clock, so the test adapts to it instead
- guarding against a null result to avoid a confusing crash in the assertion

## How it shows

- if, for or while statements in the body of a test function
- an if guarding the assertions, so the test passes quietly when the result is missing
- expected values computed in the test with the same formula the production code uses
- tests that build different expected results depending on the time, platform or environment
- teardown code full of checks for whether each resource was actually created

## Overcorrecting looks like

- unrolling a loop over a known collection into dozens of copy-pasted assertions instead of one collection equality check

## What to do

Use a Guard Assertion instead of an if, compare against an Expected Object, move loops into a tested Custom Assertion, turn case tables into a Parameterized Test, and inject the dependency that made the test flexible.

## Example

Before:

```
fn test_shipping_rates():
    for weight in [0.5, 2, 10, 30]:
        rate = shipping.rate_for(weight)
        if weight <= 1:
            assert rate == 4.00
        else:
            assert rate == 4.00 + (weight - 1) * 1.20
```

After:

```
cases = [
    (0.5, 4.00),
    (2, 5.20),
    (30, 38.80),
]
fn test_shipping_rate(weight, expected):   # run once per case
    assert shipping.rate_for(weight) == expected
```

Pre-computed expected values replace the formula copied from production, and each case fails on its own.

## One-file tell

Python only: an assert statement (or a self.assert* or assert_* call) inside an if, elif or else branch within a test_* function. Asserts inside loops don't count.

## By language

**go:** Table-driven tests with a for loop over cases and t.Run per case are the norm and don't count. Ifs that decide whether to assert still do.

## Related

[Obscure Test](obscure-test.md) · [Erratic Test](erratic-test.md) · [Assertion-Free Test](assertion-free-test.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Conditional Test Logic](http://xunitpatterns.com/Conditional%20Test%20Logic.html) (read)
