<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Pareto Principle

`pareto-principle` · laws, decisions

A small share of causes produces most of the effect, so find the vital few (hot code, crashing bugs, used features) and spend effort there. Also called the 80/20 rule.

*Matters most for:* games, scientific

## But

The ratio is not a law of nature and is often quoted without data. Some work cannot be triaged by frequency: security, accessibility and correctness on rare paths matter even when they touch few users or little runtime.

## Quality axes

*Bears on:* runtime, reliability. A few hot paths and a few buggy files cause most of the slowness and the crashes, so effort spent elsewhere does little.

## How it shows

- a few files that appear in most bug-fix commits and change far more often than the rest
- optimisation effort spread evenly instead of guided by profiling

## What to do

Measure first (profilers, crash reports, churn and incident data), then focus on the top hotspots.

## Related

[Premature Optimization](premature-optimization.md)

## In the interview

- [Spend the interview where the work is.](../THINKING.md#find-where-changes-concentrate)

## Sources

- [Milanović, Laws of Software Engineering, Pareto Principle (80/20 Rule)](https://lawsofsoftwareengineering.com/laws/pareto-principle/) (read)
