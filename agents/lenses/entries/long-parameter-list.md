<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Long Parameter List

`long-parameter-list` · smells, code · **agents do this**

A function takes so many parameters that calls are hard to read and easy to get wrong.

*Matters most for:* scientific, ml-training, library-sdk

## But

Explicit parameters make dependencies visible, which is often better than reaching for global state or a big context object. Pure functions and constructors used for dependency injection often have many parameters on purpose. Languages with keyword arguments make long lists much less error-prone. Don't remove a parameter if it means creating a dependency the function didn't have.

## Quality axes

- **delivery** +: Adding one more parameter is the smallest change that makes the new case work.
- **change_cost** −: Calls are hard to read, and each new case adds another parameter or flag to every call site.
- **reliability** −: Positional arguments of the same type are easily passed in the wrong order with no error.

**Flips:** Pure functions and dependency-injected constructors take many explicit parameters on purpose, which beats hidden globals; keyword arguments remove most of the risk.

## Why people fall into it

- Several algorithms were merged into one function, with flags to choose between them.
- Dependencies were moved out to be passed in, one parameter at a time.
- Adding a parameter is the smallest change that makes the new case work.

## How it shows

- Signatures with more than four or five parameters.
- Boolean flag parameters that switch which path the function takes.
- Call sites passing several values pulled from the same object.
- Positional calls full of literals where nobody can tell which is which.

## Overcorrecting looks like

- Wrapping unrelated parameters in an options object just to shorten the signature, which hides what the function needs.
- Passing a whole object to avoid a parameter, coupling a low-level function to a high-level type.

## What to do

Replace Parameter with Method Call (Replace Parameter with Query) when the function can get a value itself, Preserve Whole Object when several values come from one object, and Introduce Parameter Object for values that belong together. Split flag-driven functions with Remove Flag Argument (Replace Parameter with Explicit Methods).

## Example

Before:

```
fn render_chart(series, title: str, width: int, height: int,
                show_legend: bool, log_scale: bool, dark: bool,
                x_label: str, y_label: str): ...

render_chart(data, "Latency", 800, 400, True, False, True, "time", "ms")
```

After:

```
class ChartSize:
    width: int
    height: int

class Axes:
    x_label: str
    y_label: str
    log_scale: bool

class Style:
    theme: Theme
    show_legend: bool

fn render_chart(series, title: str, size: ChartSize, axes: Axes, style: Style): ...
render_chart(data, "Latency", ChartSize(800, 400), Axes("time", "ms", False), Style(DARK, True))
```

Values that travel together became small types, and the call no longer depends on remembering positions.

## One-file tell

A function with more than five parameters, or with two or more boolean parameters, not counting constructors that take their dependencies. In Python, count only positional parameters that have no default and come before any * or *args, not self or cls.

## By language

**python:** Keyword-only parameters (after a bare star) take most of the readability cost away, but a long list of them still says the function does too much.

## Related

[Data Clumps](data-clumps.md) · [Primitive Obsession](primitive-obsession.md) · [Builder](builder.md)

## Sources

- [Refactoring.Guru, Long Parameter List](https://refactoring.guru/smells/long-parameter-list) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
