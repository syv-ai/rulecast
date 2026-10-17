<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Proxy

`proxy` · design patterns, structural

A stand-in with the same interface as the real object, which controls access to it (lazily creating it, checking permissions, caching, logging, or reaching it over a network). Also called a surrogate.

*Matters most for:* distributed, databases-storage, library-sdk

## But

Transparency is the risk: a proxy that looks local can hide latency, partial failure and changed semantics, which is the core of the critique of transparent remote objects (Waldo et al., A Note on Distributed Computing). It also adds a layer and can delay responses. Use it when the control it adds is real and uniform.

## Quality axes

- **change_cost** ⊕ (primary): Lazy creation, access checks, caching or logging are added in one stand-in without changing the service or its callers.
- **reliability** −: A stand-in that looks local hides latency, partial failure and changed semantics, so callers treat remote or lazy calls as cheap and safe.

**Flips:** The other effects depend on the variant - a caching or lazy proxy helps runtime, a protection proxy helps security, a remote one adds a hop. A proxy that forwards everything adds a layer and delay with no control gained.

## Warranted when

- A heavyweight object is needed only sometimes and should be created lazily, without every caller handling that.
- Access must be checked, logged, cached or counted uniformly, and you can't or shouldn't change the service class.
- The real object lives elsewhere (another process or machine) but callers should use it like a local one.

## How it shows

- A class implementing the same interface as a service and holding a reference to it, doing work before or after forwarding each call.
- Variants named for their job - lazy or virtual, protection, remote, caching, logging, smart reference.
- Objects that create their real target only on first use.

## Overdone when

- A proxy that forwards every call without adding any control.
- Remote proxies that hide network latency and failure so well that callers treat remote calls as cheap and reliable.
- Layers of proxies where a single cache or permission check at the call site would be clearer.

## Example

Before:

```
fn show_chart(user, patient_id):
    if not user.can_read(patient_id): raise Forbidden()
    audit.log(user, "read", patient_id)
    return records.fetch(patient_id)

fn export_summary(user, patient_id):
    if not user.can_read(patient_id): raise Forbidden()
    audit.log(user, "read", patient_id)
    return summarize(records.fetch(patient_id))
    # a third caller that forgets the check leaks a record
```

After:

```
class GuardedRecords(RecordStore):
    fn init(real: RecordStore, user: User): ...
    fn fetch(patient_id) -> Record:
        if not self.user.can_read(patient_id): raise Forbidden()
        self.audit.log(self.user, "read", patient_id)
        return self.real.fetch(patient_id)

fn show_chart(records: RecordStore, patient_id):
    return records.fetch(patient_id)   # handed GuardedRecords(store, user)
```

A stand-in with the same interface does the permission check and audit on every call, so callers can't skip them and the store itself is unchanged.

## By language

**python:** Rare in everyday code. When used, it's often a class that forwards unknown attributes with __getattr__, a lazy property such as functools.cached_property, or library-provided proxies (weakref.proxy, ORM lazy-loaded relations, RPC client stubs). For caching or access checks on functions, a function decorator is usually simpler.

**typescript:** Not especially common in TypeScript apps, but useful when behaviour must be added in front of an existing object without changing its callers. The built-in `Proxy` object intercepts property access generically, and reactivity systems (Vue, MobX) and mocking libraries rely on it. Typing a built-in `Proxy` precisely is hard, so hand-written wrapper classes stay the norm for typed, single-purpose proxies. Spotting it: A class implementing the same interface as a service object, forwarding every method to it; or use of the built-in `Proxy` with a handler.

**java:** Rarely written by hand in application code, but pervasive underneath it: java.lang.reflect.Proxy dynamic proxies, RMI stubs, and container-injected EJB, CDI and JPA references are all proxies. Spring and Hibernate generate them (JDK or CGLIB/ByteBuddy subclasses) for transactions, lazy loading and security. That causes known pitfalls: self-invocation bypasses the proxy, and final classes or methods can't be proxied by subclassing. Spotting it: A class implementing the same interface as a service, or subclassing it, whose methods forward to the real object after checks, caching or lazy initialisation; or an InvocationHandler.

