<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Assertion-Free Test

`assertion-free-test` · anti-patterns, testing · **agents do this**

A test runs the code but asserts nothing meaningful, so it passes as long as nothing throws. Meszaros's nearest names are Neverfail Test and Manual Result Verification; also called the "secret catcher" or a smoke-only test.

*Matters most for:* data-pipeline, ml-training, scientific

## But

A deliberate smoke test ("the app starts", "this doesn't raise on valid input") is legitimate when named and meant as one, and many frameworks let you assert "does not raise" explicitly. Fuzz tests often have no assertion beyond not crashing, and that's the point. Benchmarks and type-level tests may also have no runtime assertion.

## Quality axes

- **delivery** +: Running the code without working out the expected answer is quick and still counts toward coverage.
- **reliability** −: A test that can't fail lets regressions through while reporting green.
- **change_cost** −: The suite looks like a safety net but isn't, so changes are riskier than coverage suggests.

**Flips:** A deliberate smoke test, fuzz test, benchmark or type-level test, named as such, has no assertion by design.

## Why people fall into it

- coverage targets, which count lines run rather than behaviour checked
- an agent or developer asked to "add tests" with no clear expected outcome
- not knowing what the right answer is, so the test checks only that it doesn't crash

## How it shows

- test functions with no assert or expect call at all
- assertions that can't fail, such as checking a result is not None right after building it, or a boolean asserted true with a literal
- a test wrapped in a broad try/except that swallows the failure
- async tests that don't await the work they start, so failures land after the test ends

## Overcorrecting looks like

- padding every test with extra assertions on incidental details, which leads to Fragile Test and Assertion Roulette

## What to do

Assert on the specific returned value or observable effect, watch the test fail once before trusting it, and use mutation testing to find tests that never fail.

## Example

Before:

```
fn test_hash_password():
    hasher = PasswordHasher(cost = 4)
    digest = hasher.hash("correct horse")
    assert digest is not null
```

After:

```
fn test_hashed_password_verifies_and_hides_the_original():
    hasher = PasswordHasher(cost = 4)
    digest = hasher.hash("correct horse")
    assert hasher.verify("correct horse", digest)
    assert not hasher.verify("wrong horse", digest)
    assert "correct horse" not in digest
```

The after checks what a hash is for, so a hasher that returned any non-empty string would now fail.

## Related

[Mocking Everything (over-mocking)](mock-everything.md) · [Manual Intervention](manual-intervention.md) · [Conditional Test Logic](conditional-test-logic.md)

## Overlaps

mock-everything is over-mocking until a test checks nothing real, assertion-free-test is a test that checks nothing at all, and fragile-test is the symptom both often produce: tests that break on refactors that change no behaviour.

## In the interview

- [When a convention would be enforced through a number (coverage, complexity, line or file length, a lint count), ask what the number stands for and how code could meet it without meeting the goal.](../THINKING.md#numbers-are-signals)
- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Production Bugs (Neverfail Test)](http://xunitpatterns.com/Production%20Bugs.html) (read)
- [Meszaros, xUnit Test Patterns, Manual Intervention (Manual Result Verification)](http://xunitpatterns.com/Manual%20Intervention.html) (read)
