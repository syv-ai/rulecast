<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Flyweight

`flyweight` · design patterns, structural

Save memory by sharing the common, immutable part of many similar objects and keeping only the per-object part separate.

*Matters most for:* games, embedded, compilers-tooling

## But

It's a memory optimisation with costs: more complex code, possible extra CPU work to recompute or pass extrinsic state, and bugs if shared state is ever mutated. Profile first. If the app isn't short on RAM, skip it.

## Quality axes

- **runtime** ⊕ (primary): Heavy shared data is stored once instead of in every one of many similar objects, cutting memory.
- **change_cost** −: State is split into shared and per-use parts passed around, so the code is harder to read and change.

**Flips:** Without a measured memory problem it is cost only; if the shared state is ever mutated, one user's change leaks to all others, turning reliability "-".

## Warranted when

- A measured memory problem caused by a huge number of similar objects.
- Those objects duplicate the same heavy data (textures, glyphs, configuration) that can be extracted and shared.
- The shared part can be made immutable.

## How it shows

- A factory that returns a stored shared object for a given key instead of building a new one.
- Objects split into shared intrinsic state and per-use extrinsic state passed in by the caller.

## Overdone when

- Applying it without a memory measurement showing a problem.
- Splitting state into intrinsic and extrinsic for a few hundred objects, making the code harder to read for no gain.
- Sharing objects that are mutable, so a change through one user leaks to all others.

## Example

Before:

```
class LogEntry:
    fn init(ts, message, host, service, region, build, env):
        self.ts = ts
        self.message = message
        self.host = host          # these five fields repeat, identical,
        self.service = service    # across millions of loaded lines;
        self.region = region      # profiling shows they dominate the heap
        self.build = build
        self.env = env
```

After:

```
class LogSource:                  # immutable, shared
    fn init(host, service, region, build, env): ...

class LogSources:
    fn init(): self.pool = {}
    fn get(host, service, region, build, env) -> LogSource:
        key = (host, service, region, build, env)
        if key not in self.pool: self.pool[key] = LogSource(host, service, region, build, env)
        return self.pool[key]

class LogEntry:
    fn init(ts, message, source: LogSource): ...
```

The repeated source fields become one shared immutable object per distinct source, and each entry keeps only its own timestamp and message; worth it only because profiling showed the cost.

## By language

**python:** Python already does this for small ints and interned strings. Idiomatic tools include functools.lru_cache or cache on a constructor function, a dict or WeakValueDictionary keyed by the shared state, and __slots__ to cut per-instance overhead. For large numeric data, arrays (array module, NumPy) usually beat millions of small objects.

**typescript:** Exists only to save memory, so skip it unless memory is a real problem. In TypeScript it appears as a `Map` cache keyed on the shared state. Engines already intern strings, and `WeakMap` or `WeakRef` let a cache avoid holding objects alive. Spotting it: A creation function or factory that returns a cached instance from a map when one matches, instead of constructing a new one.

**java:** Worth it only under real memory pressure. The JDK uses it in the boxed types' valueOf caches (Integer -128..127, Boolean, Character up to 127 and others) and in String interning. The cache hides a classic bug: == on boxed values compares references, which happens to work inside the cached range and fails outside it, so always compare with equals. Spotting it: A static creation method (valueOf, of, intern) that returns an existing cached instance from a map or array instead of constructing a new one.

**csharp:** Only worth it when memory is actually tight. The runtime applies the idea in string interning (String.Intern, and literals are interned automatically). ArrayPool and object pools are related but different: they reuse temporary mutable objects instead of sharing immutable ones. Value types (structs) are often the more idiomatic C# way to cut per-object overhead for large numbers of small objects. Spotting it: A factory method that returns cached shared instances keyed by their intrinsic state, typically backed by a Dictionary or ConcurrentDictionary, instead of constructing new ones.

**go:** Usually takes the form of a map-backed cache of shared immutable values, guarded by a mutex or sync.Map. sync.Pool is related but different, since it reuses objects that are temporary and mutable rather than sharing ones that are immutable. Go 1.23 added the unique package for interning comparable values, which is a built-in flyweight. Profile before reaching for it. Go strings and slices already share their backing data. Spotting it: A factory with a map from key to shared value, returning the cached entry when present, or calls to unique.Make.

**rust:** Shared intrinsic state goes behind `Rc` (single thread) or `Arc` (shared across threads), and a factory map (`HashMap`/`HashSet` keyed by the intrinsic data) hands out clones of the pointer. Often the more idiomatic form stores the shared data once in a `Vec` and gives each object a small index or ID. That is the arena/interning approach (`string-interner`, `lasso`), and it avoids reference-counting overhead and borrow problems. `Cow` and `&'static` data cover the read-only cases. Spotting it: A cache map of `Rc<T>`/`Arc<T>` values, an interner returning integer symbols, or many structs holding a shared pointer or an index into a common table.

**cpp:** Exists to save memory; skip it if memory is not a constraint. In C++ the shared state is usually immutable and handed out as const references or shared_ptr<const T> from a cache keyed in an unordered_map. Boost.Flyweight offers a ready-made version. Interned strings and string_view into a shared pool are the everyday form. Spotting it: A factory or cache method that looks up a key in a map and returns an existing shared object, creating one only on a miss.

## Related

[Composite](composite.md) · [Singleton](singleton.md) · [Facade](facade.md) · [Premature Optimization](premature-optimization.md)

## Sources

- [Refactoring.Guru, Flyweight](https://refactoring.guru/design-patterns/flyweight) (read)
- [Refactoring.Guru, Flyweight in Python](https://refactoring.guru/design-patterns/flyweight/python/example) (read)
- [Refactoring.Guru, Flyweight in TypeScript](https://refactoring.guru/design-patterns/flyweight/typescript/example) (read)
- Established TypeScript practice (Map caches, WeakMap/WeakRef) (recalled)
- [Refactoring.Guru, Flyweight in Java](https://refactoring.guru/design-patterns/flyweight/java/example) (read)
- JLS boxing conversion cache range; String.intern (recalled)
- [Refactoring.Guru, Flyweight in C#](https://refactoring.guru/design-patterns/flyweight/csharp/example) (read)
- String.Intern; System.Buffers.ArrayPool (recalled)
- [Refactoring.Guru, Flyweight in Go](https://refactoring.guru/design-patterns/flyweight/go/example) (read)
- [Go standard library, unique](https://pkg.go.dev/unique) (recalled)
- [Refactoring.Guru, Flyweight in Rust (page read; its code files were not visible)](https://refactoring.guru/design-patterns/flyweight/rust/example) (read)
- Rc/Arc sharing and string interning crates (recalled)
- [Refactoring.Guru, Flyweight in C++](https://refactoring.guru/design-patterns/flyweight/cpp/example) (read)
- [Boost.Flyweight](https://www.boost.org/doc/libs/release/libs/flyweight/) (recalled)