**csharp:** Not frequent in hand-written C#, but used when behaviour such as caching, lazy loading, access checks or logging must be added without touching the client. Much C# proxying is generated rather than written: EF Core lazy-loading proxies, Castle DynamicProxy behind mocking libraries like Moq, DispatchProxy, and generated gRPC or WCF client stubs. Lazy<T> covers simple virtual-proxy needs. Spotting it: A class implementing the same interface as a service it holds and forwarding every call to it, sometimes created lazily; or a subclass of the service overriding virtual members.

**go:** Built the same way as a decorator: a struct that satisfies the service's interface and holds the real service. Implicit interfaces mean callers can't tell the difference. Common uses are caching, rate limiting, lazy connection and RPC client stubs. httputil.ReverseProxy and http.RoundTripper wrappers are the standard-library forms. Generated gRPC clients are remote proxies. Spotting it: A struct implementing the same interface as a field it holds, adding access control, caching or lazy setup before forwarding.

**rust:** The proxy is a struct that owns the real subject and implements the same trait, adding checks, caching or rate limits before it forwards. Methods take `&mut self` when the proxy keeps counters, and need a `Mutex` or atomics when it is shared. Smart pointers are Rust's built-in proxies. `Deref` makes `Box`, `Rc`, `MutexGuard` and `Ref` act like the inner value, but implementing `Deref` just to proxy a non-pointer type is considered an anti-pattern. Spotting it: A struct wrapping a concrete service and implementing the service's trait with a guard before delegating, or a custom `Deref`/`DerefMut` impl on a handle type.

**cpp:** Rarely named in C++ code, though the language is full of proxy-like types: smart pointers stand in for the pointee by overloading operator-> and operator*, and vector<bool>::reference stands in for a single bit. Hand-written proxies usually do lazy loading or access checks. Spotting it: A class with the same interface as a service object that forwards every call to it, or a type overloading operator-> or operator* to stand in for another object.

## Related

[Decorator](decorator.md) · [Adapter](adapter.md) · [Facade](facade.md) · [Flyweight](flyweight.md)

## Sources

- [Refactoring.Guru, Proxy](https://refactoring.guru/design-patterns/proxy) (read)
- [Refactoring.Guru, Proxy in Python](https://refactoring.guru/design-patterns/proxy/python/example) (read)
- Jim Waldo et al., A Note on Distributed Computing (Sun Microsystems, 1994) (recalled)
- [Refactoring.Guru, Proxy in TypeScript](https://refactoring.guru/design-patterns/proxy/typescript/example) (read)
- Established TypeScript practice (built-in Proxy, reactivity libraries) (recalled)
- [Refactoring.Guru, Proxy in Java](https://refactoring.guru/design-patterns/proxy/java/example) (read)
- Spring AOP proxying mechanisms and self-invocation limitation (recalled)
- [Refactoring.Guru, Proxy in C#](https://refactoring.guru/design-patterns/proxy/csharp/example) (read)
- EF Core lazy-loading proxies; Castle DynamicProxy; System.Reflection.DispatchProxy (recalled)
- [Refactoring.Guru, Proxy in Go](https://refactoring.guru/design-patterns/proxy/go/example) (read)
- [Go standard library, net/http/httputil ReverseProxy](https://pkg.go.dev/net/http/httputil#ReverseProxy) (recalled)
- [Refactoring.Guru, Proxy in Rust](https://refactoring.guru/design-patterns/proxy/rust/example) (read)
- [Rust Design Patterns, Deref polymorphism anti-pattern](https://rust-unofficial.github.io/patterns/anti_patterns/deref.html) (recalled)
- [Refactoring.Guru, Proxy in C++](https://refactoring.guru/design-patterns/proxy/cpp/example) (read)
- [std::vector<bool>::reference, cppreference](https://en.cppreference.com/w/cpp/container/vector_bool/reference) (recalled)
