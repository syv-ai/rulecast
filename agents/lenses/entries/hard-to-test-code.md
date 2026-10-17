<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Hard-to-Test Code

`hard-to-test-code` · smells, testing

The code resists being tested in isolation because it is tightly coupled, asynchronous, hides what a test needs to reach, or can't be constructed without half the system.

*Matters most for:* embedded, games, desktop, mobile, serverless, event-driven, tui

## But

"Make it testable" can drive design damage when it means seams nobody needs; DHH's "test-induced design damage" argument is the known critique. Some code is thin glue that is better covered by an integration test than reshaped for unit tests. Testability is a good design pressure, but it isn't the only one.

## Quality axes

- **delivery** +: Creating the database client or clock in place is the smallest change that works today.
- **change_cost** −: Logic that can't be run without half the system has no fast tests, so every change to it is slow to check and risky.
- **reliability** −: Logic tangled with I/O, threads or UI stays untested, so its edge cases are found in production.

**Flips:** Thin glue is often better covered by an integration test than reshaped with seams nobody else needs.

## Why people fall into it

- wiring a dependency in place is the smallest change that works
- frameworks that put logic in controllers or callbacks by default
- code written before any tests, then tests retrofitted later

## How it shows

- classes that create their own database connections, HTTP clients or clocks inside methods or constructors
- business logic inside UI handlers, threads or process entry points
- constructors that are private or need many collaborators to call
- module-level singletons and global state read from deep inside functions
- tests that need sleeps or spin up a real process to reach the logic

## Overcorrecting looks like

- injecting every collaborator, including pure value objects and stable standard-library helpers, so constructors grow long parameter lists for no gain
- adding interfaces with a single implementation only so something can be mocked

## What to do

Break the coupling with dependency injection and test doubles, separate logic from its async or UI shell with Humble Object, and use Feathers' seams (Working Effectively with Legacy Code) for legacy code.

## Example

Before:

```
class DailyDigest:
    fn send():
        db = Database.connect(PROD_URL)
        orders = db.query("... where day = ?", today())
        text = format_digest(orders)
        SmtpClient("mail.internal").send(text)
```

After:

```
class DailyDigest:
    fn init(orders: OrderSource, mailer: Mailer, clock: Clock): ...
    fn send():
        orders = this.orders.for_day(this.clock.today())
        this.mailer.send(format_digest(orders))
```

The database, mail server and clock come in from outside, so a test can give it known inputs and see the output.

## Related

[Singleton](singleton.md) · [Test Logic in Production](test-logic-in-production.md) · [Mocking Everything (over-mocking)](mock-everything.md) · [Fragile Test](fragile-test.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Hard-to-Test Code](http://xunitpatterns.com/Hard%20to%20Test%20Code.html) (read)
- Feathers, Working Effectively with Legacy Code (recalled)
