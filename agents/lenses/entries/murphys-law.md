<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Murphy's Law

`murphys-law` · laws, quality

Anything that can go wrong eventually will, so handle the failure cases instead of assuming them away. Also called Sod's Law.

*Matters most for:* embedded, data-pipeline, event-driven, mobile

## But

Taken too far it produces defensive clutter: null checks on values that cannot be null and catch blocks that hide real bugs. Fail-fast advocates (and Erlang's "let it crash") prefer to guard the boundaries and let internal invariant violations crash loudly rather than defend against everything everywhere.

## Quality axes

*Bears on:* reliability. Failure cases that are assumed away happen eventually, so unhandled errors, missing timeouts and untested edge cases turn into incidents.

## How it shows

- file, network or parse calls with no error handling around them
- no timeouts or retries on outbound calls
- tests that cover only the happy path for code that reads external input

## What to do

Validate input at boundaries, handle errors explicitly, set timeouts, and test the edge cases and failure paths.

## Example

Before:

```
fn import_statement(path: str) -> list:
    rows = csv.read(open(path))
    txns = []
    for row in rows:
        txns.append(Transaction(date=parse_date(row[0]), amount=float(row[2])))
    return txns
```

After:

```
fn import_statement(path: str) -> list:
    rows = csv.read(open(path))
    txns = []
    line_no = 0
    for row in rows:
        line_no = line_no + 1
        if len(row) < 3:
            raise StatementError(path, line_no, "expected at least 3 columns")
        try:
            txns.append(Transaction(date=parse_date(row[0]), amount=parse_decimal(row[2])))
        except ParseError as e:
            raise StatementError(path, line_no, e.message)
    return txns
```

Bank files arrive short, malformed and oddly formatted, so the import checks the input at the boundary and reports where it went wrong instead of crashing deep inside or storing garbage.

## Related

[Law of Unintended Consequences](law-of-unintended-consequences.md) · [Postel's Law](postels-law.md)

## In the interview

- [Ask what would hurt most if it went wrong, and work back to the conventions that stop it.](../THINKING.md#start-from-failure)

## Sources

- [Milanović, Laws of Software Engineering, Murphy's Law / Sod's Law](https://lawsofsoftwareengineering.com/laws/murphys-law/) (read)
