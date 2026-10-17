<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Lehman's Laws of Software Evolution

`lehmans-laws` · laws, quality

A system used in the real world has to keep changing to stay useful, and each change adds complexity unless someone works to remove it.

*Matters most for:* fullstack-web, platforms, desktop

## But

The laws come from large, long-lived systems like OS/360 and apply to what Lehman called E-type software. A small tool with a fixed spec, a one-off script or a library that is deliberately finished does not have to keep evolving. The later laws (self-regulation, conservation of familiarity) rest on thin and dated data, and some researchers found open-source systems that grew faster than the laws predict.

## Quality axes

*Bears on:* change_cost. A system in real use must keep changing, and each change adds complexity unless it is paid down, so later changes get steadily more expensive.

## How it shows

- a long git history where features take more and more commits and touched files over time
- growing file and function sizes in the oldest modules with little refactoring activity
- periodic large "cleanup" or "restructure" commits after long stretches of feature work

## What to do

Budget regular refactoring alongside feature work so complexity is paid down continuously rather than in rare rewrites.

## Related

[Technical Debt](technical-debt.md) · [Zawinski's Law](zawinskis-law.md)

## In the interview

- [Before proposing a convention, count where the code already breaks it and what an enforced rule would flag on day one.](../THINKING.md#check-the-draft-against-the-code)

## Sources

- [Milanović, Laws of Software Engineering, Lehman's Laws of Software Evolution](https://lawsofsoftwareengineering.com/laws/lehmans-laws/) (read)
