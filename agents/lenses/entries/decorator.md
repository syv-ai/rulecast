<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Decorator

`decorator` · design patterns, structural

Add behaviour to an object by wrapping it in another object with the same interface, and stack wrappers instead of subclassing every combination. Also called a wrapper.

*Matters most for:* web-api, library-sdk

## But

Stacks become hard to reason about: order dependencies, identity checks failing on the wrapper, and difficulty removing one layer from the middle. When the combinations are few and fixed, plain composition or a configuration flag is clearer. A decorator that changes the interface is really an adapter.

## Quality axes

- **change_cost** ⊕ (primary): Optional behaviours and cross-cutting concerns stack as wrappers without a subclass per combination or edits to the wrapped class.
- **operability** −: Behaviour is spread over wrappers assembled elsewhere, so debugging means walking the stack, and identity checks fail on the wrapper.

**Flips:** Deep stacks whose order matters but isn't obvious turn change_cost "-" as well; with few fixed combinations a flag or plain composition is clearer.

## Warranted when

- Optional features combine freely, and a subclass per combination would explode.
- Behaviour has to be added or removed at runtime without changing the code that uses the object.
- Cross-cutting concerns such as logging, retrying, caching or metrics must wrap many call paths uniformly.
- The class can't be subclassed, or you don't own it.

## How it shows

- A class whose constructor takes an object of its own interface and which implements that interface by delegating plus doing something extra.
- Layered wrappers around a base object, common in stream and I/O code (buffering, compression, encryption).

## Overdone when

- Deep stacks of wrappers whose order matters but isn't obvious, making debugging and stack traces hard.
- A wrapper class used once, where a direct change to the class would do.
- Using wrappers to change what a method means rather than to add around it.

## Example

Before:

```
class HttpRateSource(RateSource):
    fn rate(pair: str) -> float: ...

class CachedRateSource(HttpRateSource): ...
class RetryingRateSource(HttpRateSource): ...
class CachedRetryingRateSource(HttpRateSource): ...
class MeteredCachedRetryingRateSource(HttpRateSource): ...
# one subclass per combination of cache, retry and metrics
```

After:

```
class CachedRates(RateSource):
    fn init(inner: RateSource): self.inner = inner; self.cache = {}
    fn rate(pair: str) -> float:
        if pair not in self.cache: self.cache[pair] = self.inner.rate(pair)
        return self.cache[pair]

class RetryingRates(RateSource): ...   # retries self.inner.rate(pair)
class MeteredRates(RateSource): ...    # times self.inner.rate(pair)

rates = MeteredRates(CachedRates(RetryingRates(HttpRateSource())))
```

Each concern wraps any RateSource and keeps the same interface, so features are stacked at construction time instead of baked into subclasses.

## By language

**python:** Python's @decorator syntax is a related but different thing: it wraps functions or classes at definition time rather than objects at runtime, though it is the idiomatic way to add cross-cutting behaviour such as caching or retries. Use functools.wraps so wrapped functions keep their name and docstring. The object form still appears in stream classes in io. Wrapper classes can forward unhandled attributes with __getattr__.

**typescript:** Quite common in TypeScript, especially around streams. Don't confuse it with TypeScript's `@decorator` syntax, which annotates classes and members at definition time rather than wrapping an object at runtime. Higher-order functions that wrap another function (middleware, `withRetry(fn)`) are the lighter, more idiomatic form for single behaviours. Spotting it: A class whose constructor takes an object of the same interface it implements, and whose methods call through to that wrapped object.

**java:** Very common, and java.io is built on it: stream and reader classes wrap one another (buffering, data conversion, compression). Collections.unmodifiable/synchronized/checked wrappers and servlet request and response wrappers are other examples. Wrapping a wide interface by hand is verbose, so frameworks often use AOP proxies or annotations (Spring @Transactional, @Cacheable) to apply cross-cutting decoration instead. Spotting it: A class whose constructor takes an object of the same interface or abstract type it implements, and whose methods add behaviour before or after forwarding to it.

**csharp:** Widespread in C#, most visibly in System.IO streams, where BufferedStream, GZipStream and CryptoStream each wrap another Stream. HttpClient's DelegatingHandler chain and ASP.NET Core middleware are close relatives. Standard DI doesn't register decorators natively; teams either wire them by hand in a factory registration or use a library such as Scrutor's Decorate. Spotting it: A class implementing an interface or base class whose constructor takes another instance of that same type and forwards calls to it, adding behaviour before or after.

**go:** Very common and idiomatic. io.Reader and io.Writer wrappers such as bufio, gzip and io.LimitReader are decorators, and so is HTTP middleware, a function that takes an http.Handler and returns one. Small interfaces keep decorators short. Embedding the wrapped interface lets a decorator override one method and inherit the rest. Embedding can also hide optional interfaces such as http.Flusher, which is a known pitfall. Spotting it: A function with the shape func(Handler) Handler, or a struct holding (or embedding) a value of the same interface it implements and delegating to it.

**rust:** Generic wrappers that take an inner `T: Trait` and implement the same trait are common in std and the ecosystem: `BufReader<R: Read>`, `BufWriter`, iterator adapters, and tower's `Layer`/`Service` middleware. Generics make stacked decorators zero-cost, but the full nested type shows up in signatures, so APIs often hide it behind `impl Trait` or a box. Spotting it: A struct generic over `T: Trait` that also implements `Trait`, forwarding to its inner field. Often has `into_inner()`/`get_ref()` accessors, or nested constructor calls such as `BufReader::new(File::open(..)?)`.

**cpp:** Common in C++, especially around streams. Runtime decorators hold the wrapped object by unique_ptr to the shared interface. Static alternatives are idiomatic too: a class template that inherits from or wraps its type parameter (mixin layering), and C++20 range adaptors, which compose views by piping. Spotting it: A class implementing an interface whose constructor takes another object of that same interface, usually as a unique_ptr or reference, and calls through to it.

## Related

[Adapter](adapter.md) · [Proxy](proxy.md) · [Composite](composite.md) · [Chain of Responsibility](chain-of-responsibility.md) · [Strategy](strategy.md) · [Prototype](prototype.md)

## Sources

- [Refactoring.Guru, Decorator](https://refactoring.guru/design-patterns/decorator) (read)
- [Refactoring.Guru, Decorator in Python](https://refactoring.guru/design-patterns/decorator/python/example) (read)
- [Refactoring.Guru, Decorator in TypeScript](https://refactoring.guru/design-patterns/decorator/typescript/example) (read)
- Established TypeScript practice (language decorators vs. the pattern, higher-order functions) (recalled)
- [Refactoring.Guru, Decorator in Java](https://refactoring.guru/design-patterns/decorator/java/example) (read)
- Spring AOP proxy-based advice (recalled)
- [Refactoring.Guru, Decorator in C#](https://refactoring.guru/design-patterns/decorator/csharp/example) (read)
- System.IO stream wrappers; System.Net.Http.DelegatingHandler; Scrutor (recalled)
- [Refactoring.Guru, Decorator in Go](https://refactoring.guru/design-patterns/decorator/go/example) (read)
- [Go standard library, io and bufio](https://pkg.go.dev/io) (recalled)
- [Refactoring.Guru, Decorator in Rust](https://refactoring.guru/design-patterns/decorator/rust/example) (read)
- [tower Service/Layer middleware; std iterator adapters](https://docs.rs/tower) (recalled)
- [Refactoring.Guru, Decorator in C++](https://refactoring.guru/design-patterns/decorator/cpp/example) (read)
- [Ranges library range adaptors (C++20), cppreference](https://en.cppreference.com/w/cpp/ranges) (recalled)
