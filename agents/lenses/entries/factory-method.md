<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Factory Method

`factory-method` · design patterns, creational

A base class calls an overridable creation method, so subclasses decide which concrete class gets built. Also called a virtual constructor.

*Matters most for:* library-sdk, plugins-extensions

## But

It ties the choice of product to inheritance, so each new product often means a new creator subclass. Passing the class or a factory function as a parameter, or injecting the dependency, usually gives the same flexibility with less coupling. Not to be confused with a simple factory function or a named alternative constructor, which are useful but are not this pattern.

## Quality axes

- **change_cost** ⊕ (primary): Subclasses or framework users swap in their own product class without editing the code that creates and uses it.
- **delivery** −: A creator hierarchy and an overridable creation hook have to be designed up front.

**Flips:** With one product, or where passing a class or factory function would do, the inheritance only adds coupling and change_cost turns "-".

## Warranted when

- Code that otherwise stays the same has to create different concrete types depending on the subclass or context.
- A library or framework must let users substitute their own component class.
- Construction is scattered across the code with type switches, and adding a type means editing every site.
- Creation needs control, such as reusing pooled or cached instances, without callers knowing.

## How it shows

- A method that creates and returns an object, declared to return an interface or base class while subclasses return concrete types.
- A framework base class that calls a create hook which users override to supply their own component.

## Overdone when

- A creator subclass per product where only one product exists.
- A static create method that only calls the constructor and adds nothing.
- Inheritance hierarchies introduced only to swap which class is instantiated, where a parameter would do.

## Example

Before:

```
class Importer:
    fn import_file(path: str, kind: str):
        if kind == "csv":
            reader = CsvReader(path)
        elif kind == "parquet":
            reader = ParquetReader(path)
        # every new format edits this framework class
        for row in reader.rows():
            self.validate(row)
            self.save(row)
```

After:

```
class Importer:
    fn create_reader(path: str) -> RowReader: abstract

    fn import_file(path: str):
        for row in self.create_reader(path).rows():
            self.validate(row)
            self.save(row)

class CsvImporter(Importer):
    fn create_reader(path) -> RowReader: return CsvReader(path)

class ParquetImporter(Importer):
    fn create_reader(path) -> RowReader: return ParquetReader(path)
```

The import loop stays in the base class and each subclass decides which reader gets built; passing the reader class in as a parameter is often the lighter alternative.

## By language

**python:** Because classes and functions are first-class, callers can pass the class or a callable to use, and no subclass is needed. Classmethod alternative constructors (from_dict, from_file) are idiomatic, but they are named constructors rather than the GoF pattern. The subclass hook form still appears in frameworks, for example a class attribute or overridable method naming which class to instantiate.

**typescript:** The subclass-overrides-a-creator form is uncommon in TypeScript; passing a creator function or a constructor type (`new () => T`) as a parameter usually replaces it. Static `create` or `from` functions on a class are common too, but they are named constructors, not this pattern. Spotting it: a base-class method that subclasses override to choose which concrete class gets made, declared to return an interface or abstract type.

**java:** The GoF form, an overridable creation hook on a base class, appears mostly in frameworks. In application code a Supplier or constructor reference passed in usually replaces it. Java is also full of static factory methods (Calendar.getInstance, NumberFormat.getInstance, Charset.forName, EnumSet.of, List.of). They are useful and can return cached instances or hidden subtypes, but they are named constructors, not this pattern; Bloch makes the same distinction. Spotting it: A protected or abstract createX method that a base class calls and subclasses override, declared to return an interface or abstract type.

**csharp:** The GoF form is a protected virtual or abstract CreateX method on a base class that subclasses override. In application code a Func<T> delegate or an injected factory interface usually replaces it, especially with a DI container. Static Create, From and Parse methods are common in .NET, but they are named constructors, not this pattern. Spotting it: a protected virtual or abstract creation method that a base class calls and subclasses override, returning an interface or abstract type.

**go:** Go has no inheritance, so there is no subclass to override a creation method. What Go does instead is the simple factory, a New... function that returns an interface value or an error. The idiom is to return the concrete type and let callers depend on their own small interfaces. Return an interface only when the concrete type should stay hidden, as crypto/hash constructors do. Spotting it: Package-level functions named New or NewX, especially ones that switch on a kind argument and return an interface plus an error.

**rust:** Without inheritance, the "creator" is a trait with a required constructor-like method, sometimes next to default methods that call it. The return type is either `Box<dyn Product>` (runtime choice) or an associated type bounded by the product trait (static dispatch). Plain associated functions such as `new`, `from_*`, and `Default`, `From` or `FromStr` impls cover most of what other languages use factory methods for. A free function or an enum match is often enough. Spotting it: A trait method that returns `Box<dyn Trait>`, `impl Trait`, or `Self::Assoc`, used by the trait's own default methods. Also look for associated functions like `from_config` that choose a concrete type.

**cpp:** Used often in C++ where code must stay extensible. The virtual creation method should return std::unique_ptr<Base>, never a raw owning pointer. Where subclassing exists only to pick a type, a template parameter, a std::function factory, or a registry map from key to creator function is the lighter idiom. Spotting it: A virtual (often pure virtual) method that constructs a concrete class with make_unique or new but declares an abstract base pointer as its return type.

## Related

[Abstract Factory](abstract-factory.md) · [Template Method](template-method.md) · [Prototype](prototype.md) · [Builder](builder.md)

## Sources

- [Refactoring.Guru, Factory Method](https://refactoring.guru/design-patterns/factory-method) (read)
- [Refactoring.Guru, Factory Method in Python](https://refactoring.guru/design-patterns/factory-method/python/example) (read)
- [Peter Norvig, Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/) (recalled)
- [Refactoring.Guru, Factory Method in TypeScript](https://refactoring.guru/design-patterns/factory-method/typescript/example) (read)
- Established TypeScript practice (creator functions, constructor types) (recalled)
- [Refactoring.Guru, Factory Method in Java](https://refactoring.guru/design-patterns/factory-method/java/example) (read)
- Effective Java (Bloch), item on static factory methods instead of constructors (recalled)
- [Refactoring.Guru, Factory Method in C#](https://refactoring.guru/design-patterns/factory-method/csharp/example) (read)
- .NET factory conventions (static Create methods, Func<T> factories in DI) (recalled)
- [Refactoring.Guru, Factory Method in Go](https://refactoring.guru/design-patterns/factory-method/go/example) (read)
- [Effective Go, Constructors and composite literals](https://go.dev/doc/effective_go#composite_literals) (recalled)
- [Refactoring.Guru, Factory Method in Rust](https://refactoring.guru/design-patterns/factory-method/rust/example) (read)
- [Rust conventions for constructors (new, From, FromStr, Default)](https://rust-lang.github.io/api-guidelines/predictability.html) (recalled)
- [Refactoring.Guru, Factory Method in C++](https://refactoring.guru/design-patterns/factory-method/cpp/example) (read)
- [C++ Core Guidelines, R.20 and I.11 (own via unique_ptr, never transfer ownership by raw pointer)](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) (recalled)
