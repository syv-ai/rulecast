<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Refused Bequest

`refused-bequest` · smells, design

A subclass inherits methods and fields it doesn't want, ignoring them or overriding them to throw, which means the inheritance was chosen for code reuse rather than because the subclass really is a kind of its parent.

*Matters most for:* library-sdk, plugins-extensions, desktop

## But

Fowler says the smell is faint when a subclass merely doesn't use some inherited implementation. It's strong when the subclass refuses the interface, because then it breaks the Liskov Substitution Principle and callers can't trust the parent type. Some standard libraries accept optional operations on purpose (Java's unmodifiable collections throwing on add), and that is a known, debated trade-off.

## Quality axes

- **delivery** +: Inheriting was the fastest way to reuse a few methods.
- **reliability** −: Overrides that throw "not supported" break callers holding the parent type, and the failure only shows at runtime.
- **change_cost** −: Callers must check the concrete type, and changes to the parent drag along subclasses that don't want them.

**Flips:** Some libraries accept optional operations on purpose, such as Java's unmodifiable collections throwing on add, as a known trade-off.

## Why people fall into it

- Inheriting was the fastest way to reuse a few methods.
- The two classes looked similar at the time.
- A framework base class that brings far more than the subclass needs.

## How it shows

- An override whose body only raises "not supported" or does nothing.
- A subclass that uses a small part of a large parent.
- Callers that check the concrete type before calling an inherited method.

## Overcorrecting looks like

- Rebuilding a hierarchy because a subclass leaves one harmless inherited helper unused.
- Replacing all inheritance with delegation, including where the subclass genuinely is a kind of its parent.

## What to do

Replace Inheritance with Delegation (Replace Superclass with Delegate in the 2nd edition) when the classes aren't really related. If they are, push the unwanted members down (Push Down Method, Push Down Field) or Extract Superclass with only what both share.

## Example

Before:

```
class Folder:
    fn list() -> list: ...
    fn write(name, data): ...
    fn delete(name): ...

class Archive extends Folder:
    fn write(name, data): raise Unsupported("archive is read-only")
    fn delete(name): raise Unsupported("archive is read-only")
```

After:

```
interface Readable:
    fn list() -> list

class Folder implements Readable:
    fn list() -> list: ...
    fn write(name, data): ...
    fn delete(name): ...

class Archive implements Readable:
    fn list() -> list: ...
```

The archive only promises what it can do, so no caller can be handed one and told it can write.

## One-file tell

An overriding method whose entire body raises a not-supported or not-implemented error.

## By language

**java:** UnsupportedOperationException in an override is the classic sign, used deliberately in the collections framework.

## Related

[Parallel Inheritance Hierarchies](parallel-inheritance-hierarchies.md)

## Sources

- [Refactoring.Guru, Refused Bequest](https://refactoring.guru/smells/refused-bequest) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
