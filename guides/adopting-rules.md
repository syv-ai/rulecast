# Adopting a rule on a codebase that already breaks it

A violation that was already there is backlog: it is shown, and it never fails a hook. `rulecast run --all-files --summary` tells you how much there is:

```text
backlog: 57 violations in 31 files

  rule                            violations  files
  python/routes-never-call-crud           57     31

  worst files                     violations
  app/api/routes/orders.py                12
  app/api/routes/users.py                  9
```

## Watch the count, not the rate

One real codebase, one rule, on `main`:

| date | violating / total |
|---|---|
| 2026-01-15 | 61 / 80 |
| 2026-06-01 | 58 / 143 |
| 2026-09-25 | 57 / 194 |

The rate fell from 76% to 29% and the count did not move. New code complied; the old violations were only diluted.

## Burn it down

Per-edit enforcement stops the backlog growing; it doesn't shrink it. Fix it a file at a time: edits to files that already followed the rule broke it 2% of the time, against 37% in files that mostly did not. (One rule across 19 files: suggestive, not proven.)

When the fix is mechanical, give the rule a [`fix`](../agents/reference/rule-format.md#fixes): `rulecast fix <rule> --all-files --dry-run` shows the diff, and without `--dry-run` it writes it. Hooks never apply a fix.

A scheduled full-repository run has no ref to diff against, so it needs a [committed baseline](advanced.md#a-committed-baseline).
