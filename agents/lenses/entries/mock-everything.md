<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Mocking Everything (over-mocking)

`mock-everything` · anti-patterns, testing · **agents do this**

A unit test replaces every collaborator of the code under test with a mock, so it only checks that the code calls its mocks the way it was written to, and asserts nothing about real behaviour. Known as over-mocking, and as over-specification or testing implementation details; Meszaros files it under Overspecified Software in Fragile Test.

*Matters most for:* web-api, fullstack-web, web-frontend

## But

Mocks are good practice; the anti-pattern is mocking so much that nothing real is left to test. Mocking at real boundaries is sound: the network, the clock, randomness, payment providers, other services and anything slow or with side effects should be doubled in unit tests. There are two schools. The London (mockist) school, whose canonical text is Freeman and Pryce's's Growing Object-Oriented Software, mocks collaborators with interesting behaviour on purpose and uses interaction tests to drive design through roles and interfaces; done that way, each mock stands for a role whose contract is tested elsewhere. The classical (Detroit) school, Beck's and Fowler's, uses real objects where it can and doubles only what is awkward. Khorikov argues for mocking only unmanaged out-of-process dependencies, whose calls are observable from outside. Both schools agree a test that only replays the implementation's calls back to it proves nothing.

## Quality axes

- **delivery** +: Mocking whatever gets in the way is the quickest route to a passing test and a coverage target.
- **reliability** −: Tests check only that the code calls its mocks as written, so real defects pass the suite.
- **change_cost** −: Tests pinned to implementation calls break on every refactor even when behaviour is unchanged.

## Why people fall into it

- a misread "unit" as one class, so every other class must be faked
- mock libraries that make patching anything a one-liner
- hard-to-construct collaborators, where a mock is quicker than fixing the design
- coverage targets, which mocked tests hit cheaply
- coding agents asked to "add unit tests" and making the test pass by mocking whatever gets in the way

## How it shows

- tests whose only assertions are mock-call verifications, with no assertion on a returned value or resulting state
- mocks of value objects, plain data or pure functions, where the real thing is cheap to build
- setup where mocks return other mocks several levels deep
- the code under test itself partly patched, so the test runs mostly stubbed logic
- tests that still pass after the real logic is deleted, because the mocks supply the answer
- a stub configured to return a value and then verified as called, so the test checks the code used the answer it was handed

## Overcorrecting looks like

- banning mocks altogether, so tests hit real networks, clocks and third-party services and become slow and erratic
- replacing mocks with hand-written fakes that drift from the real thing and are never tested themselves

## What to do

Keep mocks at real boundaries (network, clock, randomness, filesystem, other services) and at role interfaces whose contract is tested on its own; use real objects for values, data structures and pure functions; assert on returned values and observable state wherever the code produces them, and verify interactions where the interaction is the behaviour (a message sent, an email out). Never verify a call you only stubbed to supply an answer.

## Example

Before:

```
fn test_cart_total():
    pricing = mock(PricingRules)
    pricing.discount_for.returns(5)
    tax = mock(TaxTable)
    tax.apply.returns(45)
    cart = Cart(pricing, tax)
    cart.total([Item("tea", 25), Item("mug", 25)])
    assert pricing.discount_for.called_once()
    assert tax.apply.called_with(45)
```

After:

```
fn test_cart_total_applies_discount_then_tax():
    pricing = PricingRules(discount_over = 40, discount = 5)
    tax = TaxTable(rate = 0.10)
    cart = Cart(pricing, tax)
    total = cart.total([Item("tea", 25), Item("mug", 25)])
    assert total == 49.50
```

Pricing and tax are in-process logic, so the test uses the real ones and checks the total; a mock would still fit a payment gateway called after checkout.

## By language

**python:** Watch for patch decorators or context managers stacked on every import of the module under test, and MagicMock standing in for plain data.

**typescript:** Watch for jest.mock or vi.mock on sibling modules of the code under test, and toHaveBeenCalledWith as the only expectation.

**javascript:** Same as TypeScript: module-level jest.mock or vi.mock of the module's own neighbours.

## Related

[Fragile Test](fragile-test.md) · [Assertion-Free Test](assertion-free-test.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Test Logic in Production](test-logic-in-production.md)

## Overlaps

mock-everything is over-mocking until a test checks nothing real, assertion-free-test is a test that checks nothing at all, and fragile-test is the symptom both often produce: tests that break on refactors that change no behaviour.

## In the interview

- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Fowler, Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) (read)
- [Meszaros, xUnit Test Patterns, Fragile Test (Overspecified Software)](http://xunitpatterns.com/Fragile%20Test.html) (read)
- Khorikov, Unit Testing Principles, Practices, and Patterns (recalled)
- Freeman and Pryce, Growing Object-Oriented Software, Guided by Tests (recalled)
