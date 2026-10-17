<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Error Handling Policy

`error-handling-policy` · practices, design

Decide once, for the whole codebase, how errors are represented (values, exceptions or panics), which ones may abort the program, and at which layer each kind is handled, so every module fails the same way.

*Names:* Also called error model or error strategy. No single originator. Joe Duffy's "The Error Model" (2016, from Microsoft's Midori project) is the clearest statement of the split between recoverable errors and bugs. Rob Pike's "Errors are values" (2015) states Go's position, and the Rust book's chapter on errors states Rust's.

*Matters most for:* library-sdk, cli-devtool, web-api, plugin-host, platforms

## But

A short script or a prototype doesn't need a policy; letting it crash with a stack trace is fine. Practitioners genuinely disagree on the mechanism itself (checked exceptions, unchecked exceptions, result types), and that argument is not worth having inside one codebase; follow the language's mainstream. What matters is consistency and a clear line between expected failures, which callers handle, and bugs, which should stop the program.

## Quality axes

- **reliability** ⊕ (primary): Expected failures are handled at a stated layer and bugs stop the program, instead of errors being swallowed or a library panicking on caller input.
- **change_cost** +: Callers and new contributors know how every module fails, so they don't have to guess between null, error codes and exceptions.
- **operability** +: Each failure is logged once at a known layer and reaches users as one consistent shape of message, status or exit code.
- **delivery** −: The policy has to be decided, written down and applied, with conversions at its boundaries.

**Flips:** In a short script or prototype it is overhead, and crashing with a stack trace is fine. Forcing a mechanism against the language's mainstream, or creating an error type per function, turns change_cost "-".

## Warranted when

- More than one person or agent writes error handling, and each brings a habit from another language.
- The code is a library, so callers need to be able to recover and it must not decide for them.
- The code has a user-facing boundary (CLI, HTTP, UI) where errors must become one consistent shape.
- The language offers more than one mechanism (Rust Result and panic, Go error and panic, C# exceptions and Try methods).

## How it shows

- Some modules throw, some return null, some return error codes, and callers guess which.
- Library code that panics, calls unwrap or expect on input it didn't produce, or calls exit.
- The same failure logged at several layers, or at none.
- Error types that are strings, so callers match on message text.
- No stated place where errors become user-facing messages, HTTP responses or exit codes.

## Overdone when

- A custom error type for every function, so the hierarchy is bigger than the code it describes.
- Forcing Result-style returns onto a language and ecosystem built on exceptions, with conversion at every boundary.
- A policy document nobody can apply because it doesn't say where the boundaries are.

## Example

Before:

```
# shipping-rates library
fn quote(parcel: Parcel, zone: str) -> Money:
    table = RATE_TABLES.get(zone)
    if table is None:
        print("unknown zone " + zone)
        exit(1)
    return table.price_for(parcel.weight)
```

After:

```
# shipping-rates library
class UnknownZone(RatesError):
    zone: str

fn quote(parcel: Parcel, zone: str) -> Money:
    table = RATE_TABLES.get(zone)
    if table is None:
        raise UnknownZone(zone)
    return table.price_for(parcel.weight)

# the application's boundary decides: a 422 for the API, an exit code for the CLI
```

The library reports an expected failure in its own error type and leaves the decision to abort to the application.

## One-file tell

Rust: `.unwrap()` or `.expect(` in a library crate's non-test source. Go: `panic(`, `log.Fatal` or `os.Exit(` outside package main and tests.

## By language

**go:** Errors are values returned last. Wrap with fmt.Errorf and %w, and test with errors.Is and errors.As rather than comparing strings. Panic is for programmer errors and impossible states; a library should not let a panic cross its API, and should not call log.Fatal or os.Exit.

**rust:** Result for recoverable errors, panic for bugs. Libraries usually define an error enum (often with thiserror) and avoid unwrap and expect on anything callers control; applications often use anyhow for context. Document panics in a Panics section. The ? operator is the normal way to propagate.

**java:** Checked exceptions for conditions callers are expected to recover from was the original intent, but the community largely moved to unchecked exceptions, and lambdas and streams don't play well with checked ones. Choose and say which. Never let a library throw raw Exception.

**csharp:** Exceptions are the mechanism, with no checked exceptions. The Try pattern (bool TryX(out result)) covers the expected-failure case. Prefer the framework's exception types (ArgumentException, InvalidOperationException) and throw; rather than throw ex, which resets the stack trace.

**python:** Exceptions everywhere, with a small hierarchy rooted in one package-level base exception so callers can catch everything from the library at once. Use raise ... from err to keep the cause.

**typescript:** Anything can be thrown, and the type system doesn't track it. Some codebases return discriminated unions for expected failures and throw only for bugs; pick one per layer. Always throw Error subclasses so stack traces exist.

## Related

[Fail Fast](fail-fast.md) · [Swallowed Errors](swallowed-errors.md) · [Exceptions for Control Flow](exceptions-for-control-flow.md) · [Inconsistent Error Contract](inconsistent-error-contract.md) · [Fail Open vs Fail Closed](fail-open-vs-fail-closed.md)

## Overlaps

Start from error-handling-policy, which decides how errors travel in this codebase. swallowed-errors and exceptions-for-control-flow are the two common ways code breaks that policy.

## Sources

- [Joe Duffy, The Error Model (2016)](https://joeduffyblog.com/2016/02/07/the-error-model/) (recalled)
- [Rob Pike, Errors are values, The Go Blog (2015)](https://go.dev/blog/errors-are-values) (recalled)
- [The Rust Programming Language, ch. 9, To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) (recalled)
- [Rust API Guidelines, C-GOOD-ERR and C-FAILURE](https://rust-lang.github.io/api-guidelines/) (recalled)
