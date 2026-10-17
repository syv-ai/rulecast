<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Adapter

`adapter` · design patterns, structural

Wrap an object so it offers the interface the caller expects, translating calls and data on the way. Also called a wrapper.

*Matters most for:* library-sdk, plugins-extensions, web-api, data-pipeline

## But

If you control the code on both sides, change one of them instead of adding a translation layer. Speculative adapters around stable libraries add indirection and tend to leak the wrapped API anyway. Still, isolating a volatile external dependency behind a thin boundary is broadly recommended (ports and adapters).

## Quality axes

- **change_cost** ⊕ (primary): A vendor's call shape and units are translated in one wrapper, so business code and a vendor swap touch only it.
- **delivery** −: Another layer to write and keep in sync with both interfaces.

**Flips:** Around code you own, or wrapping a stable library "in case we switch", it is indirection that translates nothing and leaks the wrapped API anyway.

## Warranted when

- You need to use legacy or third-party code whose interface doesn't match yours, and you can't or shouldn't change it.
- Conversion code for an external API is leaking into business logic at several call sites.
- Several vendors or backends must sit behind one internal interface.

## How it shows

- A class that takes an object of a different interface in its constructor and implements the interface your code expects.
- Methods that convert arguments or data formats and then forward to the wrapped object.
- One adapter per third-party service behind a shared internal interface.

## Overdone when

- An adapter around code you own and could simply change.
- An adapter whose methods pass every call through unchanged, adding a layer that translates nothing.
- Wrapping a library "in case we switch" when no second implementation is planned.

## Example

Before:

```
fn assign_courier(order: Order):
    resp = mapvendor.lookup_address(order.street + ", " + order.city)
    point = LatLng(resp["lat_e6"] / 1e6, resp["lng_e6"] / 1e6)
    ...

fn validate_signup(form: Form):
    resp = mapvendor.lookup_address(form.address)
    if resp["status"] != "OK": raise BadAddress()
    home = LatLng(resp["lat_e6"] / 1e6, resp["lng_e6"] / 1e6)
    ...
```

After:

```
interface Geocoder:
    fn locate(address: str) -> LatLng

class MapVendorGeocoder(Geocoder):
    fn init(client: MapVendorClient): self.client = client
    fn locate(address: str) -> LatLng:
        resp = self.client.lookup_address(address)
        if resp["status"] != "OK": raise BadAddress()
        return LatLng(resp["lat_e6"] / 1e6, resp["lng_e6"] / 1e6)

fn assign_courier(order: Order, geo: Geocoder):
    point = geo.locate(order.street + ", " + order.city)
```

The vendor's call shape and units are translated in one wrapper, and business code depends only on the internal Geocoder interface.

## By language

**python:** With duck typing there's no interface to formally implement; the adapter only has to provide the methods the caller uses. Often a plain function that converts data, or a small wrapper class, is enough. A typing.Protocol can document the expected shape. Forwarding everything through __getattr__ while overriding a few methods is common but hides the adapted surface.

**typescript:** Common in TypeScript, especially for bridging legacy code or third-party SDKs to the shape the app expects. Structural typing means the adapter rarely needs a class: a function that maps one object shape to another, or an object literal implementing the target interface, is the usual form. Spotting it: A class or function takes an object of a different interface, and its methods convert arguments and forward them to that wrapped object.

**java:** Common, especially where newer code meets legacy APIs. The JDK has many examples: Arrays.asList, Collections.list and enumeration, InputStreamReader and OutputStreamWriter (bytes to characters), and JAXB's XmlAdapter. Because Java has no structural typing, an adapter class is the usual way to make a type satisfy an interface it wasn't written for. When the target is a functional interface, a lambda or method reference is often the whole adapter. Spotting it: A class implementing one interface whose constructor takes an object of a different type and whose methods translate arguments and forward to it.

**csharp:** Common in C#, especially around legacy code and third-party SDKs that need to fit an interface the application owns. Extension methods often cover the small cases, adding the expected method shape without a wrapper class, but they can't make a type implement an interface, so a real adapter class is still needed when the consumer depends on one. Spotting it: A class implementing one interface whose constructor takes an object of an unrelated type, and whose methods translate arguments and forward to that wrapped object.

**go:** Common and lightweight. Because interfaces are satisfied implicitly, an adapter is just a small struct holding the foreign value with the methods the consumer's interface asks for, and the adapted type never has to know. For single-method interfaces a named function type with a method does the job, as http.HandlerFunc turns a plain function into a Handler. Spotting it: A struct wrapping one field of another type whose methods only translate and forward, or a func type with a method that calls itself.

**rust:** A wrapper struct that owns the adaptee and implements the target trait. The orphan rule makes this the standard newtype idiom: you can't implement a foreign trait for a foreign type, so you wrap it. Conversion traits (`From`, `Into`, `AsRef`) cover the simpler case, where the data needs to change shape and the interface doesn't. Spotting it: A tuple or single-field struct around another crate's type with an `impl TheirTrait for Wrapper` that forwards to the inner value. Also look for `From` impls between equivalent types.

**cpp:** Frequent in C++, especially for wrapping legacy or C APIs so newer code can use them. C++ supports both object adapters (holding the adaptee) and class adapters (inheriting the target publicly and the adaptee privately), the latter possible because of multiple inheritance. Wrapping a C handle in an RAII class with a unique_ptr custom deleter is a very common small adapter. The standard library's stack, queue and priority_queue are container adapters. Spotting it: A class constructed from, or privately inheriting, an object of an unrelated type, whose methods translate arguments and forward to it.

## Related

[Bridge](bridge.md) · [Decorator](decorator.md) · [Proxy](proxy.md) · [Facade](facade.md)

## Sources

- [Refactoring.Guru, Adapter](https://refactoring.guru/design-patterns/adapter) (read)
- [Refactoring.Guru, Adapter in Python](https://refactoring.guru/design-patterns/adapter/python/example) (read)
- [Refactoring.Guru, Adapter in TypeScript](https://refactoring.guru/design-patterns/adapter/typescript/example) (read)
- Established TypeScript practice (structural typing, mapping functions) (recalled)
- [Refactoring.Guru, Adapter in Java](https://refactoring.guru/design-patterns/adapter/java/example) (read)
- [Refactoring.Guru, Adapter in C#](https://refactoring.guru/design-patterns/adapter/csharp/example) (read)
- C# extension methods (recalled)
- [Refactoring.Guru, Adapter in Go](https://refactoring.guru/design-patterns/adapter/go/example) (read)
- [Go standard library, net/http HandlerFunc](https://pkg.go.dev/net/http#HandlerFunc) (recalled)
- [Refactoring.Guru, Adapter in Rust](https://refactoring.guru/design-patterns/adapter/rust/example) (read)
- [Newtype idiom and the orphan rule](https://doc.rust-lang.org/book/ch20-02-advanced-traits.html) (recalled)
- [Refactoring.Guru, Adapter in C++](https://refactoring.guru/design-patterns/adapter/cpp/example) (read)
- [Container adapters (std::stack, std::queue), cppreference](https://en.cppreference.com/w/cpp/container) (recalled)
