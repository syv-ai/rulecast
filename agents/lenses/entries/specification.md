<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Specification

`specification` · design patterns, design · **contested**

A business rule packaged as an object with one question, "is this candidate satisfied?", so the rule has a name, can be combined with and, or and not, and can be reused for validation, selection and building.

*Names:* Also called Specification pattern. Eric Evans and Martin Fowler, the paper Specifications (1997), then Evans's Domain-Driven Design (2003), ch. 9 and 10. The 2015 DDD Reference mentions it only in passing, under Declarative Design.

*Matters most for:* web-api, fullstack-web

## But

Genuinely contested in practice. As an in-memory predicate it is cheap and clear. As a query it leaks: turning an object tree into SQL needs an expression-tree library or a parallel query version of each rule, and the pair can drift. Even its advocates, such as Vladimir Khorikov, warn against the generic forms (a specification that only wraps a caller's lambda, or repositories returning IQueryable), and many teams prefer named query methods on the repository or plain query objects. In languages with first-class functions a named predicate function gives most of the benefit with no class hierarchy. Reach for it when one rule must serve validation and selection, or when rules are combined at run time.

## Quality axes

- **change_cost** ⊕ (primary): A business rule has one name and definition shared by validation, selection and building, combined with and, or and not, so copies can't drift.
- **delivery** −: A class per rule plus combinators, and a query form to run it against the database, is more to build than a predicate.

**Flips:** For a one-off condition it is ceremony; as a generic query builder it hides the database without domain meaning, and a parallel query version of each rule drifts.

## Warranted when

- The same business rule is written out in a query, a validation and an if-statement, and the copies drift.
- Rules are combined in many ways, and each combination becomes its own method.
- Domain experts name the rule ("eligible", "at risk") and it deserves a name in code.

## How it shows

- Small classes or functions named after a rule (OverdueInvoice, EligibleForPromotion) with an is_satisfied_by method.
- and, or, not combinators that build bigger rules from small ones.
- A repository method that takes a specification instead of a dozen find_by variants.

## Overdone when

- A specification class for a one-off condition used in one place.
- A generic repository plus specification framework used as a query builder, which hides the database without adding domain meaning.
- Deep trees of composite specifications that are harder to read than the boolean they replace.

## Example

Before:

```
fn eligible_staff_query():
    return "SELECT * FROM staff WHERE tenure_months >= 18 AND last_review >= 'meets' AND NOT on_notice"

fn can_nominate(employee) -> bool:
    return employee.tenure_months >= 18 and employee.last_review >= MEETS

fn badge(employee) -> str:
    if employee.tenure_months >= 12 and employee.last_review >= MEETS and not employee.on_notice:
        return "eligible"            # third copy, already drifted to 12 months
```

After:

```
class EligibleForPromotion(Specification):
    fn is_satisfied_by(e: Employee) -> bool:
        return e.tenure_months >= 18 and e.last_review >= MEETS

eligible = EligibleForPromotion().and_(OnNotice().not_())

fn can_nominate(employee) -> bool: return eligible.is_satisfied_by(employee)
fn badge(employee) -> str: return "eligible" if eligible.is_satisfied_by(employee) else ""
fn eligible_staff(): return staff_repository.matching(eligible)
```

The rule has one name and one definition, combined explicitly, and the repository translates it for the query, so the three uses can't drift apart.

## By language

**csharp:** Ardalis.Specification is widely used and builds EF Core queries from specification objects. Expression<Func<T,bool>> lets one rule run both in memory and as SQL, which is the C# answer to the leak.

**java:** Spring Data JPA's Specification<T> is a query-building interface over the Criteria API; it composes with and and or, but it is a query tool rather than Evans's in-memory rule object.

**python:** A named predicate function, or a small class with __and__ and __or__, is the common form. SQLAlchemy expressions can serve as the query side.

**typescript:** A typed predicate function ((x: T) => boolean) composed with helper functions is usually enough; a class hierarchy is rare.

**go:** A func(T) bool type with And and Or helpers covers the in-memory case; query building stays with the repository.

**rust:** Closures or a trait with is_satisfied_by and combinator structs; closures are the common choice.

## Related

[Strategy](strategy.md) · [Composite](composite.md) · [Duplicate Code](duplicate-code.md) · [Over-Engineering](over-engineering.md)

## Sources

- [Eric Evans and Martin Fowler, Specifications (1997)](https://martinfowler.com/apsupp/spec.pdf) (recalled)
- [Eric Evans, Domain-Driven Design (2003), ch. 9 and 10](https://www.domainlanguage.com/ddd/) (recalled)
- [Eric Evans, Domain-Driven Design Reference (2015), Declarative Design (passing mention only)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Vladimir Khorikov, Specification pattern: C# implementation (2016)](https://enterprisecraftsmanship.com/posts/specification-pattern-c-implementation/) (read)
