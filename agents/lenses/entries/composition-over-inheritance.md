<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Composition over Inheritance

`composition-over-inheritance` · principles, design

Get reuse and variation by giving an object other objects to delegate to, rather than by subclassing. Inheritance ties a subclass to its parent's internals; composition lets you combine and swap parts, including at runtime.

*Names:* Stated by the Gang of Four (Gamma, Helm, Johnson, Vlissides) in Design Patterns (1994), as their second principle of object-oriented design. Joshua Bloch's Effective Java has it as Favor composition over inheritance (item 18 in the 3rd ed.). The fragile base class problem is the failure it guards against.

*Matters most for:* library-sdk, plugin-host, games

## But

Inheritance is fine for a real is-a relation with a stable parent designed for extension, for abstract classes that provide a template with a few hooks, and where a framework expects it (UI widgets, test base classes, exception hierarchies). Composition costs forwarding code and indirection, and in languages without delegation support that boilerplate is real. The GoF themselves used inheritance throughout their patterns; the principle says favour, not forbid. Bloch's advice is to design and document classes for inheritance or prohibit it.

## Quality axes

- **change_cost** ⊕ (primary): Variations combine and swap without a subclass per combination, and a parent class change can't break subclasses that relied on its internals.
- **delivery** −: Collaborators have to be wired in and methods forwarded, which is real boilerplate in languages without delegation support.

**Flips:** For a real is-a relation with a stable parent, or a framework that expects you to subclass, composition is forwarding code and indirection only.

## Warranted when

- Variation along two or more axes, which inheritance turns into one subclass per combination.
- A subclass inherits methods it doesn't want (Refused Bequest).
- A parent class change breaks subclasses that relied on its internals (fragile base class).
- Behaviour needs to change at runtime or be configured per instance.

## How it shows

- Deep class hierarchies, or subclasses named for combinations (CompressedEncryptedCsvExporter).
- Subclasses that override a method only to switch off or replace parent behaviour.
- Base classes named Base or Abstract that collect shared helpers for unrelated subclasses.
- After the change, objects holding small collaborators passed in through the constructor (strategies, decorators, policies).

## Overdone when

- Wrapping and forwarding every method of a type to avoid a subclass that is a real is-a relation.
- Composing tiny single-method objects for a hierarchy of two classes that will never grow.
- Rejecting framework base classes that the framework expects you to extend.

## Example

Before:

```
class ReportExporter:
    fn export(rows): ...
class CsvExporter extends ReportExporter: ...
class GzipCsvExporter extends CsvExporter: ...
class EncryptedGzipCsvExporter extends GzipCsvExporter: ...
class JsonExporter extends ReportExporter: ...
class GzipJsonExporter extends JsonExporter: ...
# adding encryption to JSON means another subclass
```

After:

```
class ReportExporter:
    format: Format              # Csv() or Json()
    steps: list                 # e.g. [Gzip(), Encrypt(key)]
    fn export(rows) -> bytes:
        data = format.write(rows)
        for step in steps: data = step.apply(data)
        return data

exporter = ReportExporter(Json(), [Gzip(), Encrypt(key)])
```

Format and post-processing vary independently, so any combination is a constructor call instead of a new subclass.

## By language

**python:** Mixins and multiple inheritance are common in frameworks (Django class-based views), and the method resolution order makes deep hierarchies hard to follow. Protocols let you type a composed collaborator without a base class.

**typescript:** Classes support single inheritance only; composing objects, passing functions, and React's preference for composition over component inheritance are the norm.

**java:** Bloch's item is the standard reference. Final classes by default, interfaces with default methods, and delegation are the tools; extending concrete library classes such as HashSet is his classic example of the fragile base class.

**csharp:** Many teams seal application and internal classes not designed for inheritance (analyzer CA1852 suggests it for internal types), though the Framework Design Guidelines advise against sealing public library classes without a reason. Interfaces with default implementations and dependency injection make composition the usual shape.

**go:** Go has no inheritance. Struct embedding promotes the inner type's methods, which looks like inheritance but is composition: there is no virtual dispatch back to the outer type.

**rust:** Rust has no implementation inheritance. Traits with default methods and generic or boxed fields give reuse and variation; supertraits express is-a at the interface level only.

## Related

[Refused Bequest](refused-bequest.md) · [Parallel Inheritance Hierarchies](parallel-inheritance-hierarchies.md) · [Strategy](strategy.md) · [Decorator](decorator.md) · [Template Method](template-method.md) · [Liskov Substitution Principle (LSP)](liskov-substitution-principle.md)

## Sources

- [Gamma, Helm, Johnson and Vlissides, Design Patterns (1994), ch. 1](https://www.oreilly.com/library/view/design-patterns-elements/0201633612/) (recalled)
- [Joshua Bloch, Effective Java (3rd ed., 2018), item 18](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/) (recalled)
