<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Factory (DDD)

`factory-ddd` · design patterns, design

An object or method whose job is to create a whole aggregate, or a complex value object, in a valid state in one step, so callers don't assemble its parts and can't produce a half-built one. Not the GoF patterns abstract-factory or factory-method, which are about choosing which class to instantiate.

*Names:* Also called Factory (Evans), Aggregate factory. Eric Evans, Domain-Driven Design (2003), ch. 6, alongside Aggregates and Repositories. The GoF's Abstract Factory and Factory Method (1994) are separate catalog entries.

*Matters most for:* web-api, fullstack-web

## But

A constructor is a factory; most objects need nothing more. A separate factory pays only when assembly is complex, crosses objects, or must hide internal classes. In languages with named constructors or module-level functions, a static create method or a NewX function is the idiomatic factory, and a Factory class is ceremony. It also overlaps Builder for complex value objects; Evans himself suggests a builder can assemble the parts.

## Quality axes

- **reliability** ⊕ (primary): An aggregate is created complete and valid in one step, so a half-built one with a skipped invariant can't exist.
- **change_cost** +: Callers don't know the aggregate's internal classes or assembly steps, so those can change behind the factory.
- **delivery** −: A separate creation path, plus a reconstitution path for loading from storage, is extra code.

**Flips:** For objects with few fields and no invariants a constructor already is the factory, and a factory class is ceremony.

## Warranted when

- Creating an aggregate takes several steps (root, children, defaults, ownership), and callers copy those steps and sometimes skip one.
- Invariants must hold from the first moment, such as every workspace having an owner.
- Callers would otherwise need to know the internal classes of the aggregate.
- Rebuilding from the database must not re-validate or re-announce creation.

## How it shows

- A create or new method on the aggregate root, a standalone factory class, or a method on another aggregate (project.start_task()), returning a complete aggregate.
- All invariants checked at creation, so the constructor of parts is not public to callers.
- A separate reconstitution path used by the repository to rebuild an aggregate from storage without re-running creation rules or raising creation events.

## Overdone when

- A WidgetFactory class whose only method calls the constructor.
- Factories for objects with two fields and no invariants.
- A factory class hierarchy mirroring the aggregate hierarchy when one function would do.

## Example

Before:

```
# in three different handlers
ws = Workspace(name)
board = Board("Main")
for col in ["To do", "Doing", "Done"]: board.columns.append(Column(col))
ws.boards.append(board)
ws.members.append(Membership(user_id, ADMIN))     # one handler forgot this line
workspaces.save(ws)
```

After:

```
class Workspace:
    fn create(name: str, owner: UserId, template: Template) -> Workspace:
        ws = Workspace(name)
        ws.members.append(Membership(owner, ADMIN))
        ws.boards.append(Board.from_template(template))
        return ws

    fn reconstitute(row) -> Workspace: ...      # used by the repository, no checks re-run

# handlers
workspaces.save(Workspace.create(name, user_id, DEFAULT_TEMPLATE))
```

Creation of the whole aggregate has one home that guarantees an owner and a board, unlike a GoF factory, which is about choosing a concrete class.

## By language

**python:** A classmethod (Workspace.create(...)) is the usual form; a standalone factory class is rarely needed.

**typescript:** A static create method with a private constructor, returning the aggregate or a result type for validation failures.

**java:** A static factory method on the root with a package-private constructor; Bloch's static factory advice applies. Note that JPA needs a no-arg constructor, which can be protected to keep callers out.

**csharp:** A static Create method with a private constructor; EF Core can use the private constructor for reconstitution.

**go:** A NewX function returning (X, error) is the factory; reconstitution often gets its own function so it skips creation checks.

**rust:** An associated function (new or a domain-named one) returning Result<Self, Error>; private fields stop anyone building the struct literally from outside the module.

## Related

[Abstract Factory](abstract-factory.md) · [Factory Method](factory-method.md) · [Builder](builder.md) · [Aggregate](aggregate.md) · [Value Object](value-object.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Factories](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 6](https://www.domainlanguage.com/ddd/) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 11 (recalled)
