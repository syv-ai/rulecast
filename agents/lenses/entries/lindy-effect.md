<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Lindy Effect

`lindy-effect` · laws, decisions

The longer a technology has already been in use, the longer it is likely to stay in use, which favours proven, "boring" choices.

*Matters most for:* web-frontend, embedded

## But

It is a heuristic about survival, not quality. Old tools persist partly through lock-in, and new ones sometimes are better (memory-safe languages, modern build tools). Applied rigidly it blocks any adoption. The source page's figure that most financial transactions run on COBOL is a widely repeated estimate with weak sourcing.

## Quality axes

*Bears on:* change_cost, reliability. Long-lived tools tend to stay maintained, while young dependencies churn, get abandoned, force migrations and have immature failure modes.

## How it shows

- dependency manifests full of young, fast-moving packages where a mature standard tool would do
- several overlapping frameworks for the same job, each added during a different trend

## What to do

Prefer mature, widely used tools and the standard library; spend novelty only where it buys something real.

## Related

[Occam's Razor](occams-razor.md)

## In the interview

- [When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it.](../THINKING.md#kept-for-what-it-does)

## Sources

- [Milanović, Laws of Software Engineering, The Lindy Effect](https://lawsofsoftwareengineering.com/laws/lindy-effect/) (read)
