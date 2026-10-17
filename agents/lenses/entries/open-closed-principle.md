<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Open/Closed Principle (OCP)

`open-closed-principle` · principles, design · **contested**

Code that others build on should be open to extension and closed to modification. Adding a new case (a payment method, a file format, an output) should mean adding code at an extension point, not editing the code that already works.

*Names:* Bertrand Meyer, Object-Oriented Software Construction (1988), where extension meant inheritance; Robert C. Martin recast it in 1996 around abstractions and polymorphism. The O in SOLID.

*Matters most for:* plugin-host, library-sdk, compilers-tooling

## But

You can only be closed against the changes you predicted, and guessing wrong leaves abstractions that resist the change that does come. YAGNI argues for adding the extension point when the second case arrives, not before. In code you own end to end, editing a switch in one place is often simpler and safer than an abstraction; and with closed sum types and exhaustive matching, adding a case is meant to touch every match, which the compiler then checks.

## Quality axes

- **change_cost** ⊕ (primary): A new plugin, format or provider is added at an extension point without editing, and risking, code that already works.
- **delivery** −: Extension points, registries or strategy interfaces have to be designed before the second case arrives.

**Flips:** When the predicted variation never comes, or the wrong axis was guessed, the abstraction resists the change that does come (speculative generality) and change_cost turns "-". In code you own end to end, one switch is often simpler.

## Warranted when

- New variants arrive often and from different people (plugins, integrations, formats).
- Code that must not change lightly, such as published libraries, a plugin host or code under heavy test.
- Regressions in old cases every time a new one is added.

## How it shows

- The same switch or if-chain over a type code repeated in several places, each edited for every new case.
- A core module edited every time a plugin, format or provider is added.
- Shared library code with flags added for one caller's special case.

## Overdone when

- Extension points built for variation that never comes, which is speculative generality.
- Strategy objects and registries where one switch in one place would be clearer.

## Example

Before:

```
fn export(report, format):
    if format == "csv": return to_csv(report)
    elif format == "pdf": return to_pdf(report)
    elif format == "xlsx": return to_xlsx(report)    # edited for every new format
    else: raise UnknownFormat(format)
```

After:

```
EXPORTERS = {}
fn exporter(format):
    fn register(fn): EXPORTERS[format] = fn; return fn
    return register

@exporter("csv")
fn to_csv(report): ...

fn export(report, format): return EXPORTERS[format](report)
```

A new format is a new function in its own module; export and the existing formats stay untouched.

## By language

**python:** Registries of functions keyed by name, entry points for plugins, and functools.singledispatch are the lightweight extension points; class hierarchies are rarely needed.

**typescript:** A discriminated union with exhaustive switches is deliberately not closed to modification; use it for variants you own and an interface or registry for ones others add.

**java:** Interfaces with ServiceLoader or dependency-injection lookup are the usual extension points; sealed interfaces are the deliberate opposite.

**rust:** Traits are the extension point for others; enums with exhaustive match are for closed sets you own.

**go:** Small interfaces plus registration functions (as database/sql drivers do) give extension without editing the core.

## Related

[SOLID](solid.md) · [Switch Statements](switch-statements.md) · [Speculative Generality](speculative-generality.md) · [Strategy](strategy.md) · [Microkernel (plugin architecture)](microkernel.md) · [YAGNI](yagni.md)

## Overlaps

switch-statements is the smell, and state and strategy are the two usual remedies: state when the switch is on an object's lifecycle, strategy when it chooses an algorithm. Exhaustive matching on a closed set is often better than either. open-closed-principle says when the switch is worth replacing at all: when others add cases, not when you own every one.

## Sources

- [Bertrand Meyer, Object-Oriented Software Construction (1988)](https://bertrandmeyer.com/OOSC2/) (recalled)
- [Robert C. Martin, The Open-Closed Principle, C++ Report (1996)](https://web.archive.org/web/20060822033314/http://www.objectmentor.com/resources/articles/ocp.pdf) (recalled)
