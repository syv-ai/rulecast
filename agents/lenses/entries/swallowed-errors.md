<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Swallowed Errors

`swallowed-errors` · anti-patterns, code · **agents do this**

An error is caught or returned and then dropped, so the failure goes on silently and shows up later, somewhere else, as wrong data or a confusing symptom.

*Names:* Also called Exception swallowing, Catch and ignore, Silent failure, Ignored errors. A folk name with no single coiner. Bloch made the rule explicit in Effective Java ("don't ignore exceptions"), and Hunt and Thomas argued the other side of it as "crash early" in The Pragmatic Programmer. Go's errcheck linter gave the Go form its everyday name.

*Matters most for:* data-pipeline, cli-devtool, web-api, library-sdk, distributed, plugin-host

## But

Some errors really are safe to ignore: a failed close on a read-only file, a best-effort cache write, removing a temp file that's already gone, telemetry that must never break the host. Ignoring those is fine when it is narrow and visible in the code. A tool that must never block its host may catch broadly at the outermost boundary on purpose; that's a fail-open decision, not swallowing, as long as the error is still reported somewhere.

## Quality axes

- **delivery** +: Catching an error where it surfaces is the quickest way to make it go away.
- **reliability** −: Failures carry on silently and turn up later as wrong data, far from their cause.
- **operability** −: Nothing is logged at the moment it went wrong, so incidents are investigated backwards from symptoms.

**Flips:** Ignoring a narrow, expected error (a best-effort cache write, telemetry, a temp file already gone) is right when it is visible in the code, as is a fail-open outer boundary in a tool that must never block its host, provided the error is still reported.

## Why people fall into it

- The task was to make an error go away, and the quickest way to stop seeing it is to catch it where it surfaces.
- Checked exceptions or Go's error returns make every call site handle something, and an empty handler satisfies the compiler.
- A misreading of resilience as "never crash".
- Not knowing what the right handling is, so nothing is done and the decision is deferred forever.
- A noisy dependency that throws on harmless cases, so all its errors get muted.

## How it shows

- Empty catch or except blocks, or ones holding only a comment like "should never happen".
- Catching the broadest type (Exception, Throwable, bare except, catch-all) and returning a default such as null, an empty list or false.
- Go code that discards an error with `_ =` or `x, _ :=` on a call that can fail.
- A log line at debug level and then carrying on as if the call had worked.
- Promises with no rejection handler, or a .catch that does nothing.
- Bugs reported far from their cause, with nothing in the logs at the moment it went wrong.

## Overcorrecting looks like

- Letting every error crash the process, including ones the code can genuinely recover from, such as a cache miss or an optional file.
- Wrapping and rethrowing at every layer, so stack traces carry ten copies of the same message.
- Logging an error and rethrowing it at each level, so one failure produces a page of duplicate log lines.

## What to do

Catch only the types the code can act on, and handle them there: retry, fall back with a stated reason, or translate into the caller's terms with the original attached as the cause. Let everything else propagate to one boundary that logs it once and decides the outcome. Where ignoring is really right, say so in the code with the specific error and a reason.

## Example

Before:

```
fn import_readings(path: str) -> list:
    readings = []
    for line in read_lines(path):
        try:
            readings.append(parse_reading(line))
        except Exception:
            pass
    return readings
# a corrupt export imports 3 of 9,000 rows and reports success
```

After:

```
fn import_readings(path: str) -> list:
    readings = []
    rejected = []
    for number, line in enumerate(read_lines(path)):
        try:
            readings.append(parse_reading(line))
        except MalformedReading as e:
            rejected.append((number, e.reason))
    if len(rejected) > MAX_REJECTED:
        raise ImportFailed(path, rejected)
    log.warning("skipped rows", rejected)
    return readings
```

Only the expected error is caught, every rejection is counted and reported, and too many of them stops the import instead of passing silently.

## One-file tell

Python only, outside test files: an except clause (bare, Exception or BaseException) whose only body is pass or '...'.

## By language

**python:** Bare except also catches KeyboardInterrupt and SystemExit. Catch Exception at most, and prefer the specific type. contextlib.suppress(SpecificError) is the readable way to ignore one error on purpose.

**typescript:** An unhandled promise rejection is swallowing by default in many runtimes and setups. The caught value is unknown and may not be an Error at all, so check before reading .message. Floating promises are flagged by typescript-eslint's no-floating-promises.

**java:** Checked exceptions push people into empty catch blocks to make code compile. Wrap in an unchecked exception with the cause instead. Catching InterruptedException and dropping it also loses the interrupt; restore it with Thread.currentThread().interrupt().

**csharp:** A catch-all is often wrapped around async void event handlers. An exception thrown inside a fire-and-forget Task is lost unless something observes it. Use exception filters (catch ... when) to narrow a catch.

**go:** Errors are values, so swallowing is just not looking at one. errcheck and staticcheck flag discarded errors. A deferred Close whose error is dropped can lose a write failure on files opened for writing.

**rust:** Discarding a Result is warned about (must_use), so the common forms are `let _ = ...`, `.ok()` and `unwrap_or_default()` on errors that mattered.

## Related

[Fail Fast](fail-fast.md) · [Error Handling Policy](error-handling-policy.md) · [Fail Open vs Fail Closed](fail-open-vs-fail-closed.md) · [Exceptions for Control Flow](exceptions-for-control-flow.md) · [Murphy's Law](murphys-law.md)

## Overlaps

Start from error-handling-policy, which decides how errors travel in this codebase. swallowed-errors and exceptions-for-control-flow are the two common ways code breaks that policy.

## Sources

- [Joshua Bloch, Effective Java (3rd ed.), item 77, Don't ignore exceptions](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/) (recalled)
- [Andrew Hunt and David Thomas, The Pragmatic Programmer, Dead Programs Tell No Lies](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) (recalled)
- [kisielk/errcheck, Go linter for unchecked errors](https://github.com/kisielk/errcheck) (recalled)
