<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# DRY (Don't Repeat Yourself)

`dry` · principles, design

Each piece of knowledge, such as a business rule, constant or config value, should live in exactly one authoritative place. It is about knowledge, not text: two identical lines that encode different decisions are not duplication.

*Names:* Coined by Hunt and Thomas in The Pragmatic Programmer (1999). Often equated with Once and Only Once from Extreme Programming, which is about duplicated code rather than duplicated knowledge.

*Matters most for:* iac

## But

It is about duplicated knowledge, not code that merely looks alike. Merging two similar snippets that change for different reasons couples them and produces the wrong abstraction; Sandi Metz's point that duplication is far cheaper than the wrong abstraction, and the rule of three, push back on early extraction. Tests often read better with some repetition, and sharing code across services creates coupling that can cost more than the copy.

## Quality axes

- **change_cost** ⊕ (primary): A business rule, constant or config value changes in one place instead of every copy.
- **reliability** +: Copies can't drift apart and leave one path with a bug that was fixed in the others.

**Flips:** Merging code that only looks alike, and changes for different reasons, couples it into the wrong abstraction and turns change_cost "-". Sharing code across services adds coupling that can cost more than the copy.

## How it shows

- the same business rule, formula or validation written out in several modules
- one config value such as a URL, host or limit hard-coded in many files
- near-identical functions copied between packages that get bug fixes in only one copy

## What to do

Extract the shared knowledge into one function, constant, schema or config entry that every use reads from.

## Example

Before:

```
# in checkout.py
fn fee_on_return(loan: Loan) -> Money:
    days = max(0, loan.returned_on - loan.due_on)
    return min(days * 0.25, 10.00)

# in reminders.py
fn fee_so_far(loan: Loan, today: Date) -> Money:
    days = max(0, today - loan.due_on)
    return min(days * 0.25, 10.00)
```

After:

```
# in fees.py
fn late_fee(due_on: Date, as_of: Date) -> Money:
    days = max(0, as_of - due_on)
    return min(days * DAILY_LATE_FEE, MAX_LATE_FEE)

# in checkout.py
fn fee_on_return(loan: Loan) -> Money:
    return late_fee(loan.due_on, loan.returned_on)

# in reminders.py
fn fee_so_far(loan: Loan, today: Date) -> Money:
    return late_fee(loan.due_on, today)
```

The library's fee rule lives in one place, so a change to the daily rate or the cap can't reach one module and miss the other.

## Related

[KISS (Keep It Simple, Stupid)](kiss.md) · [YAGNI](yagni.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md)

## Overlaps

Start from dry: it says what counts, duplicated knowledge rather than duplicated text. duplicate-code is how it shows in code, copy-and-paste-programming is the habit that produces it, and wrong-abstraction is what an eager merge of copies that only look alike produces.

## Sources

- [Milanović, Laws of Software Engineering, DRY (Don't Repeat Yourself)](https://lawsofsoftwareengineering.com/laws/dry-principle/) (read)
- [Hunt & Thomas, The Pragmatic Programmer (1999; 20th anniversary ed. 2019), DRY](https://media.pragprog.com/titles/tpp20/dry.pdf) (read)
