<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Lava flow

`lava-flow` · anti-patterns, code · **agents do this**

Dead or half-finished code from earlier experiments hardens into the codebase because nobody knows whether it is still needed and nobody dares remove it.

*Matters most for:* ml-training, scientific, data-pipeline

## But

Code that only looks dead may be used through reflection, dynamic dispatch, a public API or a rarely run job; a library cannot know its callers. In those cases, deprecate and measure before deleting.

## Quality axes

- **change_cost** −: Dead and half-finished code has to be read, searched past and kept compiling in every refactor, and nobody can tell which version is live.

## Why people fall into it

- Prototype code shipped to production without a cleanup pass.
- The original authors left, and without tests nobody can prove a path is unused.
- Keeping code feels safer than deleting it.

## How it shows

- commented-out blocks and functions with comments like "do not remove" or "not sure if used"
- several versions of the same function (v2, new_, old_) side by side
- modules with no callers that still get edited during refactors
- branches for feature flags that were fully rolled out long ago

## Overcorrecting looks like

- Deleting code that is reached only by reflection, configuration, plugins or external callers without checking.

## What to do

Remove Dead Code, backed by coverage or call-site search, and trust version control to keep the history.

## Example

Before:

```
fn tax_for(invoice: Invoice) -> Money:
    return tax_v3(invoice)

fn tax_v2(invoice):   # old, keep just in case
    ...

# fn tax_experimental(invoice):
#     rate = lookup_rate_from_api(invoice.country)
#     ...

fn tax_v3(invoice): ...
```

After:

```
fn tax_for(invoice: Invoice) -> Money:
    return tax_v3(invoice)

fn tax_v3(invoice): ...
```

The unused versions go; the history keeps them if anyone ever needs them back.

## One-file tell

All languages: a block of two or more consecutive commented-out lines that read as statements (an assignment, a call, a control keyword, or a line ending in ; { or }). It skips a block that follows a comment ending in ':' or mentioning 'example' or 'uncomment', and it skips vendored and generated files, including scaffold templates such as alembic env.py.

## Related

[Dead Code](dead-code.md) · [Boat anchor](boat-anchor.md) · [Technical Debt](technical-debt.md) · [Cargo cult programming](cargo-cult-programming.md)

## Overlaps

dead-code is the code that does nothing. lava-flow is why it stays: nobody dares remove it. Use lava-flow when the question is history and ownership, dead-code when it is the code itself.

## In the interview

- [When something looks odd or inconsistent, ask why it is that way before calling it a violation.](../THINKING.md#ask-the-history-first)
- [Find the parts nobody touches and the parts only one person understands, and ask which is which.](../THINKING.md#frozen-code-gets-its-own-rule)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Lava Flow (recalled)
