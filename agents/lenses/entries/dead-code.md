<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Dead Code

`dead-code` · smells, code · **agents do this**

Code that nothing runs or uses any more: variables, parameters, branches, functions, classes or whole files left behind after requirements changed.

*Names:* Fowler's chapter 3 doesn't list it as a smell; his 2nd edition covers it as the refactoring Remove Dead Code.

*Matters most for:* library-sdk, plugins-extensions

## But

"No callers here" isn't the same as dead in a library, a plugin host, or code entered through reflection, routing tables, serialization or cron. Check before deleting. A deprecation period is the right move for public APIs. Otherwise there is little argument for keeping it.

## Quality axes

- **delivery** +: Adding the new path beside the old one and putting off the cleanup ships sooner.
- **change_cost** −: Readers and agents have to read, search past and keep compiling code that never runs, and may change or call it by mistake.

## Why people fall into it

- Deleting feels risky, and nobody is sure whether some caller still exists.
- The new path was added beside the old one, and cleanup was meant to follow.
- A conditional grew complicated enough that a branch became unreachable without anyone noticing.

## How it shows

- Functions, classes or exports with no callers.
- Commented-out code blocks.
- Statements after an unconditional return or raise, or branches whose condition can't be true.
- Parameters the body never reads, and feature flags that have been on everywhere for months.
- An old version of a function kept next to its replacement (process_v1, legacy_export).

## Overcorrecting looks like

- Deleting a library's public API because nothing in this repository calls it.
- Removing code reached only by reflection, plugins, config or a scheduled job that static search doesn't see.

## What to do

Delete it; version control keeps the history. Use Remove Parameter for unused parameters, and Inline Class or Collapse Hierarchy when a class in a hierarchy no longer pulls its weight.

## Example

Before:

```
fn net_pay(employee, period) -> Money:
    gross = employee.salary_for(period)
    # old_tax = legacy_tax_table(gross, employee.region)
    tax = tax_for(gross, employee.region)
    if USE_LEGACY_ROUNDING:          # set to False in 2023
        return round_legacy(gross - tax)
    return round_half_even(gross - tax)

fn legacy_tax_table(gross, region): ...
fn round_legacy(amount): ...
```

After:

```
fn net_pay(employee, period) -> Money:
    gross = employee.salary_for(period)
    tax = tax_for(gross, employee.region)
    return round_half_even(gross - tax)
```

The commented line, the dead flag branch and the two helpers only it used are gone.

## One-file tell

Commented-out code blocks, statements after an unconditional return or raise, and branches guarded by a literal false.

## Related

[Speculative Generality](speculative-generality.md) · [YAGNI](yagni.md) · [The Boy Scout Rule](boy-scout-rule.md)

## Overlaps

dead-code is the code that does nothing. lava-flow is why it stays: nobody dares remove it. Use lava-flow when the question is history and ownership, dead-code when it is the code itself.

## Sources

- [Refactoring.Guru, Dead Code](https://refactoring.guru/smells/dead-code) (read)
- [Martin Fowler, Refactoring (2nd ed.), Remove Dead Code](https://refactoring.com/catalog/removeDeadCode.html) (recalled)
