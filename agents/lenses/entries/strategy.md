<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Strategy

`strategy` · design patterns, behavioral

Put each variant of an algorithm behind one interface and let the caller plug in the one it wants; also called Policy.

*Matters most for:* library-sdk, scientific, ml-training

## But

With a few algorithms that rarely change, the extra types are complexity for nothing, and callers now have to understand the differences to choose. In languages with first-class functions a function argument usually replaces the whole pattern; Norvig made this point for dynamic languages and the source concedes it. Don't introduce the interface until there is a second variant.

## Quality axes

- **change_cost** ⊕ (primary): Each algorithm variant sits behind one interface, so a new one is added without growing a conditional in the class that uses it.
- **delivery** −: An interface and a class per variant must be written.

**Flips:** With one implementation, or two stable ones, the extra types are complexity for nothing; in languages with first-class functions a function parameter gives the benefit without the classes.

## Warranted when

- A conditional picks between variants of the same algorithm and keeps growing
- Several classes are identical apart from how they do one thing
- The algorithm must be chosen at runtime or by configuration
- Algorithm details are tangled with the class's core logic and change for different reasons

## How it shows

- An interface with one main method and several implementations, passed into a context object
- A context that delegates one step to a held object and has a setter to swap it
- A large conditional choosing between variants of the same calculation, before refactoring

## Overdone when

- A strategy interface with one implementation and no second one in sight
- Strategy classes for two stable algorithms that a parameter or an if would cover
- Single-method strategy classes in a language where passing a function does the job

## Example

Before:

```
class JobQueue:
    fn retry_delay(job: Job) -> Seconds:
        if self.config.backoff == "fixed":
            return 30
        elif self.config.backoff == "exponential":
            return min(2 ** job.attempts, 3600)
        elif self.config.backoff == "jittered":
            return random(0, min(2 ** job.attempts, 3600))
        ... # a fourth policy is requested for the email queue
```

After:

```
interface Backoff:
    fn delay(attempts: int) -> Seconds

class Fixed implements Backoff:
    fn delay(attempts): return 30
class Exponential implements Backoff:
    fn delay(attempts): return min(2 ** attempts, 3600)
class Jittered implements Backoff:
    fn delay(attempts): return random(0, Exponential().delay(attempts))
class Linear implements Backoff:    # the email queue's new policy; JobQueue is untouched
    fn delay(attempts): return min(60 * attempts, 3600)

class JobQueue:
    fn retry_delay(job): return self.backoff.delay(job.attempts)
email_queue = JobQueue(backoff=Linear())
```

Each backoff policy sits behind one interface and the queue is handed the one it uses; with first-class functions, passing a delay function is the same move.

## One-file tell

An abstract base class or Protocol with a single method, implemented by several small classes that hold no state.

## By language

**python:** Usually just pass a function: sorted(key=...), a callable parameter, or a dict of named functions. A class or Protocol is warranted only when the strategy carries configuration or several related methods. The source notes frameworks use it so users can change behaviour without subclassing.

**typescript:** Very common in TypeScript, especially in frameworks that let users change behaviour without subclassing. With first-class functions, a strategy is usually just a function parameter or a function-typed property (a comparator passed to `sort`, for example). Strategy classes are only worth it when the strategy carries state or several related methods. Spotting it: A method that delegates work to a held object or function, plus a setter or constructor parameter that lets it be swapped.

**java:** Common, especially in frameworks that let callers vary behaviour without subclassing; Comparator passed to sort is the canonical JDK case. Since Java 8, a lambda or method reference for a functional interface (Comparator, Function, Predicate) replaces most strategy classes. With DI, strategies are often injected as a List or Map of beans and selected by key. Spotting it: A method that delegates work to a field or parameter of an interface type, often a functional interface, with a constructor or setter for swapping in a different implementation.

**csharp:** Very common, particularly in frameworks that let you change a class's behaviour without subclassing. Delegates (Func, Action, Comparison<T>) and lambdas are the light idiomatic form, as in LINQ and List<T>.Sort; IComparer<T> and IEqualityComparer<T> are standard-library strategy interfaces. In application code, injecting an interface through DI is the usual shape, with keyed services when the strategy is picked by name. Spotting it: A class that delegates part of its work to an injected interface or delegate field, often swappable via constructor, setter or method parameter.

**go:** Pervasive, and often just a function value. sort.Slice and slices.SortFunc take the comparison as a func, and strings.Map takes the mapping. A one-method interface is the alternative when the strategy carries state or configuration. Both are idiomatic, and the choice is usually whether callers want to pass a closure or a type. Spotting it: A func-typed parameter or struct field that decides behaviour, or a field of a small interface type with a setter to swap it.

**rust:** Everywhere and implicit. Any function taking a closure (`sort_by`, `filter`, `map_or_else`) is a strategy. Use a generic `T: Strategy` field when the strategy is fixed at compile time, `Box<dyn Strategy>` when it is swapped at runtime, and a plain `fn` pointer or `impl Fn` parameter when the strategy is a single function. A dedicated trait is worth it only when the strategy has several methods or its own state. Spotting it: A struct generic over a behavior trait, a `Box<dyn Trait>` field set at construction, or parameters typed `impl Fn(..)` or `fn(..)`.

**cpp:** Widely used in C++, often in frameworks that let users change behavior without subclassing. C++ has two idiomatic forms beyond the virtual interface: compile-time strategies as template parameters (the standard library's comparators, allocators and hashers), and runtime strategies as std::function or lambdas. A strategy interface is usually overkill when a single callable will do. Spotting it: A class that delegates work to a held object or callable and lets it be replaced through a setter or constructor, or a template parameter supplying behavior such as Compare or Hash.

## Related

[State](state.md) · [Template Method](template-method.md) · [Command](command.md) · [Decorator](decorator.md) · [Bridge](bridge.md)

## Overlaps

switch-statements is the smell, and state and strategy are the two usual remedies: state when the switch is on an object's lifecycle, strategy when it chooses an algorithm. Exhaustive matching on a closed set is often better than either. open-closed-principle says when the switch is worth replacing at all: when others add cases, not when you own every one.

## Sources

- [Refactoring.Guru, Design Patterns: Strategy](https://refactoring.guru/design-patterns/strategy) (read)
- [Refactoring.Guru, Strategy in Python](https://refactoring.guru/design-patterns/strategy/python/example) (read)
- [Peter Norvig, Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/) (recalled)
- [Refactoring.Guru, Strategy in TypeScript](https://refactoring.guru/design-patterns/strategy/typescript/example) (read)
- Established TypeScript practice (function parameters as strategies) (recalled)
- [Refactoring.Guru, Strategy in Java](https://refactoring.guru/design-patterns/strategy/java/example) (read)
- [Refactoring.Guru, Strategy in C#](https://refactoring.guru/design-patterns/strategy/csharp/example) (read)
- System.Collections.Generic.IComparer<T>; .NET 8 keyed DI services (recalled)
- [Refactoring.Guru, Strategy in Go](https://refactoring.guru/design-patterns/strategy/go/example) (read)
- [Go standard library, slices.SortFunc](https://pkg.go.dev/slices#SortFunc) (recalled)
- [Refactoring.Guru, Strategy in Rust](https://refactoring.guru/design-patterns/strategy/rust/example) (read)
- [Refactoring.Guru, Strategy in C++](https://refactoring.guru/design-patterns/strategy/cpp/example) (read)
- [Standard library Compare, Hash and Allocator requirements, cppreference](https://en.cppreference.com/w/cpp/named_req) (recalled)
