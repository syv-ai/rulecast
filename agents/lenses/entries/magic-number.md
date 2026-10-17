<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Magic number

`magic-number` · anti-patterns, code

A literal with an important meaning sits in the code with nothing saying what it is, where a named constant should stand.

*Matters most for:* embedded, scientific, games, ml-training

## But

Well-known values such as 0, 1, -1, 2 for halving, or 100 for percent are clear on sight. So are literals in tests, where the concrete value is the point, and values whose meaning the surrounding name already gives (timeout_seconds = 30). A constant named after its value instead of its meaning (THIRTY) is no better than the literal. Lint rules for it are known for noise, so most teams configure an allowlist.

## Quality axes

- **change_cost** −: A reader can't tell what the literal means, and changing the value means finding every unexplained copy of it.

## Why people fall into it

- The value is obvious to the person writing it at that moment.
- Naming a constant means deciding where it lives, which feels like overhead for one use.

## How it shows

- numeric or string literals inside conditions and arithmetic, such as a timeout, a limit or a status code
- the same unexplained literal repeated in several files
- a comment next to a literal explaining what it means, instead of a name

## Overcorrecting looks like

- Naming 0, 1, 2 or 100 percent (ZERO, ONE, HUNDRED), which adds a lookup and no meaning.
- Pulling every literal into a far-away constants file, so the reader has to jump to learn a value used in one place.

## What to do

Replace Magic Number with Symbolic Constant, named for what the value means, kept near where it is used.

## Example

Before:

```
fn parking_fee(entered: Time, left: Time) -> Money:
    minutes = (left - entered).minutes
    if minutes <= 20:
        return Money(0)
    hours = ceil(minutes / 60)
    return Money(min(hours * 350, 2400))
```

After:

```
FREE_STAY_MINUTES = 20
HOURLY_RATE_CENTS = 350
DAILY_CAP_CENTS = 2400

fn parking_fee(entered: Time, left: Time) -> Money:
    minutes = (left - entered).minutes
    if minutes <= FREE_STAY_MINUTES:
        return Money(0)
    hours = ceil(minutes / 60)
    return Money(min(hours * HOURLY_RATE_CENTS, DAILY_CAP_CENTS))
```

The business values get names; 60 minutes per hour stays a literal because everyone knows it.

## One-file tell

A numeric literal other than 0, 1 or -1 in a comparison, arithmetic, a default argument or a query limit, outside a constant declaration or a test file. Unit factors (60, 24, 1024) only beside a name that says the unit.

## Related

[Primitive Obsession](primitive-obsession.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Sources

- [Wikipedia, Anti-pattern, In software engineering](https://en.wikipedia.org/wiki/Anti-pattern) (read)
- McConnell, Code Complete (2nd ed.), Numbers in general (recalled)
