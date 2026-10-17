<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Manual Intervention

`manual-intervention` · smells, testing

A test needs a person to do something each run, whether setting up the environment, injecting an event or checking the result by eye.

*Matters most for:* embedded, mobile, desktop, games, iac

## But

Exploratory testing, usability testing and some hardware-in-the-loop checks are manual by nature and valuable. Visual review of UI changes is often a person looking at a diff, helped by screenshot tooling. The smell is in the automated suite, not in manual testing as a practice.

## Quality axes

- **change_cost** −: Every run needs a person to set things up or check the output by eye, so tests run rarely and changes go unverified longer.
- **reliability** −: Results checked by eye and runs that get skipped let regressions through.

## Why people fall into it

- events that are hard to trigger from code, like a dropped connection or a hardware button
- coupling that keeps most of the system from running in a dev environment
- automating the exercise step first and leaving the checking "for later"

## How it shows

- a README step to start servers or load data before the tests will pass
- tests that print output for someone to read instead of asserting on it
- tests that wait for input or are skipped unless a person sets something up
- test suites that can't run in CI

## Overcorrecting looks like

- forcing full automation on exploratory or usability checks that need human judgement

## What to do

Automate fixture setup, make every test self-checking with assertions, and simulate hard-to-trigger events by calling the handler directly or stubbing the dependency that reports them.

## Example

Before:

```
fn test_export_members_csv():
    rows = export_members(sample_club())
    print(rows)
    # check the output looks right
```

After:

```
fn test_export_members_csv():
    club = club_with(Member("Ana", joined = 2021))
    rows = export_members(club)
    assert rows == ["name,joined", "Ana,2021"]
```

The expected output is written down, so the test checks itself and can run unattended in CI.

## One-file tell

A test that prints or logs results for a person to read and has no assertion.

## Related

[Assertion-Free Test](assertion-free-test.md) · [Slow Tests](slow-tests.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Manual Intervention](http://xunitpatterns.com/Manual%20Intervention.html) (read)
