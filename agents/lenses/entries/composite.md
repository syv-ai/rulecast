<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Composite

`composite` · design patterns, structural

Leaves and containers share one interface, so code can treat a whole tree the same way it treats a single item.

*Matters most for:* web-frontend, desktop, compilers-tooling, games, tui

## But

Only worth it when the model really is a tree. A uniform interface over very different classes can become vague, and putting add or remove methods on leaves trades type safety for uniformity (the GoF book itself discusses this transparency versus safety trade-off). Plain nested data with a recursive function is often simpler.

## Quality axes

- **change_cost** ⊕ (primary): Callers treat one item and a whole tree the same way, so the is-it-a-group checks disappear and recursion lives in one place.
- **delivery** −: A shared interface with leaf and container classes is more to write than nested data and one recursive function.

**Flips:** Forced onto flat or fixed-depth data it adds a hierarchy for nothing, and child-management methods on leaves trade compile-time safety for runtime errors.

## Warranted when

- The domain is genuinely a tree (nested UI elements, file systems, expression trees, orders containing boxes of items).
- Client code checks whether something is a single item or a group before acting on it, in several places.
- Operations such as totals, rendering or validation have to recurse through arbitrary nesting.

## How it shows

- A base type with both leaf classes and container classes, where containers hold a list of children of the base type.
- Container methods that loop over children and combine their results through the shared interface.

## Overdone when

- Forcing a flat list or a fixed two-level structure into a tree hierarchy.
- A shared interface so general that leaves must implement child-management methods that make no sense for them.

## Example

Before:

```
fn total_minutes(items: list) -> int:
    total = 0
    for item in items:
        if item is Lesson:
            total = total + item.minutes
        elif item is Module:
            total = total + total_minutes(item.children)
    return total

# publish_check(), render_outline() repeat the same Lesson/Module branching
```

After:

```
interface CourseItem:
    fn minutes() -> int

class Lesson(CourseItem):
    fn minutes() -> int: return self.length

class Module(CourseItem):
    fn init(children: list): self.children = children
    fn minutes() -> int:
        total = 0
        for child in self.children: total = total + child.minutes()
        return total

course.minutes()   # same call for a single lesson or a whole course
```

Lessons and modules share one interface, so the type checks scattered across callers disappear and recursion lives in the container.

## By language

**python:** Often nested lists or dicts plus one recursive function do the job without classes. When classes are used, containers commonly implement __iter__ so ordinary loops and comprehensions traverse children. Structural pattern matching can handle leaf and container cases in one function.

**typescript:** Common in TypeScript for UI component trees and graph-like data. Trees are often modelled as plain data with a recursive type or a discriminated union (leaf vs. group) walked by recursive functions, rather than as a class hierarchy with shared methods. Spotting it: A tree of objects sharing one interface or base class, where container nodes pass calls down to their children through that interface.

**java:** Common for UI hierarchies and tree or graph structures. Swing's Container/Component and JSF's UIComponent children are standard examples. Modern Java can model the node types as a sealed interface with records, and code can walk them with pattern-matching switch rather than putting every operation on the node classes. Spotting it: Classes in one hierarchy where a container type holds a collection of the base type and delegates operations to its children through the shared interface.

**csharp:** Shows up in C# mainly in UI control trees (WinForms Controls, WPF visual and logical trees) and graph or tree-processing code such as Roslyn syntax trees and expression trees. LINQ over a recursive child collection often removes the need for elaborate traversal methods on every node. Spotting it: Classes sharing a base class or interface where container nodes hold a collection of children of that same type and implement operations by looping over the children and calling the same method.

**go:** Natural in Go. One interface is satisfied by both leaf and container structs, and the container keeps a slice of that interface and recurses. The AST in go/ast, where statement and expression nodes hold slices of other nodes, is the standard-library example. Without inheritance there is no shared base for child management, so the add and remove methods usually live only on the container type. Spotting it: A struct with a slice of the same interface it implements, whose methods loop over the children and call the same method on each.

**rust:** Two shapes. One is a trait implemented by leaf and container, where the container holds `Vec<Box<dyn Component>>`. The other, usually more idiomatic when the node kinds are fixed, is a recursive enum (`enum Node { Leaf(..), Branch(Vec<Node>) }`) with operations written as `match`. Trees that need parent links or sharing run into ownership and turn to `Rc`/`Weak` or arena indices, so most code keeps trees strictly owned top-down. Spotting it: A struct holding `Vec<Box<dyn SameTrait>>` that implements that trait by iterating over its children, or a recursive enum with a variant containing `Vec<Self>` or `Box<Self>`.

**cpp:** Common in C++ for UI widget trees, scene graphs and graph-processing code. Parents typically own children through a vector of unique_ptr, and any back pointer to a parent is a plain non-owning pointer, avoiding shared_ptr cycles. Where the set of node kinds is closed, a std::variant tree is an alternative to the class hierarchy. Spotting it: Node classes sharing one abstract base, with a container node that holds a collection of base pointers and forwards operations to each child.

## Related

[Decorator](decorator.md) · [Iterator](iterator.md) · [Visitor](visitor.md) · [Builder](builder.md) · [Flyweight](flyweight.md) · [Chain of Responsibility](chain-of-responsibility.md) · [Prototype](prototype.md)

## Sources

- [Refactoring.Guru, Composite](https://refactoring.guru/design-patterns/composite) (read)
- [Refactoring.Guru, Composite in Python](https://refactoring.guru/design-patterns/composite/python/example) (read)
- [Refactoring.Guru, Composite in TypeScript](https://refactoring.guru/design-patterns/composite/typescript/example) (read)
- Established TypeScript practice (recursive types, discriminated unions) (recalled)
- [Refactoring.Guru, Composite in Java](https://refactoring.guru/design-patterns/composite/java/example) (read)
- Sealed interfaces and pattern matching for switch (Java 17/21) (recalled)
- [Refactoring.Guru, Composite in C#](https://refactoring.guru/design-patterns/composite/csharp/example) (read)
- WinForms/WPF control trees; Roslyn syntax trees (recalled)
- [Refactoring.Guru, Composite in Go](https://refactoring.guru/design-patterns/composite/go/example) (read)
- [Go standard library, go/ast](https://pkg.go.dev/go/ast) (recalled)
- [Refactoring.Guru, Composite in Rust](https://refactoring.guru/design-patterns/composite/rust/example) (read)
- Recursive enums and arena-based trees in Rust (recalled)
- [Refactoring.Guru, Composite in C++](https://refactoring.guru/design-patterns/composite/cpp/example) (read)
