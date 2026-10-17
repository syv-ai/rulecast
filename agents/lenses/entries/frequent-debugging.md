<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Frequent Debugging

`frequent-debugging` · smells, testing

Most test failures need a debugger or print statements to find the cause, because the suite lacks defect localization. Also called Manual Debugging.

*Matters most for:* distributed, embedded

## But

Some debugging is normal, especially for concurrency and integration problems no unit test would catch. The smell is when it's the usual way to understand a red test. Teams that favour broad integration tests (Kent C. Dodds' testing trophy, for example) accept a bit more debugging in return for less coupling.

## Quality axes

- **change_cost** −: A red test doesn't point to its cause, so each failure after a change means a debugging session.

**Flips:** Teams that favour broad integration tests accept more debugging in return for tests less coupled to the implementation.

## Why people fall into it

- writing high-level tests first and skipping the smaller ones
- running tests rarely, so many changes land between runs

## How it shows

- only high-level or end-to-end tests for an area, with no unit tests for the classes inside it
- leftover debug prints and commented-out breakpoints in commit history
- mocked collaborators whose behaviour in tests doesn't match their own unit tests

## Overcorrecting looks like

- chasing defect localization with a unit test per method, which pins implementation and makes tests fragile

## What to do

Fill in unit and component tests where failures are hard to place, run tests after every small change, and write a failing test that reproduces each bug before fixing it.

## Example

None: About how a whole suite localises failures over time, not about the shape of one test.

## Related

[Assertion Roulette](assertion-roulette.md) · [Slow Tests](slow-tests.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Frequent Debugging](http://xunitpatterns.com/Frequent%20Debugging.html) (read)
