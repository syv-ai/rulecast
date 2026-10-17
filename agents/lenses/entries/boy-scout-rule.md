<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# The Boy Scout Rule

`boy-scout-rule` · practices, quality

Leave the code a little cleaner than you found it each time you touch it.

## But

Drive-by cleanups mixed into a feature diff make review and bisecting harder and can cause merge conflicts on busy files. Many teams want tidy-ups in a separate commit or PR (Kent Beck's "tidy first" and Fowler's preparatory refactoring both keep structure changes apart from behaviour changes). It is also no excuse to wander off and polish code unrelated to the task, and it doesn't replace planned work on large debt.

## Quality axes

- **change_cost** ⊕ (primary): Code that is touched often keeps getting clearer, with dead code dropped, confusing names fixed and missing tests added.
- **delivery** −: Each change carries a small extra cleanup.

**Flips:** Cleanups mixed into a feature diff make review and bisecting harder and cause merge conflicts, so change_cost turns "-". Wandering off to polish unrelated code is waste.

## How it shows

- feature or bugfix commits that also rename a confusing symbol, drop dead code or add a missing test nearby
- commented-out blocks and stale TODOs in files that are edited often, which suggests the rule isn't being followed

## What to do

Make a small, local cleanup in the area you're already changing, ideally as its own commit.

## Related

[Broken Windows Theory](broken-windows-theory.md) · [Technical Debt](technical-debt.md)

## In the interview

- [Find the parts nobody touches and the parts only one person understands, and ask which is which.](../THINKING.md#frozen-code-gets-its-own-rule)

## Sources

- [Milanović, Laws of Software Engineering, The Boy Scout Rule](https://lawsofsoftwareengineering.com/laws/boy-scout-rule/) (read)
