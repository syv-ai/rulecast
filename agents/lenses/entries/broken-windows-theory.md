<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Broken Windows Theory

`broken-windows-theory` · laws, quality

Small signs of neglect left unfixed tell everyone that quality doesn't matter here, so the mess grows; also called software entropy.

## But

The original criminology theory (Wilson and Kelling) is heavily disputed, and its use to justify aggressive policing is widely criticised. In software the evidence is mostly anecdotal. Chasing every tiny blemish can also turn into perfectionism that blocks delivery. Some old code is ugly but stable and rarely touched, and leaving it alone is the right call.

## Quality axes

*Bears on:* change_cost, reliability. Unfixed hacks, suppressions and ignored or disabled checks signal that quality doesn't matter, so the mess grows and failing tests stop catching bugs.

## How it shows

- TODO or FIXME "hack" comments that have sat in the code for a long time
- piles of lint-suppression comments or skipped and disabled tests
- a CI pipeline where failing or flaky checks are routinely ignored or marked optional

## What to do

Fix small problems while they're small, or at least board them up with a tracked issue, and keep the build green.

## Example

Before:

```
fn tax_rate(region: str) -> float:
    # lint-disable: no-bare-except
    try:
        return RATES[region]
    except:
        return 0.0

# skip
fn test_tax_rate_for_overseas_territories():
    ...
```

After:

```
fn tax_rate(region: str) -> float:
    if region not in RATES:
        raise UnknownRegion(region)
    return RATES[region]

# skip: territory rates need a product decision, see ISSUE-412
fn test_tax_rate_for_overseas_territories():
    ...
```

The unexplained suppression is fixed outright, and the skip that can't be fixed yet is boarded up with a reason and a tracked issue.

## One-file tell

A lint-disable or type-ignore comment with no reason or issue link next to it.

## Related

[The Boy Scout Rule](boy-scout-rule.md) · [Technical Debt](technical-debt.md)

## Sources

- [Milanović, Laws of Software Engineering, Broken Windows Theory](https://lawsofsoftwareengineering.com/laws/broken-windows-theory/) (read)
