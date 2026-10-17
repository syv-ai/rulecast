<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Dogma over pragma

`dogma-over-pragma` · anti-patterns, design

A rule or principle is applied because it is the rule, in places where its reason does not hold and it does not make the code better. It differs from cargo cult programming in that the rule is known and named; what is missing is the judgement about when it applies.

## But

Consistency has its own value: a rule that is slightly wrong in one place but applied everywhere can beat a case-by-case call in a large team. Some rules, like security and data-handling rules, should be followed even when the reason isn't obvious locally. The fix is to know the reason, not to drop the rule.

## Quality axes

- **change_cost** −: Ceremony kept only because a rule demands it (an interface for a type that never varies) is more code to read and keep in step.
- **delivery** −: Each feature pays for structure the rule demands but the problem doesn't need.

**Flips:** In a large team, a slightly wrong rule applied everywhere can beat case-by-case judgement, and security or data-handling rules should be followed even where their reason isn't visible locally.

## Why people fall into it

- Rules are easier to check and argue about than judgement is.
- A principle that once fixed a real problem gets generalised beyond that problem.
- New team members copy what the codebase already does to be safe.

## How it shows

- a lint or style rule followed to the letter where its stated reason doesn't apply, such as a mandated interface for a type that will never vary, kept because the rule says every service has one

## Overcorrecting looks like

- Treating every convention as negotiable, so each file is decided case by case and consistency is lost.
- Using "pragmatism" to excuse skipping tests or error handling.

## What to do

Ask what the rule protects against, and write the rule down with its reason so exceptions can be judged against it.

## Example

Before:

```
# rule: no function longer than 5 lines
fn shipping_cost(order: Order) -> Money:
    base = _base(order)
    return _cap(_surcharge(order, base))

fn _base(order): return order.weight_kg * RATE_PER_KG
fn _surcharge(order, base): return base + _remote_fee(order)
fn _remote_fee(order): return REMOTE_FEE if order.address.is_remote else 0
fn _cap(cost): return min(cost, MAX_SHIPPING)
```

After:

```
fn shipping_cost(order: Order) -> Money:
    cost = order.weight_kg * RATE_PER_KG
    if order.address.is_remote:
        cost = cost + REMOTE_FEE
    return min(cost, MAX_SHIPPING)
```

The calculation reads top to bottom again; the line limit was serving the metric, not the reader.

## Related

[Cargo cult programming](cargo-cult-programming.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md) · [YAGNI](yagni.md)

## Overlaps

All four are practice without reasons. cargo-cult-programming is the code-level form, blind-pattern-following the architecture and process form, golden-hammer one tool used for everything, and dogma-over-pragma a rule kept where its reason doesn't apply.

## In the interview

- [When something looks odd or inconsistent, ask why it is that way before calling it a violation.](../THINKING.md#ask-the-history-first)
- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)
- [When a convention would be enforced through a number (coverage, complexity, line or file length, a lint count), ask what the number stands for and how code could meet it without meeting the goal.](../THINKING.md#numbers-are-signals)

## Sources

- The developer's seed list. No canonical source; related named ideas: Goodhart's law, Chesterton's fence (developer)
