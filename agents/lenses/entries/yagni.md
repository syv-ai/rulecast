<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# YAGNI

`yagni` · principles, design

Don't build features, options or abstractions until something actually needs them. Short for "You Aren't Gonna Need It".

*Matters most for:* library-sdk, plugins-extensions

## But

It assumes change is cheap later, which holds only with good tests and refactoring room. Decisions that are costly to reverse, such as public APIs, data formats and schemas, security and internationalisation, deserve forethought. Fowler notes YAGNI covers presumptive features, not the work of keeping code easy to change.

## Quality axes

- **delivery** ⊕ (primary): No time spent building features, options or abstractions that nothing needs yet.
- **change_cost** +: Less speculative code and fewer unused flags to read, keep working and work around.

**Flips:** For decisions that are expensive to reverse (public APIs, data formats, schemas, security), deferring forethought turns change_cost "-". Without tests and room to refactor, adding the thing later costs more.

## How it shows

- configuration flags, parameters or extension hooks that nothing sets or calls
- an interface or base class with a single implementation and no test double
- generic helpers with options used by exactly one caller

## What to do

Build the simplest thing for today's requirement and refactor when the second real need arrives.

## Example

Before:

```
fn next_invoice_number(prefix: str = "INV", width: int = 6,
                       separator: str = "-", reset_yearly: bool = False,
                       formatter: fn | None = None) -> str:
    n = counter.increment("invoice")
    if formatter is not None:
        return formatter(n)
    ...
    return prefix + separator + pad(n, width)

# the only call
next_invoice_number()
```

After:

```
fn next_invoice_number() -> str:
    n = counter.increment("invoice")
    return "INV-" + pad(n, 6)

# the only call
next_invoice_number()
```

Options nobody passes come out; the one format in use is written directly and can grow a parameter when a second real need arrives.

## Related

[Occam's Razor](occams-razor.md) · [Second-System Effect](second-system-effect.md) · [Premature Optimization](premature-optimization.md) · [SOLID](solid.md)

## Overlaps

yagni is the principle. speculative-generality is the symptom inside a class or module (hooks, parameters and abstractions nothing uses), and over-engineering is the same thing at system scale.

## Sources

- [Milanović, Laws of Software Engineering, YAGNI (You Aren't Gonna Need It)](https://lawsofsoftwareengineering.com/laws/yagni/) (read)
