<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fragile Test

`fragile-test` · smells, testing

Tests break when the code changes in ways that don't affect what they're testing, through one of four sensitivities (interface, behaviour, data, context), Overspecified Software, Sensitive Equality or a Fragile Fixture.

*Matters most for:* web-frontend, fullstack-web, compilers-tooling, cli-devtool, tui

## But

A test that fails when the behaviour it pins changes is doing its job; that isn't fragility. Golden-file and snapshot tests are deliberately sensitive to output and are right when the output is the contract (a renderer, a CLI's text, a serialiser), as long as updating them is a reviewed step. Public APIs used by unknown clients sometimes need tests that pin the interface exactly.

## Quality axes

- **delivery** +: Testing through whatever interface was easiest, with mocks verifying every call, is quick to write.
- **change_cost** −: Refactorings that don't change behaviour still break many tests, so every internal change carries a test-repair tax and refactoring is discouraged.

**Flips:** Snapshot and golden-file tests are right when the output is the contract (a renderer, CLI text, a serialiser), as long as updating them is a reviewed step.

## Why people fall into it

- testing through whatever interface was easiest at the time, including private methods
- mock frameworks that make it easy to verify every call with exact arguments
- one shared fixture that each new test bends a little

## How it shows

- many tests changing in a refactoring commit that didn't change behaviour
- assertions on the string or repr of an object rather than its values
- tests that verify the exact sequence of calls to collaborators
- many tests depending on one standard fixture or seed dataset
- UI tests that locate elements by position or generated class names

## Overcorrecting looks like

- testing only at the top through the UI or HTTP to avoid coupling, which brings Slow Tests and Frequent Debugging

## What to do

Test through the public interface (Use the Front Door First), encapsulate the code's API behind Creation Methods and Custom Assertions, compare values rather than strings, give tests their own minimal fixtures, and control context like time with test doubles.

## Example

Before:

```
fn test_invoice_total():
    invoice = Invoice(lines = [Line("hosting", 40.00), Line("support", 10.00)])
    invoice.apply_tax(rate = 0.25)
    assert to_string(invoice) == "Invoice(lines=2, net=50.0, tax=12.5, total=62.5)"
```

After:

```
fn test_invoice_total_includes_tax():
    invoice = Invoice(lines = [Line("hosting", 40.00), Line("support", 10.00)])
    invoice.apply_tax(rate = 0.25)
    assert invoice.total == 62.50
```

The test checks the value it cares about, so changing how invoices print no longer breaks it.

## Related

[Mocking Everything (over-mocking)](mock-everything.md) · [Obscure Test](obscure-test.md) · [Hard-to-Test Code](hard-to-test-code.md)

## Overlaps

mock-everything is over-mocking until a test checks nothing real, assertion-free-test is a test that checks nothing at all, and fragile-test is the symptom both often produce: tests that break on refactors that change no behaviour.

## In the interview

- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Meszaros, xUnit Test Patterns, Fragile Test](http://xunitpatterns.com/Fragile%20Test.html) (read)
