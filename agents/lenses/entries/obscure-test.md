<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Obscure Test

`obscure-test` · smells, testing

You can't tell at a glance what behaviour a test checks, either because it hides what matters (Mystery Guest) or buries it under detail (Eager Test, General Fixture, Irrelevant Information, Hard-Coded Test Data, Indirect Testing). Also called Long Test, Complex Test or Verbose Test.

## But

End-to-end and customer-facing tests are longer by nature, and that's fine as long as each step reads clearly. Some data really is too big to inline (a sample PDF, a recorded payload), so a named fixture file is the right call; the smell is when its name says nothing about what's in it. Golden-file or snapshot tests trade readability of the test for coverage of the whole output on purpose.

## Quality axes

- **delivery** +: Writing everything inline or copying a neighbour's big setup is the quickest way to get the test green.
- **change_cost** −: A reader can't see what behaviour the test pins, so a failure or a needed update means digging through fixtures and helpers.

**Flips:** Golden-file and snapshot tests, and named fixtures for data too big to inline, give up per-test readability on purpose to cover the whole output.

## Why people fall into it

- writing everything inline because it's the quickest way to get the test green
- copying a big setup from a neighbouring test rather than working out the minimal one
- test code treated as second-class, so it never gets refactored

## How it shows

- long test functions that build far more fixture than the assertions use
- tests that load a fixture file or database row by a literal name, so the input never shows in the test
- a shared setup helper with a generic name (setup_standard_data) called by tests that need very different data
- magic literals in both the arrange and assert steps with no visible link between them
- a test that reaches the code under test through some other object instead of calling it directly

## Overcorrecting looks like

- hiding so much behind helpers and builders that the test is a one-liner whose meaning lives in three other files, which is a Mystery Guest of its own
- banning shared fixtures outright even where building fresh data is slow and the shared data is immutable

## What to do

Build a fresh, minimal fixture inline, push irrelevant detail into well-named Creation Methods, split Eager Tests into single-condition tests, and give literals names that show cause and effect.

## Example

Before:

```
fn test_overdue_fine():
    library = load_library("fixtures/library_2.json")
    member = library.find_member(17)
    loan = member.loans[2]
    ...
    assert fines.calculate(loan, today=date(2024, 3, 9)) == 1.50
```

After:

```
fn test_overdue_fine_is_fifty_cents_per_day():
    loan = a_loan(due=date(2024, 3, 6))
    fine = fines.calculate(loan, today=date(2024, 3, 9))
    assert fine == 3 * 0.50
```

The fixture the result depends on is now in the test, so the reader can see why the fine is what it is.

## Related

[Assertion Roulette](assertion-roulette.md) · [Test Code Duplication](test-code-duplication.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)
- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Meszaros, xUnit Test Patterns, Obscure Test](http://xunitpatterns.com/Obscure%20Test.html) (read)
