<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Liskov Substitution Principle (LSP)

`liskov-substitution-principle` · principles, design

Any implementation of a type must work wherever the type is expected, without callers knowing which one they got. A subtype may accept more and promise more, never require more or promise less, and must keep the type's invariants.

*Names:* From Barbara Liskov's keynote Data Abstraction and Hierarchy (OOPSLA 1987), made precise by Liskov and Jeannette Wing in A Behavioral Notion of Subtyping (1994). Robert C. Martin made it the L in SOLID. Bertrand Meyer's rules on preconditions and postconditions under inheritance (Design by Contract) say the same thing.

*Matters most for:* plugin-host, library-sdk, plugins-extensions

## But

The principle is rarely disputed, but the standard libraries break it on purpose. Java's unmodifiable lists throw on add, and .NET's read-only collections throw NotSupportedException, trading substitutability for a smaller set of interfaces. Optional operations documented in the contract are a deliberate choice, not a slip, though they shift checks to runtime. In duck-typed and structurally typed code there is no declared subtype, but the behavioural contract still applies. Martin's SOLID phrasing is about classes; the principle matters as much for interface implementations and for plugins, where a contract suite is the practical check.

## Quality axes

- **reliability** ⊕ (primary): Any implementation behaves as callers expect, so there are no bugs that appear only with one driver, adapter or plugin.
- **change_cost** +: A new implementation drops in without callers adding type checks or special cases.
- **delivery** −: Each implementation must honour the whole contract, which often means a different hierarchy and a shared test run against each one.

**Flips:** Treating every type check as a violation, including matches on a closed union, or splitting interfaces so nothing ever refuses an operation, scatters the contract and turns change_cost "-".

## Warranted when

- Several implementations of one interface or base class used interchangeably, especially by others (plugins, adapters, drivers).
- Bugs that appear only with one implementation.
- Inheritance chosen for code reuse rather than a true is-a relation (the square that extends rectangle).

## How it shows

- Overrides that throw not-implemented or not-supported errors.
- Callers that check the concrete type (isinstance, instanceof, type switches) before using an object passed in as the base type.
- Subclasses that tighten what they accept or weaken what they guarantee (stricter validation, nulls where the base never returned them).
- Tests that pass for one implementation of an interface and fail for another.

## Overdone when

- Treating every type check as a violation, including ones on a closed union that is meant to be matched.
- Splitting an interface into one tiny interface per capability so no implementation ever has to refuse anything, which scatters the contract across many types.

## Example

Before:

```
class Settings:
    fn get(key) -> str: ...
    fn set(key, value): ...

class EnvSettings extends Settings:        # read from the environment
    fn get(key): return env[key]
    fn set(key, value): raise NotSupported

fn apply_defaults(s: Settings):
    if s.get("region") is None: s.set("region", "eu-west")   # blows up for EnvSettings
```

After:

```
interface ReadableSettings:
    fn get(key) -> str or None
interface WritableSettings extends ReadableSettings:
    fn set(key, value)

class EnvSettings implements ReadableSettings: ...
class FileSettings implements WritableSettings: ...

fn apply_defaults(s: WritableSettings): ...
```

The read-only source no longer claims a capability it lacks, so the type checker stops it reaching code that writes.

## One-file tell

Python, Java, C# and TypeScript: an overriding method whose whole body raises NotImplementedError, UnsupportedOperationException, NotSupportedException or NotImplementedException, or throws a "not implemented" error, in a class that is not abstract.

## By language

**python:** Overrides raising NotImplementedError in a concrete subclass are the usual sign; abstract base classes and Protocols declare the surface but not the behaviour, so behavioural contracts need tests.

**typescript:** Structural typing means any object with the right shape is a subtype, so behavioural substitutability is unchecked; method parameter bivariance can also let an incompatible override type-check.

**java:** UnsupportedOperationException from collection views is the known standard-library exception; for your own interfaces, a shared abstract test class run against each implementation checks it.

**csharp:** NotSupportedException and NotImplementedException in overrides are the signs; ReadOnlyCollection implementing IList is the standard-library case.

**go:** Interfaces are satisfied implicitly, so any type with the methods is substitutable as far as the compiler knows; the behavioural contract lives in doc comments and in shared test functions such as fstest.TestFS.

**rust:** No inheritance, so it applies to trait implementations; trait docs state the contract (Eq must be reflexive, Hash must agree with Eq) and code relies on it without checking.

## Related

[SOLID](solid.md) · [Refused Bequest](refused-bequest.md) · [Composition over Inheritance](composition-over-inheritance.md) · [Contract Test](contract-test.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Sources

- [Barbara Liskov, Data Abstraction and Hierarchy, OOPSLA 1987 keynote](https://dl.acm.org/doi/10.1145/62139.62141) (recalled)
- [Barbara Liskov and Jeannette Wing, A Behavioral Notion of Subtyping, ACM TOPLAS (1994)](https://dl.acm.org/doi/10.1145/197320.197383) (recalled)
- [Robert C. Martin, Agile Software Development, Principles, Patterns, and Practices (2002)](https://www.oreilly.com/library/view/agile-software-development/0135974445/) (recalled)
