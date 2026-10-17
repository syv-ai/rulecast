<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Kernighan's Law

`kernighans-law` · laws, quality

Debugging is twice as hard as writing code, so code written as cleverly as you can manage is code you can't debug.

## But

"Twice as hard" is a quip, not a measured ratio. Some idioms that look clever to a newcomer are ordinary and clear to people fluent in the language, and hot paths sometimes need tricky code that is worth it when it's tested and explained.

## Quality axes

*Bears on:* change_cost, reliability. Code written at the limit of the author's cleverness is harder to debug than to write, so its bugs last longer and every change to it is riskier.

## How it shows

- dense one-liners that chain many operations or nest conditional expressions
- clever bit tricks or metaprogramming where plain code would do

## What to do

Write the plain, readable version, and keep cleverness for proven hot paths with a comment explaining it.

## Example

Before:

```
fn parking_fee(minutes: int, is_resident: bool) -> int:
    return (0 if minutes < 15
            else (200 if is_resident else 400) if minutes < 120
            else floor(minutes / 60) * (100 if is_resident else 250))
```

After:

```
fn parking_fee(minutes: int, is_resident: bool) -> int:
    if minutes < 15:
        return 0
    if minutes < 120:
        if is_resident:
            return 200
        return 400
    hourly = 250
    if is_resident:
        hourly = 100
    return floor(minutes / 60) * hourly
```

The nested conditional expression becomes plain branches, each of which you can read, step through and set a breakpoint on.

## One-file tell

Nested ternary or conditional expressions.

## Related

[KISS (Keep It Simple, Stupid)](kiss.md)

## Sources

- [Milanović, Laws of Software Engineering, Kernighan's Law](https://lawsofsoftwareengineering.com/laws/kernighans-law/) (read)
