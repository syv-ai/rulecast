<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Test Data Builder

`test-data-builder` · design patterns, testing

Build the objects a test needs through a builder that fills every field with a safe default, so each test sets only the fields that matter to it and reads as what makes the case special.

*Names:* Named by Nat Pryce (2007) as an alternative to the Object Mother, and covered in Freeman and Pryce's Growing Object-Oriented Software. Object Mother was named at ThoughtWorks (Schuh and Punke). Meszaros's nearby patterns are Creation Method and Parameterized Creation Method.

*Matters most for:* web-api, fullstack-web

## But

Defaults move information out of the test, and a test that silently relies on a default is harder to read than one that spells out its data. State in the test every value the assertion depends on, even when it matches the default. For small types a constructor call or a named factory function is clearer than a builder class. Languages with named and default arguments get most of the benefit from a plain function with keyword overrides, without the builder ceremony. Some argue the need for elaborate builders is itself a sign the domain objects have too many required fields.

## Quality axes

- **change_cost** ⊕ (primary): A new required field is added in one builder instead of breaking dozens of tests, and each test shows only the values that matter.

**Flips:** Defaults the assertion silently depends on make tests obscure and random defaults make them erratic, turning change_cost "-"; for small types, or with named and default arguments, a constructor or plain function is clearer.

## Warranted when

- Domain objects with many required fields, so each test repeats a long constructor call.
- A new required field breaks dozens of tests that don't care about it.
- Tests where the one value that matters is lost among ten that don't (Obscure Test).
- An Object Mother with a growing list of named variants (expired_customer, vip_customer_with_two_orders).

## How it shows

- Builders or factory functions in test helpers (a_customer(), OrderBuilder, make_user(**overrides)).
- Tests that name one or two fields when creating a domain object, with everything else defaulted.
- Factory libraries in the test dependencies (factory_boy, Fishery, AutoFixture, Bogus).

## Overdone when

- A builder for a type with two fields, where the constructor is already clear.
- Defaults that hide something the test depends on, so the reader can't see why it passes.
- Builders that grow their own logic and need their own tests.
- Random default values (fake names, random dates) that make tests erratic.

## Example

Before:

```
test "expired policy can't be renewed online":
    policy = Policy("P-1", holder, "home", 250.00, "EUR",
                    date(2020, 1, 1), date(2021, 1, 1),
                    "monthly", false, [])
    assert not policy.can_renew_online(today=date(2024, 5, 1))
# which of these ten values makes the case?
```

After:

```
fn a_policy() -> PolicyBuilder:
    return PolicyBuilder(holder=a_holder(), kind="home", premium=250.00,
                         starts=date(2024, 1, 1), ends=date(2025, 1, 1), ...)

test "expired policy can't be renewed online":
    policy = a_policy().ending(date(2024, 4, 30)).build()
    assert not policy.can_renew_online(today=date(2024, 5, 1))
```

The test names only the end date it depends on, and a new required field changes the builder rather than every test.

## By language

**python:** Usually a function with keyword overrides (make_order(status="paid")) or dataclasses.replace on a default instance; factory_boy for ORM models.

**typescript:** A function taking a Partial of the type and spreading it over defaults is the common shape; Fishery and similar libraries add sequences and associations.

**java:** Builder classes with withX methods are the classic form, and Lombok's @Builder(toBuilder = true) can generate them; Instancio fills objects automatically.

**csharp:** Builder classes, or a default record copied with the with expression; AutoFixture and Bogus generate data, though random values need care.

**go:** A constructor function in a _test.go file returning a default struct that the test then modifies, or functional options.

**rust:** Default plus struct update syntax (Order { status: Paid, ..test_order() }) covers most cases; derive builders exist but are rarely needed in tests.

## Related

[Obscure Test](obscure-test.md) · [Test Code Duplication](test-code-duplication.md) · [Builder](builder.md) · [Fluent Interface](fluent-interface.md) · [Fragile Test](fragile-test.md)

## In the interview

- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Nat Pryce, Test Data Builders, an alternative to the Object Mother pattern (2007)](http://www.natpryce.com/articles/000714.html) (recalled)
- [Steve Freeman and Nat Pryce, Growing Object-Oriented Software, Guided by Tests (2009), ch. 22](http://www.growing-object-oriented-software.com/) (recalled)
- [Martin Fowler, bliki, ObjectMother](https://martinfowler.com/bliki/ObjectMother.html) (recalled)
- [Gerard Meszaros, xUnit Test Patterns (2007), Creation Method](http://xunitpatterns.com/Creation%20Method.html) (recalled)
