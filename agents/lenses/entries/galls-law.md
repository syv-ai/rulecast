<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Gall's Law

`galls-law` · laws, architecture

Complex systems that work grew out of simple systems that worked; designing one from scratch rarely does.

*Matters most for:* distributed, platforms, plugins-extensions

## But

Some constraints are hard to retrofit: security, data models, regulatory requirements and public API shapes can be very costly to change later, so some upfront design pays off. The "monolith first" advice it is often tied to (Fowler) has critics too, such as Stefan Tilkov, who argues that splitting a grown monolith is harder than starting with clear service boundaries.

## Quality axes

*Bears on:* delivery, reliability. A complex system designed whole rarely works, so big-bang designs ship late and broken, while one grown from a working simple version keeps working at each step.

## How it shows

- a young repository with many services, plugin points or layers but little working functionality
- framework or infrastructure code that has no callers yet

## What to do

Build a simple version that works end to end, then grow it in small steps that each still work.

## Related

[KISS (Keep It Simple, Stupid)](kiss.md) · [YAGNI](yagni.md) · [Second-System Effect](second-system-effect.md)

## Sources

- [Milanović, Laws of Software Engineering, Gall's Law](https://lawsofsoftwareengineering.com/laws/galls-law/) (read)
