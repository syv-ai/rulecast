<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Prototype

`prototype` · design patterns, creational

Make new objects by copying a configured existing one, with the object itself doing the copying, so the caller needn't know its class. Also called clone.

*Matters most for:* games

## But

Copying is subtle: shallow versus deep copies, shared mutable state, circular references and resources such as open files or connections all need deliberate handling. Immutable objects mostly remove the need, since they can be shared instead of copied. In Java, Cloneable is widely regarded as broken (Joshua Bloch, Effective Java), and copy constructors or factories are preferred.

## Quality axes

- **change_cost** ⊕ (primary): Code that only knows an interface can copy any object, including types added later, and preset instances replace subclasses that differed only in setup.
- **runtime** +: Copying a configured instance skips expensive setup when many near-identical objects are needed.
- **reliability** −: Shallow versus deep copies, shared mutable state and copied resource handles are easy to get wrong and cause bugs far from the copy.

**Flips:** Immutable objects can just be shared, so cloning them adds risk for nothing; hand-written clones on classes nothing copies polymorphically are pure upkeep.

## Warranted when

- Code must duplicate objects it only knows through an interface, such as objects handed over by other code.
- Many subclasses exist only to differ in how they are initialized; preset instances could replace them.
- Setting up an object is expensive or complicated, and many near-identical copies are needed.

## How it shows

- Classes with a clone or copy method from a shared interface.
- A registry of preconfigured objects that are copied on demand instead of being built from scratch.

## Overdone when

- A hand-written clone method on every class when nothing ever copies objects polymorphically.
- Cloning used to dodge writing a clear constructor.

## Example

Before:

```
fn duplicate_rule(rule: AlertRule) -> AlertRule:
    # the "Duplicate" button has to know every rule class and its fields
    if rule is ThresholdRule:
        return ThresholdRule(rule.metric, rule.limit, rule.window, rule.severity)
    if rule is AnomalyRule:
        return AnomalyRule(rule.metric, rule.model_id, rule.sensitivity,
                           rule.training_days, rule.severity)
    raise UnsupportedRule(rule)
```

After:

```
interface AlertRule:
    fn clone() -> AlertRule
    ...

class ThresholdRule(AlertRule):
    fn clone() -> AlertRule:
        return ThresholdRule(self.metric, self.limit, self.window, self.severity)

fn duplicate_rule(rule: AlertRule) -> AlertRule:
    return rule.clone()
```

Each rule copies itself, so code that only knows the AlertRule interface can duplicate any rule, including ones added later.

## One-file tell

In Python, a hand-written clone method that copies fields one by one where copy.copy, copy.deepcopy or dataclasses.replace would do.

## By language

**python:** The standard copy module (copy and deepcopy, customizable with __copy__ and __deepcopy__) is the built-in form, so a custom clone method is rarely needed. For dataclasses, dataclasses.replace makes a modified copy. Because classes are values, a "prototype registry" is often just a dict of classes or partial functions.

**typescript:** Copying needs no library: spread or Object.assign for shallow copies of plain objects, and `structuredClone` for deep copies of plain data. Don't confuse the pattern with JavaScript's prototype chain: `Object.create(obj)` makes an object that delegates to obj, not a copy of it. A hand-written `clone` method is mainly worth it for class instances, since spread and `structuredClone` drop methods and the class identity. Spotting it: A class that exposes a `clone` or `copy` method returning a new instance of itself.

**java:** Built into the language through Cloneable and Object.clone, but that mechanism is widely regarded as broken: clone makes a shallow copy, bypasses constructors, and works badly with final fields. Idiomatic Java uses a copy constructor or a static copy factory instead, and immutable objects and records often make copying unnecessary. Spotting it: A class implementing Cloneable and overriding clone, or a copy() method or copy constructor that takes an instance of its own type.

**csharp:** The base library has ICloneable for this, but its Clone returns object and doesn't say whether the copy is deep or shallow, so .NET design guidance advises against exposing it in public APIs. Object.MemberwiseClone gives a cheap shallow copy to build on. Records make the pattern largely built in: a `with` expression copies the record and changes chosen members, which covers most prototype use for immutable data. Spotting it: Methods named Clone, Copy or DeepCopy, often implementing ICloneable or calling MemberwiseClone; for records, `with` expressions deriving new instances from existing ones.

**go:** Rarely named, since assigning a struct value already makes a shallow copy. The pattern matters when a struct holds slices, maps or pointers that the copy would otherwise share. Then a Clone method does the deep copy, and the standard library has such methods, for example on http.Request and tls.Config. The slices.Clone and maps.Clone helpers cover the simple cases. Spotting it: A Clone or Copy method that returns the same type or an interface, often copying slices and maps field by field.

**rust:** The language has it built in: the `Clone` trait, usually derived, is the Prototype interface, and a hand-written prototype hierarchy is almost never justified. `Clone` is not object-safe, so cloning through a `Box<dyn Trait>` needs a helper method that returns a boxed clone, or the `dyn-clone` crate. A cheap shared copy is `Rc`/`Arc` cloning, which shares the data instead of duplicating it. Spotting it: `#[derive(Clone)]` with `.clone()` calls on a template value. For trait objects, look for a `clone_box` method or `dyn_clone`.

**cpp:** C++ copy constructors copy concrete types well, but cannot copy through a base-class pointer, which is the gap Prototype fills: a virtual clone returning unique_ptr<Base>. Copying a polymorphic object by value slices it, so the Core Guidelines advise suppressing public copy in polymorphic bases and offering a virtual clone instead. CRTP is a common way to avoid writing the same clone body in every subclass. Spotting it: A virtual clone (or copy) member returning a smart pointer to the base class, usually implemented by calling the derived type's copy constructor.

## Related

[Factory Method](factory-method.md) · [Abstract Factory](abstract-factory.md) · [Composite](composite.md) · [Decorator](decorator.md) · [Memento](memento.md) · [Command](command.md)

## Sources

- [Refactoring.Guru, Prototype](https://refactoring.guru/design-patterns/prototype) (read)
- [Refactoring.Guru, Prototype in Python](https://refactoring.guru/design-patterns/prototype/python/example) (read)
- [Joshua Bloch, Effective Java, item on overriding clone](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/) (recalled)
- [Refactoring.Guru, Prototype in TypeScript](https://refactoring.guru/design-patterns/prototype/typescript/example) (read)
- Established TypeScript practice (structuredClone, spread, class identity loss) (recalled)
- [Refactoring.Guru, Prototype in Java](https://refactoring.guru/design-patterns/prototype/java/example) (read)
- Effective Java (Bloch), item on overriding clone judiciously (recalled)
- [Refactoring.Guru, Prototype in C#](https://refactoring.guru/design-patterns/prototype/csharp/example) (read)
- .NET Framework Design Guidelines on ICloneable; C# records and with expressions (recalled)
- [Refactoring.Guru, Prototype in Go](https://refactoring.guru/design-patterns/prototype/go/example) (read)
- [Go standard library, net/http Request.Clone](https://pkg.go.dev/net/http#Request.Clone) (recalled)
- [Refactoring.Guru, Prototype in Rust](https://refactoring.guru/design-patterns/prototype/rust/example) (read)
- Object safety of Clone and the dyn-clone crate (recalled)
- [Refactoring.Guru, Prototype in C++](https://refactoring.guru/design-patterns/prototype/cpp/example) (read)
- [C++ Core Guidelines, C.67 and C.130 (polymorphic copy via virtual clone)](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) (recalled)
