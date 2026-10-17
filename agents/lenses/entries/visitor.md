<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Visitor

`visitor` · design patterns, behavioral · **contested**

Keep operations in separate visitor objects that walk a structure of mixed element types, so new operations don't touch the element classes (double dispatch).

*Matters most for:* compilers-tooling, cli-devtool, plugin-host

## But

It trades one axis of change for another (the expression problem): adding operations is easy, adding element types means changing every visitor. Use it only when the types are stable and operations grow. Visitors can't reach the elements' private state. In languages with sum types and pattern matching (Rust, Scala, modern Java, Python match) a function with a match usually replaces it. The source itself says it is rarely used because it is complex and fits narrow cases.

## Quality axes

- **change_cost** ⊕ (primary): A new operation over a stable set of node types is one new visitor, with the node classes untouched.
- **delivery** −: Accept methods on every element and a visit method per type are more to write than a function with a match.

**Flips:** When element types change often, every new type means editing every visitor, turning change_cost "-"; with sum types and pattern matching a single match does the job.

## Warranted when

- A stable set of element types in a tree or graph needs a growing number of operations over it
- Unrelated logic (export, pretty-printing, validation) is piling up in core data classes
- An operation applies to only some of the element types in a hierarchy
- An operation needs to accumulate state while it walks the structure

## How it shows

- visit_<Type> methods on visitor classes and accept(visitor) methods on element classes
- A tree of node types (syntax tree, document model, scene graph) with several operations run over it
- Export, render or analysis logic living in visitor classes rather than in the nodes

## Overdone when

- A visitor over a structure with one or two element types
- A visitor where the element types change often, so every new type means editing every visitor
- Double dispatch in a language with pattern matching or type-based dispatch built in

## Example

Before:

```
class Compare:    # node in a discount-rule expression tree
    field: str; op: str; value: any
    fn evaluate(cart) -> bool: ...
    fn to_sql() -> str: ...
    fn explain() -> str: ...
    fn lint() -> list: ...    # of Warning; added for the rule editor
class And:
    left: Rule; right: Rule
    fn evaluate(cart): return self.left.evaluate(cart) and self.right.evaluate(cart)
    fn to_sql(): ...
    fn explain(): ...
    fn lint(): ...
# Or and Not repeat all four; every new operation edits every node class
```

After:

```
class Compare:
    fn accept(v: RuleVisitor): return v.visit_compare(self)
class And:
    fn accept(v: RuleVisitor): return v.visit_and(self)

class SqlWriter implements RuleVisitor:
    fn visit_compare(n): return n.field + " " + n.op + " " + quote(n.value)
    fn visit_and(n): return "(" + n.left.accept(self) + " AND " + n.right.accept(self) + ")"
    ... # visit_or, visit_not
# Evaluator, Explainer and Linter are further visitors; the node classes stay put

sql = rule.accept(SqlWriter())
```

Operations move out of the stable node classes into visitors, so a new operation is one new class; with pattern matching, one function with a match does the same.

## One-file tell

Element classes that each define accept(self, visitor) whose body only calls a matching visitor.visit_<Name> method.

## By language

**python:** Often a method lookup by type name (getattr for visit_ + class name), as in the standard library's ast.NodeVisitor, or functools.singledispatch, or a match statement over node classes, rather than accept methods on every element.

**typescript:** Uncommon, since it is complex and fits few problems. In TypeScript, a discriminated union plus an exhaustive `switch`, or a handler map keyed by the discriminant, does what double dispatch does, and the compiler flags missing cases. AST tooling is where the visitor idea survives, but in callback form rather than `accept` methods: the TypeScript compiler API walks nodes with `ts.forEachChild`/`ts.visitEachChild` and a switch on `node.kind`, and Babel's visitors are handler maps keyed by node type.

