<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Reinventing the wheel

`reinventing-the-wheel` · anti-patterns, design · **contested** · **agents do this**

Writing your own version of something that a standard library, a mature package or the codebase itself already does well, usually with fewer edge cases handled.

*Matters most for:* web-api, fullstack-web, scientific

## But

Writing it yourself can be right when the dependency is large for a small need, unmaintained, or a security risk, or when the domain needs behaviour the library can't give. Joel Spolsky argues you should own what is core to your business, and the Go community's "a little copying is better than a little dependency" (Rob Pike) favours a few lines of your own over a package. Learning by rebuilding is fine outside production. Crypto is the case where people agree you should never roll your own.

## Quality axes

- **security** −: Home-grown crypto, parsing and argument handling miss the attacks a mature library has already been hardened against.
- **reliability** −: Hand-written versions handle fewer edge cases (quoted CSV fields, time zones, URL encoding) than the library they replace.
- **change_cost** −: The team owns, tests and maintains code a library would have maintained for them.

**Flips:** When the dependency is large for a small need, unmaintained or itself a supply-chain risk, a few lines of your own can be safer and cheaper to keep; crypto is the exception.

## Why people fall into it

- Not knowing the library or the existing helper exists.
- Distrust of dependencies, or a policy that makes adding them slow.
- The problem looks simpler than it is ("it's just split on commas").

## How it shows

- hand-written parsers for CSV, dates, URLs or JSON
- home-grown retry, caching, crypto or argument parsing next to a library that does it
- a new helper that duplicates one already in the project under another name

## Overcorrecting looks like

- Pulling in a dependency for a few lines of code (the left-pad incident), adding supply-chain risk and upgrade work.

## What to do

Use the standard library, a well-maintained package or the existing project helper, and delete the home-grown version.

## Example

Before:

```
fn read_statement(text: str) -> list:
    rows = []
    for line in text.split("\n")[1:]:
        parts = line.split(",")
        rows.append(Transaction(date=parts[0], payee=parts[1], amount=parts[2]))
    return rows
```

After:

```
fn read_statement(text: str) -> list:
    rows = []
    for record in csv.read_dicts(text):
        rows.append(Transaction(date=record["date"], payee=record["payee"],
                                amount=record["amount"]))
    return rows
```

The CSV library handles quoted payees with commas in them, which the hand-split version silently mangled.

## Related

[Golden hammer](golden-hammer.md) · [Copy-and-paste programming](copy-and-paste-programming.md) · [Duplicate Code](duplicate-code.md)

## In the interview

- [When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it.](../THINKING.md#kept-for-what-it-does)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Reinvent the Wheel (recalled)
