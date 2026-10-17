<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Copy-and-paste programming

`copy-and-paste-programming` · anti-patterns, code · **agents do this**

Code is reused by copying it and tweaking the copy, so the same logic lives in several places and a fix in one misses the others. Brown et al. call it Cut-and-Paste Programming; Duplicate Code is the smell.

*Matters most for:* iac, data-pipeline, ml-training, web-frontend

## But

Duplication is cheaper than the wrong abstraction (Sandi Metz). The rule of three (Don Roberts, via Fowler) says wait for a third copy before extracting. Copies that will diverge, such as tests or code in separate services that must deploy independently, are often better left apart.

## Quality axes

- **delivery** +: Copying working code and tweaking it is the fastest way to get the next case working.
- **change_cost** −: Every change to the shared logic has to be made in each copy.
- **reliability** −: A fix applied to one copy misses the others, so the bug lives on elsewhere.

**Flips:** Copies that are meant to diverge, such as tests or code in independently deployed services, are often better left apart than merged into a wrong abstraction.

## Why people fall into it

- Copying working code is the fastest way to get the next case working.
- Changing shared code feels riskier than writing a separate copy.
- Not knowing the existing helper is there.

## How it shows

- near-identical blocks in several files that differ in a name or a constant
- bug-fix commits that touch the same lines in several places, or fix one copy and miss another
- new code that re-implements a helper the codebase already has

## Overcorrecting looks like

- Merging code that merely looks alike but answers to different rules, producing the wrong abstraction.

## What to do

Extract Method or Extract Class for the shared knowledge, and call it from each place.

## Example

Before:

```
fn room_total(booking: Booking) -> Money:
    net = booking.nights * booking.rate
    vat = net * 0.25 if booking.country == "DK" else net * 0.2
    return net + vat

fn extras_total(booking: Booking) -> Money:
    net = sum_prices(booking.extras)
    vat = net * 0.25 if booking.country == "DK" else net * 0.2
    return net + vat
```

After:

```
fn vat_rate(country: str) -> float:
    return 0.25 if country == "DK" else 0.2

fn with_vat(net: Money, country: str) -> Money:
    return net + net * vat_rate(country)

fn room_total(booking: Booking) -> Money:
    return with_vat(booking.nights * booking.rate, booking.country)

fn extras_total(booking: Booking) -> Money:
    return with_vat(sum_prices(booking.extras), booking.country)
```

The VAT rule lives once, so a rate change can't be applied to rooms and forgotten for extras.

## One-file tell

All languages: five or more consecutive identical non-trivial lines that occur twice in one file. It leaves out tests (including Rust #[cfg(test)] modules and Go integration test directories), generated files (generated/ paths, .gen. and .generated. names, 'DO NOT EDIT' or 'auto-generated' headers) and migrations, and blocks that are only parameter lists, function signatures or declarative schema or config literals (sa.Column/Index lists, zod objects, service-definition structs).

## Related

[DRY (Don't Repeat Yourself)](dry.md) · [Duplicate Code](duplicate-code.md) · [Shotgun Surgery](shotgun-surgery.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md) · [Reinventing the wheel](reinventing-the-wheel.md)

## Overlaps

Start from dry: it says what counts, duplicated knowledge rather than duplicated text. duplicate-code is how it shows in code, copy-and-paste-programming is the habit that produces it, and wrong-abstraction is what an eager merge of copies that only look alike produces.

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Cut-and-Paste Programming (recalled)
