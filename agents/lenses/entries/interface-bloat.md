<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Interface bloat (bloated interface)

`interface-bloat` · anti-patterns, design

An interface carries so many methods that every client depends on far more than it uses and every implementer must fill in methods it has no use for. The interface segregation principle is the counter-ideal.

*Names:* Also called Swiss army knife, kitchen sink or fat interface (Brown et al.).

*Matters most for:* library-sdk, plugins-extensions, plugin-host

## But

A wide interface is fine when clients really do use most of it, as with a collection or a file handle. In languages with structural typing, such as Go and TypeScript, clients can declare the small interface they need themselves, which makes the wide one less harmful. Splitting too far scatters one concept across many tiny types. Some domains really are wide, and a facade can be wide on purpose: what matters is whether each client depends only on what it uses.

## Quality axes

- **delivery** +: Adding a method to the existing interface is the smallest change when a new caller needs something.
- **change_cost** −: Every implementer and test double must fill in methods it doesn't use, and a change to any method touches clients that never call it.

## Why people fall into it

- One interface per concept feels tidy, so every operation on that concept goes into it.
- Adding a method to the existing interface is the smallest change when a new caller needs something.

## How it shows

- an interface with a dozen or more methods that most implementations stub out, leave empty or make throw "not supported"
- test doubles that must implement many methods to exercise one
- clients that each call a small, different slice of the same interface
- methods with long lists of optional parameters and mode flags

## Overcorrecting looks like

- One-method interfaces for everything, so a single service needs five interfaces and the wiring outweighs the code.
- Splitting an interface whose methods are always used together.

## What to do

Extract Interface per client role (role interfaces), and have the class implement the ones it supports.

## Example

Before:

```
interface MediaStore:
    fn read(id) -> Bytes
    fn write(id, data: Bytes)
    fn delete(id)
    fn transcode(id, format)
    fn generate_thumbnail(id)
    fn set_retention(id, days)
    fn usage_report() -> Report

class ReadOnlyMirror implements MediaStore:
    fn read(id) -> Bytes: ...
    fn write(id, data): raise NotSupported
    ...
```

After:

```
interface MediaReader:
    fn read(id) -> Bytes

interface MediaWriter:
    fn write(id, data: Bytes)
    fn delete(id)

interface MediaProcessing:
    fn transcode(id, format)
    fn generate_thumbnail(id)

class ReadOnlyMirror implements MediaReader:
    fn read(id) -> Bytes: ...
```

Each client depends on the role it uses, and the mirror no longer has to fake writes.

## By language

**go:** Go's convention is small interfaces (io.Reader has one method), declared in the package that uses them rather than the one that implements them; a large interface exported next to its only implementation is a sign of this.

## Related

[SOLID](solid.md) · [Refused Bequest](refused-bequest.md) · [God object (The Blob)](god-object.md) · [Speculative Generality](speculative-generality.md) · [Long Parameter List](long-parameter-list.md) · [YAGNI](yagni.md)

## Overlaps

god-object is the design failure (one class owns too much of the control), large-class the visible symptom, and interface-bloat the failure seen from the clients that depend on it.

## Sources

- Martin, Agile Software Development: Principles, Patterns, and Practices (2002), The Interface Segregation Principle (recalled)
- [Wikipedia, List of software anti-patterns: Interface bloat](https://en.wikipedia.org/wiki/List_of_software_anti-patterns) (read)
- Brown, Malveau, McCormick & Mowbray, AntiPatterns (1998): Swiss Army Knife (recalled)
