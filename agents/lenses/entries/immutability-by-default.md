<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Immutability by Default

`immutability-by-default` · practices, design

Make values, records and collections unchangeable unless there is a reason for them to change, and produce a modified copy instead of editing in place. Mutation is then rare and visible, so shared data can't be changed behind a reader's back.

*Names:* Long-standing in functional programming. In OO practice it is Joshua Bloch's Effective Java item "Favor immutability" (item 13, 1st ed., 2001), renamed "Minimize mutability" (item 15, 2nd ed.; item 17, 3rd ed.). Rich Hickey's Clojure (2007) and Rust (immutable bindings unless marked mut) made it a language default.

*Matters most for:* web-frontend, fullstack-web, distributed, library-sdk, data-pipeline

## But

Copying costs memory and time, and without persistent data structures large updates can be slow; games, numeric code and high-throughput pipelines often need in-place mutation, ideally kept local to one function. Many frameworks, ORMs especially, expect mutable entities with setters, and working against them adds friction. In languages where immutability is shallow or by convention, it gives less safety than it seems: a readonly field can still hold a mutable list. Mutating a local variable that nobody else can see is harmless; the principle is about shared state.

## Quality axes

- **reliability** ⊕ (primary): Shared data can't be changed behind a reader's back, which removes aliasing bugs and races between threads, caches and async tasks.
- **change_cost** +: Mutation is rare and visible, so code is easier to reason about locally.
- **runtime** −: Making modified copies instead of editing in place costs memory and time.

**Flips:** In hot loops, game state updated every frame or numeric code, copying is a measurable runtime cost. Against an ORM that expects mutable entities it adds friction, and change_cost turns "-".

## Warranted when

- Objects shared between callers, threads, caches or async tasks.
- Aliasing bugs, where a list or object passed in is changed by the callee, or a cached value is edited by a reader.
- Values used as dictionary keys or set members, which break if they change.
- Undo, history, diffing or time-travel debugging, which are cheap over immutable snapshots.

## How it shows

- Value types declared frozen, readonly, final or as records.
- Methods named with_x or copy-with that return a new value instead of setters.
- Read-only collection types in signatures (tuple, ReadonlyArray, List.of, IReadOnlyList, slices treated as read-only by convention).
- Before the change, bugs where a shared object or a default argument was changed by one caller and seen by another.

## Overdone when

- Copying large structures on every change in hot loops where in-place mutation is measurably needed.
- Freezing objects whose whole purpose is to accumulate state (builders, buffers, game world state updated every frame).
- Deep-freeze utilities and persistent-collection libraries added to a codebase where shallow readonly types would do.
- Fighting an ORM or framework that expects mutable entities.

## Example

Before:

```
class Quote:
    items: list
    total: Money
    fn apply_discount(pct):
        self.total = self.total * (1 - pct)

base = quotes_cache.get(customer)
base.apply_discount(0.10)          # the cached quote is now discounted for everyone
send(base)
```

After:

```
class Quote (frozen):
    items: tuple
    total: Money
    fn with_discount(pct) -> Quote:
        return Quote(self.items, self.total * (1 - pct))

base = quotes_cache.get(customer)
send(base.with_discount(0.10))     # the cached quote is untouched
```

Discounting returns a new quote, so a value shared through the cache can't be changed by one of its readers.

## By language

**python:** frozen dataclasses (and slots), NamedTuple, tuple and frozenset; dataclasses.replace makes modified copies. Freezing is shallow, so a frozen dataclass holding a list can still be changed through it. Mutable default arguments are the classic bug this prevents.

**typescript:** readonly properties, ReadonlyArray and Readonly<T>, and as const, all checked at compile time only and shallow; Object.freeze is runtime and also shallow. Spread syntax makes copies. Immer gives immutable updates with mutable-looking code.

**java:** records, final fields, and List.of, Set.of and Map.of (which throw on modification), plus Collections.unmodifiableList views. Records are shallowly immutable, so defensive copies of collection components belong in the compact constructor.

**csharp:** records with init-only properties and the with expression, readonly structs, and System.Collections. Immutable; IReadOnlyList and IReadOnlyCollection only hide mutators and don't stop the owner changing the list.

**go:** No immutable struct or collection types. Value semantics (passing structs by value) and unexported fields with getters are the tools; slices and maps are reference-like and must be copied (slices.Clone, maps.Clone) to avoid aliasing.

**rust:** Immutable by default: bindings and references are read-only unless marked mut, and the borrow checker prevents shared mutable aliasing. Interior mutability (Cell, RefCell, Mutex) is the explicit escape hatch.

## Related

[Global state](global-state.md) · [Functional Core, Imperative Shell](functional-core-imperative-shell.md) · [Make Illegal States Unrepresentable](make-illegal-states-unrepresentable.md) · [Command-Query Separation (CQS)](command-query-separation.md)

## Sources

- [Joshua Bloch, Effective Java (3rd ed., 2018), item 17, Minimize mutability](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/) (recalled)
- [Rich Hickey, Are We There Yet? (talk, 2009)](https://www.infoq.com/presentations/Are-We-There-Yet-Rich-Hickey/) (recalled)
- [The Rust Programming Language, Variables and Mutability](https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html) (recalled)
