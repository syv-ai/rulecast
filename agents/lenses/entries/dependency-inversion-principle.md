<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Dependency Inversion Principle (DIP)

`dependency-inversion-principle` · principles, design · **contested**

High-level policy should not depend on low-level details; both should depend on abstractions, and the abstraction belongs to the policy side. The business code says what it needs (a way to store an order), and the database code implements that.

*Names:* Robert C. Martin, The Dependency Inversion Principle (1996). The D in SOLID. Not the same as dependency injection, which is one way to supply the implementation.

*Matters most for:* web-api, fullstack-web, library-sdk

## But

Every inverted dependency adds an interface and a place to wire it, and with one implementation and fakes available that cost often buys nothing. Many projects never swap their database, and modern test tooling can run real infrastructure cheaply. Apply it at the boundaries that matter (the domain against storage, messaging and vendors), not between every pair of classes.

## Quality axes

- **change_cost** ⊕ (primary): Business rules are tested without a database or network, and storage or vendors can change without touching the policy code.
- **delivery** −: Each inverted dependency adds an interface owned by the policy side and a place to wire the implementation.

**Flips:** An interface in front of every class, with one implementation and no test that needs a double, buys nothing, and change_cost turns "-" from the indirection.

## Warranted when

- Business rules that must outlive a framework, database or vendor.
- Several implementations of one need (production, test, another vendor).
- Slow or flaky tests caused by infrastructure in the middle of business logic.

## How it shows

- Domain or service code that imports a database driver, HTTP client or SDK directly.
- Interfaces defined next to their one implementation in the infrastructure layer, so the domain still imports the infrastructure package.
- Tests of business rules that need a real database or network.

## Overdone when

- An interface in front of every class, including ones with no second implementation and no test that needs one.
- Abstractions over the standard library or the language runtime.

## Example

Before:

```
# orders/service.py
import psycopg

fn place_order(cart):
    order = price(cart)
    with psycopg.connect(DSN) as db:
        db.execute("insert into orders ...", order)
    return order
```

After:

```
# orders/service.py
interface OrderStore:
    fn add(order)

fn place_order(cart, store: OrderStore):
    order = price(cart)
    store.add(order)
    return order

# adapters/postgres.py implements OrderStore
```

The orders module no longer imports the driver; the Postgres code depends on the interface the orders module owns.

## By language

**python:** A Protocol owned by the domain module, implemented in an adapters module, is enough; a DI framework is rarely needed.

**typescript:** Constructor or function parameters typed with an interface from the domain folder; watch the import direction rather than the presence of interfaces.

**java:** Spring wires implementations easily, which hides whether the interface lives on the right side; check which package owns it.

**csharp:** As in Java with the built-in container; an interface in the Infrastructure project used by Domain is the inversion done backwards.

**go:** Consumer-defined interfaces give this by default: the package that needs a store declares the interface, and the database package never knows.

## Related

[SOLID](solid.md) · [The Dependency Rule](dependency-rule.md) · [Ports and Adapters](ports-and-adapters.md) · [Dependency Injection](dependency-injection.md) · [Infrastructure Ignorance](infrastructure-ignorance.md)

## Overlaps

dependency-rule is the principle (dependencies point toward policy). dependency-inversion-principle is the same idea at the scale of one dependency: the interface belongs to the code that needs it, which is how a single import is made to point inward. ports-and-adapters is the architecture built on both, and layered-architecture the older style it corrects, where the domain depends on persistence.

## Sources

- [Robert C. Martin, The Dependency Inversion Principle, C++ Report (1996)](https://web.archive.org/web/20060822033314/http://www.objectmentor.com/resources/articles/dip.pdf) (recalled)
- [Robert C. Martin, Agile Software Development, Principles, Patterns, and Practices (2002)](https://www.oreilly.com/library/view/agile-software-development/0135974445/) (recalled)
