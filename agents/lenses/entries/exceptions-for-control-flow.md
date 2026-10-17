<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Exceptions for Control Flow

`exceptions-for-control-flow` · anti-patterns, code

Throwing and catching exceptions to steer ordinary, expected logic, such as ending a loop, returning a found value or choosing a branch, instead of using a return value or a condition.

*Names:* Also called Exceptions as goto, Using exceptions for flow control. Discussed by name on Ward Cunningham's wiki (DontUseExceptionsForFlowControl). Bloch's Effective Java states the rule as using exceptions only for exceptional conditions.

*Matters most for:* library-sdk, games

## But

In Python this is idiomatic and cheap: EAFP style, StopIteration ending every for loop, and KeyError handling are normal, so don't apply the rule there the way you would in Java or C#. Some parsers and interpreters use an exception on purpose to unwind a deep recursion, and that's a fair trade when it is local and documented. What counts as "exceptional" is a judgment call, which is why practitioners disagree on the line.

## Quality axes

- **delivery** +: Throwing is a handy way out of deep nesting without threading a return value through each call.
- **change_cost** −: Ordinary logic jumps invisibly across frames, so following a branch means finding where it is caught.
- **runtime** −: Building exceptions and capturing stack traces on a common path is costly in languages like Java and C#.

**Flips:** In Python, EAFP and StopIteration make it idiomatic and cheap; a parser unwinding a deep recursion with one local, documented exception is a fair trade.

## Why people fall into it

- Exceptions are a handy way to jump out of deeply nested calls without threading a return value through each one.
- The language or framework lacks a result type, and null felt worse.
- The library only offers a throwing API, such as a parse function with no try-parse variant.
- Python's own idioms (EAFP, StopIteration) make it look like the general rule everywhere.

## How it shows

- A custom exception named like a result (FoundIt, Done, StopProcessing) thrown deep and caught one or two frames up.
- A loop that runs until an index or iterator throws, then catches the error to finish.
- Validation that throws on the common case (most inputs are invalid) and callers that catch it as a branch.
- try/catch around a lookup where a contains or get-with-default call exists.
- Profiles where exception construction and stack capture show up on a hot path.

## Overcorrecting looks like

- Replacing real failures with sentinel return values that callers forget to check, which turns into Swallowed Errors.
- Hand-rolling result types in a language whose ecosystem is built on exceptions, so every boundary has to convert.

## What to do

Return the outcome: a boolean, an optional, a result or a small tagged value, and test it with a plain condition. Use the try-parse or get-with-default form of the API where one exists. Keep exceptions for what the caller can't reasonably expect to happen in normal use.

## Example

Before:

```
class SeatFound(Exception):
    seat: Seat

fn find_free_seat(hall: Hall) -> Seat:
    try:
        for row in hall.rows:
            for seat in row.seats:
                if seat.is_free():
                    raise SeatFound(seat)
    except SeatFound as found:
        return found.seat
    raise HallFull(hall.id)
```

After:

```
fn find_free_seat(hall: Hall) -> Seat or None:
    for row in hall.rows:
        for seat in row.seats:
            if seat.is_free():
                return seat
    return None

seat = find_free_seat(hall)
if seat is None:
    offer_waitlist(hall)
```

Finding a seat is the normal outcome and a full hall is an expected one, so both come back as values the caller branches on.

## By language

**python:** EAFP (try first, handle the error) is the documented house style, and exceptions are comparatively cheap. Flag it only when the exception crosses module boundaries as a hidden return path.

**java:** Exceptions are expensive mostly because of stack capture; Bloch's advice is to avoid them on the normal path. An exception can disable stack traces for a control-flow use, but that is a smell of its own.

**csharp:** The framework offers TryParse and TryGetValue precisely to avoid this; prefer them. First-chance exceptions on a hot path show up clearly in profilers. In ASP.NET Core, throwing domain exceptions (NotFound, Validation) from services and mapping them to problem-details responses in one IExceptionHandler or middleware is a common style, but Microsoft's ASP.NET Core best-practices guidance says exceptions shouldn't drive normal flow, and the result-type camp agrees. Treat it as the project's choice, ask which one it uses, and keep exceptions out of expected, frequent outcomes such as routine validation failures on a hot endpoint.

**typescript:** No checked exceptions and no result type in the standard library, so a discriminated union return is the usual alternative.

**go:** Rare, because errors are values. The equivalent is panic and recover used as a non-local return; the standard library does it inside a few parsers but never lets the panic leave the package.

**rust:** Rare for the same reason. Using panic with catch_unwind for flow is wrong, and catch_unwind does not catch panics in builds that abort on panic.

## Related

[Error Handling Policy](error-handling-policy.md) · [Swallowed Errors](swallowed-errors.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Overlaps

Start from error-handling-policy, which decides how errors travel in this codebase. swallowed-errors and exceptions-for-control-flow are the two common ways code breaks that policy.

## Sources

- [Joshua Bloch, Effective Java (3rd ed.), item 69, Use exceptions only for exceptional conditions](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/) (recalled)
- [Ward Cunningham's wiki, DontUseExceptionsForFlowControl](https://wiki.c2.com/?DontUseExceptionsForFlowControl) (recalled)
- [Python glossary, EAFP](https://docs.python.org/3/glossary.html#term-EAFP) (recalled)
