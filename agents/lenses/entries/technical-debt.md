<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Technical Debt

`technical-debt` · practices, quality

Shortcuts in code buy speed now and charge interest later as extra effort on every change, until the debt is paid down.

*Matters most for:* fullstack-web, platforms

## But

The source page defines it as anything that slows you down, which is far wider than Cunningham's metaphor: he meant shipping code that reflects your current, incomplete understanding and refactoring as you learn, not writing messy code. Used as a catch-all the term loses its use for deciding anything. Debt in code that never changes costs no interest and may never need paying.

## Quality axes

- **change_cost** ⊕ (primary): Recording debt and paying it down where code changes most removes the interest charged on every later change.
- **delivery** −: Refactoring and adding missing tests as part of regular work takes time from features now.

**Flips:** Taking on debt on purpose to ship flips the signs, delivery "+" and change_cost "-". Debt in code that never changes costs no interest, so paying it down there is pure cost.

## How it shows

- TODO, FIXME and HACK comments that stay in the code across many commits
- copy-pasted blocks and hard-coded values in early or prototype code that became production
- features merged without tests, followed by slower and riskier changes in the same area

## What to do

Record debt where it is taken, refactor and add missing tests as part of regular work, and pay down the debt in the areas that change most.

## One-file tell

TODO, FIXME, HACK or XXX comments added without an issue link or owner.

## Related

[Lehman's Laws of Software Evolution](lehmans-laws.md) · [Pareto Principle](pareto-principle.md)

## In the interview

- [Find the parts nobody touches and the parts only one person understands, and ask which is which.](../THINKING.md#frozen-code-gets-its-own-rule)

## Sources

- [Milanović, Laws of Software Engineering, Technical Debt](https://lawsofsoftwareengineering.com/laws/technical-debt/) (read)
- [Ward Cunningham, Debt Metaphor](https://www.youtube.com/watch?v=pqeJFYwnkjE) (recalled)
