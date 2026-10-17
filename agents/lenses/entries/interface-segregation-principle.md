<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Interface Segregation Principle (ISP)

`interface-segregation-principle` · principles, design

No client should depend on methods it doesn't use. Shape interfaces around what each caller needs, so a change to one capability doesn't ripple into code that never touched it, and an implementation never has to fake the parts it can't do.

*Names:* Robert C. Martin (1996), from consulting work where one large job interface forced every client to recompile. The I in SOLID.

*Matters most for:* library-sdk, plugin-host

## But

In structurally typed and duck-typed languages a caller can depend on a narrow shape without anyone declaring it, so the principle costs nothing and needs no ceremony. In nominal languages, splitting interfaces adds names and wiring; a wide interface that every caller really uses whole is fine. The principle is about callers' needs, not interface size.

## Quality axes

- **change_cost** ⊕ (primary): A change to one capability doesn't ripple into callers that never used it, and test doubles only implement what the code under test calls.
- **delivery** −: In nominal languages, splitting interfaces means more names to declare and wire up.

**Flips:** One single-method interface per call site, or interfaces for types with one implementation and one caller, scatters the contract so nobody can find it, and change_cost turns "-".

## Warranted when

- Several kinds of caller using different slices of one wide type.
- Implementations that can't support every capability (read-only stores, partial backends).
- Mocks and fakes that are tedious to write.

## How it shows

- Implementations that stub out half an interface with empty bodies or not-supported errors.
- Test doubles that must implement a dozen methods to test code that calls one.
- Functions that take a whole service or client but use one method of it.

## Overdone when

- One single-method interface per call site, so the contract is scattered across dozens of types nobody can find.
- Interfaces for types that have exactly one implementation and one caller.

## Example

Before:

```
interface Storage:
    fn read(key) -> bytes
    fn write(key, data)
    fn delete(key)
    fn list(prefix) -> [str]

fn render_page(store: Storage, key):      # only ever reads
    return template(store.read(key))
```

After:

```
interface Reader:
    fn read(key) -> bytes

fn render_page(store: Reader, key):
    return template(store.read(key))
```

render_page can now be given a read-only cache or a two-line fake, and changes to write or delete never reach it.

## By language

**python:** typing.Protocol lets the consumer declare just the methods it calls; prefer that to a wide abstract base class.

**typescript:** Structural types mean a parameter type can list only what the function uses, often with Pick from a larger type.

**java:** Role interfaces implemented together by one class are the usual answer; default methods can hide a wide interface's cost but not its coupling.

**csharp:** As in Java; IReadOnlyList and IReadOnlyDictionary are the standard library's own read-only slices.

**go:** Define the interface where it is used, with the one or two methods needed (io.Reader, io.Writer); the standard library is built this way.

## Related

[SOLID](solid.md) · [Interface bloat (bloated interface)](interface-bloat.md) · [Liskov Substitution Principle (LSP)](liskov-substitution-principle.md) · [Refused Bequest](refused-bequest.md) · [Mocking Everything (over-mocking)](mock-everything.md)

## Overlaps

interface-segregation-principle is the principle seen from the caller (depend only on what you use); interface-bloat is the type that broke it. Start from the principle when reviewing a function's parameters, from interface-bloat when reviewing the type itself.

## Sources

- [Robert C. Martin, The Interface Segregation Principle, C++ Report (1996)](https://web.archive.org/web/20060822033314/http://www.objectmentor.com/resources/articles/isp.pdf) (recalled)
- [Robert C. Martin, Agile Software Development, Principles, Patterns, and Practices (2002)](https://www.oreilly.com/library/view/agile-software-development/0135974445/) (recalled)
