<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Test Code Duplication

`test-code-duplication` · smells, testing · **contested** · **agents do this**

The same setup, exercise or verification code is copied across many tests, so one change to the code under test means editing them all. Usually Cut-and-Paste Code Reuse or Reinventing the Wheel.

## But

Many practitioners prefer DAMP (descriptive and meaningful phrases) over DRY in tests: some repetition keeps each test readable on its own, and Google's testing guidance says as much. Duplication that makes a test clearer is worth keeping; duplication that has to be updated in lockstep is the real problem.

## Quality axes

- **delivery** +: Copying the last test is the fastest way to write the next one.
- **change_cost** −: Changing one constructor or field means editing the same setup and assertions in dozens of tests.

**Flips:** Repetition that keeps each test readable on its own (DAMP over DRY) is the better trade as long as the copies don't have to change in lockstep.

## Why people fall into it

- copying the last test is the fastest way to write the next one
- not knowing that a helper already exists elsewhere in the suite
- the belief that tests should be fully self-contained, with no helpers at all

## How it shows

- several tests opening with the same block of construction code
- the same group of assertions repeated across tests on one object's fields
- near-identical tests that differ by one literal
- a commit that changes a constructor signature and touches dozens of test files

## Overcorrecting looks like

- a deep test-helper hierarchy or base class that every test inherits, turning into a General Fixture and a Mystery Guest
- extracting helpers so eagerly that each test reads as calls into code you have to go and look up

## What to do

Extract Method into Test Utility Methods (Creation Methods for setup, Custom Assertions for checks), Introduce Parameter for the bits that vary, or turn near-duplicates into a Parameterized Test.

## Example

Before:

```
fn test_signup_sends_welcome_email():
    repo = InMemoryUsers()
    mailer = RecordingMailer()
    service = Signup(repo, mailer, Clock.fixed("2024-05-01"))
    service.register("ana@example.org", "pw")
    ...
fn test_signup_rejects_duplicate_email():
    repo = InMemoryUsers()
    mailer = RecordingMailer()
    service = Signup(repo, mailer, Clock.fixed("2024-05-01"))
    ...
```

After:

```
fn a_signup_service(repo = InMemoryUsers(), mailer = RecordingMailer()):
    return Signup(repo, mailer, Clock.fixed("2024-05-01"))

fn test_signup_sends_welcome_email():
    mailer = RecordingMailer()
    a_signup_service(mailer = mailer).register("ana@example.org", "pw")
    ...
fn test_signup_rejects_duplicate_email():
    service = a_signup_service()
    ...
```

One Creation Method now owns how the service is built, so a new constructor argument changes one place.

## Related

[Duplicate Code](duplicate-code.md) · [Obscure Test](obscure-test.md)

## In the interview

- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Meszaros, xUnit Test Patterns, Test Code Duplication](http://xunitpatterns.com/Test%20Code%20Duplication.html) (read)
