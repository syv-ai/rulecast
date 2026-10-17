<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Test Logic in Production

`test-logic-in-production` · smells, testing · **agents do this**

Production code contains logic that exists only for tests, such as a Test Hook that switches behaviour when testing, methods For Tests Only, a dependency on test code, or Equality Pollution.

*Matters most for:* web-api, fullstack-web, serverless, platforms

## But

Some test support in production code is normal and fine: a constructor that accepts a clock, a package-private or internal-visible member, a health or debug endpoint behind auth. Rust's cfg(test) and Go's export_test.go keep test-only code out of the release build by design. The danger is behaviour that differs at runtime between test and production, not code that merely makes testing possible.

## Quality axes

- **delivery** +: Putting a hard-coded value behind a test flag is quicker than adding a seam.
- **reliability** −: Code that behaves differently under test means the tests verify a path production never runs, and a test flag left on changes live behaviour.
- **security** −: A test hook or test-mode switch shipped in production can be tripped to bypass normal checks.

## Why people fall into it

- a dependency that can't run in the test environment and no seam to replace it
- wanting deterministic results quickly, so a hard-coded value goes in behind a flag
- retrofitting tests on legacy code that hides the state the test needs

## How it shows

- branches on a test flag or environment, such as checking whether the test runner is loaded or the environment is "test"
- methods only ever called from test files, or fields made public just so tests can read them
- production modules importing from test packages, even just for types
- an equals method written to suit a test's comparison rather than the domain

## Overcorrecting looks like

- refusing any test-visible hook, then reaching for reflection or monkey-patching private internals, which is worse

## What to do

Move the varying behaviour behind a substitutable dependency (a Strategy, defaulting to a Null Object), expose internals through a Test-Specific Subclass, and use Custom Assertions instead of changing equals.

## Example

Before:

```
class CardPayments:
    fn charge(card, amount):
        if env("APP_MODE") == "test":
            return Receipt(id = "TEST-1", ok = true)
        return this.gateway_client.charge(card, amount)
```

After:

```
interface PaymentGateway:
    fn charge(card, amount) -> Receipt

class CardPayments:
    fn init(gateway: PaymentGateway): ...
    fn charge(card, amount):
        return this.gateway.charge(card, amount)
# tests pass in a FakeGateway; production passes the real one
```

The test path no longer exists in production, so a misconfigured flag can't skip real charges.

## One-file tell

Non-test, non-configuration code that branches on whether it is running under a test (an environment value equal to "test", a TESTING flag, or a check for the test runner's module) and returns or skips something different on that branch.

## By language

**rust:** Code under cfg(test) is compiled out of release builds, so test-only helpers there don't count.

**go:** export_test.go files expose internals to tests in the same package without leaking into the build.

## Related

[Hard-to-Test Code](hard-to-test-code.md) · [Mocking Everything (over-mocking)](mock-everything.md)

## Sources

- [Meszaros, xUnit Test Patterns, Test Logic in Production](http://xunitpatterns.com/Test%20Logic%20in%20Production.html) (read)
