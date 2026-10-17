<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Second-System Effect

`second-system-effect` · laws, architecture

Once a lean first system has worked, the team tends to over-design the version that replaces it and pile in all the ideas they held back the first time.

*Matters most for:* platforms, library-sdk

## But

Some rewrites succeed when the first system's constraints are truly gone and scope is held firm. Brooks himself said the third system tends to be better, and a team that has already been burned once can avoid the trap.

## Quality axes

*Bears on:* delivery, change_cost. A rewrite piles in the features and abstractions held back the first time, so it ships late and leaves more machinery to maintain.

## How it shows

- a "v2" or rewrite directory growing plugin systems, config options and abstractions the v1 never needed
- a rewrite branch that runs for months while the old system keeps shipping fixes

## What to do

Evolve the existing system incrementally (strangler fig) and hold a rewrite to the scope users actually need.

## Related

[Zawinski's Law](zawinskis-law.md) · [YAGNI](yagni.md)

## In the interview

- [When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it.](../THINKING.md#kept-for-what-it-does)

## Sources

- [Milanović, Laws of Software Engineering, Second-System Effect](https://lawsofsoftwareengineering.com/laws/second-system-effect/) (read)
