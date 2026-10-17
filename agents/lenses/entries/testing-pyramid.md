<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Testing Pyramid

`testing-pyramid` · practices, quality · **contested**

Put most of your tests at the cheap, fast unit level, a smaller layer of integration tests above that, and just a handful of slow end-to-end tests at the top. Also called the test pyramid.

*Names:* Introduced by Mike Cohn in Succeeding with Agile (2009).

*Matters most for:* web-frontend, fullstack-web, mobile, web-api

## But

The shape is debated. Kent C. Dodds' testing trophy and Spotify's testing honeycomb put integration tests at the centre, arguing that heavily mocked unit tests pin implementation details and miss the bugs that matter. For thin services and UI-heavy apps the right mix often has more integration tests than the pyramid suggests.

## Quality axes

- **change_cost** ⊕ (primary): A mostly-unit suite is fast and rarely flaky, so every change gets quick, trustworthy feedback.
- **delivery** +: Short CI runs and fewer flaky reruns get changes merged sooner.

**Flips:** For thin services and UI-heavy apps, heavily mocked unit tests pin implementation details and miss integration bugs, so reliability and change_cost turn "-" and a trophy or honeycomb shape fits better.

## How it shows

- many end-to-end or browser tests and few unit tests, with long CI times and flaky reruns
- test directories dominated by slow suites marked as nightly or retried

## What to do

Push checks down to the cheapest level that can catch the bug, and keep end-to-end tests for the key user journeys.

## Example

Before:

```
fn test_coupon_rules_in_browser():
    browser.open("/cart")
    browser.add_item("sku-1", qty=3)
    browser.enter_coupon("BULK10")
    assert browser.text("#total") == "27.00"
    browser.enter_coupon("EXPIRED")
    assert browser.text("#error") == "Coupon expired"
    browser.enter_coupon("BULK10")
    browser.set_qty("sku-1", 1)
    assert browser.text("#total") == "10.00"
```

After:

```
fn test_bulk_coupon_needs_three_items():
    assert apply_coupon(cart(qty=3, price=10), "BULK10").total == 27.00
    assert apply_coupon(cart(qty=1, price=10), "BULK10").total == 10.00

fn test_expired_coupon_is_rejected():
    assert raises(CouponExpired, apply_coupon, cart(qty=1, price=10), "EXPIRED")

fn test_checkout_with_coupon_in_browser():
    browser.open("/cart")
    browser.add_item("sku-1", qty=3)
    browser.enter_coupon("BULK10")
    assert browser.text("#total") == "27.00"
```

The coupon rules move down to fast unit tests, and one browser test keeps the journey of applying a coupon at checkout.

## Related

[Pesticide Paradox](pesticide-paradox.md)

## In the interview

- [When a convention would be enforced through a number (coverage, complexity, line or file length, a lint count), ask what the number stands for and how code could meet it without meeting the goal.](../THINKING.md#numbers-are-signals)

## Sources

- [Milanović, Laws of Software Engineering, Testing Pyramid](https://lawsofsoftwareengineering.com/laws/testing-pyramid/) (read)
- [Martin Fowler, The Practical Test Pyramid (Ham Vocke)](https://martinfowler.com/articles/practical-test-pyramid.html) (recalled)
- Cohn, Succeeding with Agile (2009) (recalled)
