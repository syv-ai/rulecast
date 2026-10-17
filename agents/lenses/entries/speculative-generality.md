<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Speculative Generality

`speculative-generality` · smells, design · **agents do this**

Hooks, parameters, abstract classes and extension points were added for needs that might come someday and never did. It is YAGNI seen in the code.

*Matters most for:* library-sdk, plugins-extensions, platforms, cli-devtool, plugin-host

## But

Libraries and frameworks need some generality their own code doesn't use, because their users do. An interface with one production implementation can be justified by a test fake, or by a second implementation already in progress. Ask before flagging. Check whether tests depend on the hooks before deleting them.

## Quality axes

- **change_cost** −: Unused hooks, parameters and abstract layers have to be read, traced and kept working on every change.
- **delivery** −: Time goes into building and testing flexibility nobody needs yet.

**Flips:** Libraries and frameworks need generality their users rely on, and an interface with one production implementation can be justified by a test fake.

## Why people fall into it

- A request for "clean", "flexible" or "future-proof" code without saying flexible how.
- Patterns read as good practice in themselves.
- The belief that adding the seam later will be harder than adding it now.

## How it shows

- An interface or abstract base class with exactly one implementation.
- Parameters, options or config keys that every caller passes the same value for, or none use.
- Factories, registries or plugin systems with one registered thing.
- Methods or classes whose only callers are tests.
- Names like Generic, Base, Abstract or Manager around code with one concrete use.

## Overcorrecting looks like

- Removing extension points in a framework or library whose users rely on them, even if this repository doesn't.
- Deleting a seam that exists so tests can substitute a slow or external dependency.
- Refusing all abstraction until the third copy, even when the variation is known and imminent.

## What to do

Collapse Hierarchy for an abstract class with one child, Inline Class for needless delegation, Inline Method (Inline Function) for unused indirection, Remove Parameter for unused parameters, and delete unused fields. Add the abstraction back when the second case actually arrives.

## Example

Before:

```
interface PhotoStore:
    fn put(key: str, data: bytes, compression: str, replicas: int)

class LocalDiskStore implements PhotoStore:
    fn put(key, data, compression, replicas):
        # compression and replicas are ignored
        write_file(PHOTO_DIR + key, data)

class PhotoStoreFactory:
    fn create(kind: str) -> PhotoStore:
        return LocalDiskStore()
```

After:

```
class LocalDiskStore:
    fn put(key: str, data: bytes):
        write_file(PHOTO_DIR + key, data)

store = LocalDiskStore()
```

One store, no compression, no replication; the interface, factory and unused parameters go until a second store is real.

## Related

[YAGNI](yagni.md) · [Dead Code](dead-code.md) · [Lazy Class](lazy-class.md) · [KISS (Keep It Simple, Stupid)](kiss.md) · [Second-System Effect](second-system-effect.md)

## Overlaps

yagni is the principle. speculative-generality is the symptom inside a class or module (hooks, parameters and abstractions nothing uses), and over-engineering is the same thing at system scale.

## Sources

- [Refactoring.Guru, Speculative Generality](https://refactoring.guru/smells/speculative-generality) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
