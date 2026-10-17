<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Variant drift (parallel implementations out of step)

`variant-drift` · smells, design · **agents do this**

Several implementations of the same thing that must change together, such as one query module per database dialect, one renderer per platform or one code path per product edition, and a change made to one variant alone leaves the others behind.

*Names:* A plain practitioners' name; no single coiner. Teams also say "feature parity" or "dialect drift". Fowler's Shotgun Surgery and Parallel Inheritance Hierarchies (Refactoring, 1999) describe the same edit-in-many-places shape, but their remedy is to merge, which doesn't fit variants that differ for real reasons. The established remedy is a conformance suite run against every variant: Java's TCKs, and the shared test suites that SQLAlchemy and Django run against each database backend.

*Matters most for:* databases-storage, mobile, desktop, platforms, fullstack-web

## But

Some variants are meant to diverge: a paid edition with extra features, or a platform version that follows its own platform's conventions, needs parity only on the shared contract. A variant that is experimental or being retired isn't worth holding to parity. With two variants that rarely change, a shared suite may cost more than the occasional drift it catches. Where most of the code turns out to be the same, Shotgun Surgery's remedy (give the shared part one home) comes before any test suite.

## Quality axes

- **delivery** +: Copying the first variant to make the second ships fastest.
- **reliability** −: A fix applied to one variant leaves the bug in the others, and a missing operation fails only when that variant runs.
- **change_cost** −: Each change has to be repeated and verified in every variant, with nothing pointing out which one was missed.

**Flips:** Variants meant to diverge (a paid edition, a platform following its own conventions, a retiring backend) need parity only on the shared contract.

## Why people fall into it

- The variants differ for real reasons (SQL dialects, platform APIs), so they can't simply be merged.
- The second variant was made by copying the first, with no shared interface to keep them aligned.
- Developers run one variant locally, so the others only fail in CI or in production.
- In dynamically typed code nothing says a variant is missing an operation until it is called.
- Each edit is made by someone, or an agent, looking only at the variant in front of them.

## How it shows

- Modules with the same exported names side by side (postgres_store and sqlite_store, ios and android renderers), each hundreds of lines long.
- An operation present in one variant and missing, or different, in another.
- Bug-fix commits that touch one variant when the bug applies to all of them.
- Tests that cover one variant well and the others thinly, or a CI job that runs only the default one.
- An edition or mode flag (cloud versus self-hosted) read in many files, each with its own branch.

## Overcorrecting looks like

- Merging the variants into one module that branches on the dialect or platform everywhere (Switch Statements).
- A lowest-common-denominator interface that forbids using any variant's strengths.
- Demanding identical behaviour where variants legitimately differ, such as result order, float precision or platform look and feel.

## What to do

Give every variant one interface, so a missing operation fails at compile or load time. Run one shared test suite against every variant (a contract test, parametrised over the implementations), and run it for all of them in CI. Keep logic that doesn't depend on the variant in shared code, and push only the real differences into the variants (Strategy, Template Method).

## Example

Before:

```
# postgres_store.py
fn low_stock(db, threshold) -> list:
    return db.query("SELECT sku FROM items
                     WHERE qty < $1 AND archived = false", threshold)
# sqlite_store.py
fn low_stock(db, threshold) -> list:
    return db.query("SELECT sku FROM items WHERE qty < ?", threshold)
    # the archived fix went into postgres_store only

# test_postgres_store.py tests low_stock; nothing tests sqlite_store
```

After:

```
interface StockQueries:
    fn low_stock(threshold) -> list
    ...

# test_stock_queries.py, run once per implementation
for store in [PostgresStore(test_pg), SqliteStore(test_sqlite)]:
    add_item(store, "A1", qty = 2, archived = true)
    add_item(store, "B2", qty = 2, archived = false)
    assert store.low_stock(5) == ["B2"]
```

Each dialect keeps its own SQL, but both answer to one interface and one suite, so a fix to one that the other lacks fails a test.

## By language

**python:** A typing.Protocol checked by a type checker, or an abstract base class that fails at instantiation, catches a missing operation; a pytest fixture parametrised over the backends runs the same tests against each.

**typescript:** Typing each dialect module's export object against one interface (satisfies StoreQueries) makes a missing or mismatched function a compile error.

**go:** A compile-time assertion such as var _ Store = (*pgStore)(nil) checks each variant against the interface; a table of implementations in one test runs the same cases on each.

**rust:** One trait per contract, and a generic test function or macro instantiated for each implementation.

**java:** An abstract test class with the shared cases and one subclass per implementation is the classic form, and a TCK is the published version.

**csharp:** An abstract test class, or xUnit's [Theory] with one data row per implementation, runs the shared cases against each.

## Related

[Shotgun Surgery](shotgun-surgery.md) · [Parallel Inheritance Hierarchies](parallel-inheritance-hierarchies.md) · [Contract Test](contract-test.md) · [Duplicate Code](duplicate-code.md) · [DRY (Don't Repeat Yourself)](dry.md) · [Liskov Substitution Principle (LSP)](liskov-substitution-principle.md) · [Strategy](strategy.md)

## Sources

- [Martin Fowler, Refactoring (1st ed., 1999), ch. 3, Shotgun Surgery and Parallel Inheritance Hierarchies](https://martinfowler.com/books/refactoring.html) (recalled)
- [Martin Fowler, bliki, ContractTest](https://martinfowler.com/bliki/ContractTest.html) (recalled)
- [SQLAlchemy documentation, the dialect test suite for third-party dialects (sqlalchemy.testing.suite)](https://github.com/sqlalchemy/sqlalchemy/blob/main/README.dialects.rst) (recalled)