**java:** Uncommon because it is complex and narrow, but present in the JDK: the javax.lang.model element, type and annotation-value visitors for annotation processors, and FileVisitor/SimpleFileVisitor for Files.walkFileTree. Java uses accept/visit for double dispatch because it has only single dispatch. Since Java 21, sealed hierarchies with exhaustive pattern-matching switch replace most new visitors. Spotting it: An interface with one visit method overload per element type, and element classes with an accept(visitor) method that calls back visitor.visit(this).

**csharp:** Uncommon in C# because it is complex and fits a narrow set of problems. Where it does appear is over syntax and expression trees: Roslyn's CSharpSyntaxVisitor and System.Linq.Expressions.ExpressionVisitor. Pattern matching with switch expressions over a closed type hierarchy often replaces it, and `dynamic` dispatch is sometimes used as a shortcut for double dispatch at a runtime cost. Spotting it: An Accept(visitor) method on each element type calling back a type-specific Visit method, or classes deriving from a framework visitor base and overriding VisitX methods.

**go:** Go has no method overloading, so a visitor interface needs one distinctly named method per element type. Many Go programs skip the double dispatch and use a type switch over the element interface, which is shorter but loses the compile-time check for unhandled types. Tree walkers such as ast.Walk and ast.Inspect take a visitor function or a single Visit method instead. Spotting it: An interface with VisitX methods for each element and Accept methods on the elements, or a function with a large type switch over an interface's concrete types.

**rust:** serde is the flagship case: a `Visitor` trait with an associated `Value` type and many default methods that return errors, driven by a `Deserializer`, all through generics with static dispatch. `syn::visit` and compiler AST walkers are others. For your own closed set of types, a `match` over an enum usually replaces Visitor, because adding an operation is just a new function. Visitor is worth it mainly when a library must let outside code define operations over its data model. Spotting it: A trait with many `visit_*` methods (often with defaults) and an associated output type, plus `accept`/`walk_*`/`deserialize_*` functions that call them for each node.

**cpp:** Not widely used, since its complexity limits where it fits. Classic Visitor exists in C++ to get double dispatch, which the language lacks. Since C++17, a std::variant over the element types plus std::visit with an overloaded set of lambdas covers most cases with far less code, at the cost of a closed set of types. Spotting it: Element classes with an accept method taking a visitor, which calls back the visitor's overload for that element type; or std::visit applied to a variant with an overload set. The page gives no identification note.

## Related

[Composite](composite.md) · [Iterator](iterator.md) · [Command](command.md)

## Sources

- [Refactoring.Guru, Design Patterns: Visitor](https://refactoring.guru/design-patterns/visitor) (read)
- [Refactoring.Guru, Visitor in Python](https://refactoring.guru/design-patterns/visitor/python/example) (read)
- [Refactoring.Guru, Visitor in TypeScript](https://refactoring.guru/design-patterns/visitor/typescript/example) (read)
- Established TypeScript practice (discriminated unions, AST visitors) (recalled)
- [Refactoring.Guru, Visitor in Java](https://refactoring.guru/design-patterns/visitor/java/example) (read)
- JEP 441, pattern matching for switch (Java 21) (recalled)
- [Refactoring.Guru, Visitor in C#](https://refactoring.guru/design-patterns/visitor/csharp/example) (read)
- Roslyn CSharpSyntaxVisitor; System.Linq.Expressions.ExpressionVisitor (recalled)
- [Refactoring.Guru, Visitor in Go](https://refactoring.guru/design-patterns/visitor/go/example) (read)
- [Go standard library, go/ast Inspect](https://pkg.go.dev/go/ast#Inspect) (recalled)
- [Refactoring.Guru, Visitor in Rust](https://refactoring.guru/design-patterns/visitor/rust/example) (read)
- [Rust Design Patterns, Visitor; syn::visit](https://rust-unofficial.github.io/patterns/patterns/behavioural/visitor.html) (recalled)
- [Refactoring.Guru, Visitor in C++](https://refactoring.guru/design-patterns/visitor/cpp/example) (read)
- [std::visit, cppreference](https://en.cppreference.com/w/cpp/utility/variant/visit) (recalled)
