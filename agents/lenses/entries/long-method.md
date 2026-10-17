<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Long Method

`long-method` · smells, code · **contested** · **agents do this**

A function has grown long enough that you have to read all of it to understand any of it.

*Names:* Fowler's 2nd edition calls it Long Function and adds Loops as a separate smell, preferring pipeline operations over hand-written loops.

*Matters most for:* data-pipeline, scientific, ml-training, compilers-tooling, tui

## But

Refactoring.Guru's ten-line threshold is far stricter than most practitioners use. Ousterhout argues that splitting into many shallow functions hides more than it shows, and John Carmack has made the case for inlining long sequential code so the order of effects stays visible. A long function that does one linear thing, like a state machine, a parser case table or a test, can be clearer whole. Split by meaning, not length.

## Quality axes

- **delivery** +: Adding a few lines to an existing function is always the smallest change.
- **change_cost** −: You have to read the whole function to change any part, and locals shared across phases make edits risky.

**Flips:** A long function that does one linear thing, such as a state machine or a parser case table, can be clearer whole than split into shallow helpers.

## Why people fall into it

- Adding a few lines to an existing function is always the smallest change.
- Local variables shared across the body make extraction look hard.
- Worry that extra function calls cost performance.

## How it shows

- A function body that runs past a screen, with blank-line-separated phases.
- Comments labelling the phases inside the function.
- Deep nesting of conditionals and loops.
- Many local variables, some reassigned across phases.

## Overcorrecting looks like

- Splitting into many tiny functions called once each, so the reader has to jump around to follow one flow.
- Extracting by line count rather than by meaning, creating helpers with vague names (process_part2).

## What to do

Extract Method, naming each piece after what it does (a block that needs a comment is a candidate). Replace Temp with Query, Introduce Parameter Object or Preserve Whole Object when locals get in the way. Decompose Conditional for complex conditions. Replace Method with Method Object when nothing else works.

## Example

Before:

```
fn import_statement(path: str, account) -> int:
    rows = read_csv(path)
    parsed = []
    for row in rows:
        if row["Amount"] == "": continue
        amount = parse_decimal(row["Amount"].replace(",", "."))
        date = parse_date(row["Booked"], "DD.MM.YYYY")
        parsed.append(Txn(date, amount, row["Text"].strip()))
    existing = account.transaction_keys()
    new = []
    for t in parsed:
        if t.key() not in existing: new.append(t)
    account.add_all(new)
    return len(new)
```

After:

```
fn import_statement(path: str, account) -> int:
    parsed = parse_rows(read_csv(path))
    new = without_known(parsed, account.transaction_keys())
    account.add_all(new)
    return len(new)

fn parse_rows(rows) -> list: ...
fn without_known(txns, known_keys) -> list: ...
```

The top function now reads as the three steps it performs; each step can be tested on its own.

## One-file tell

Python only: a function over 60 lines, excluding tests and generated migrations.

## Related

[Comments](comments.md) · [Large Class](large-class.md) · [KISS (Keep It Simple, Stupid)](kiss.md) · [Duplicate Code](duplicate-code.md)

## Sources

- [Refactoring.Guru, Long Method](https://refactoring.guru/smells/long-method) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3, Long Function and Loops](https://martinfowler.com/books/refactoring.html) (recalled)
- [John Ousterhout, A Philosophy of Software Design, ch. 9](https://web.stanford.edu/~ouster/cgi-bin/book.php) (recalled)
