<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Law of Unintended Consequences

`law-of-unintended-consequences` · laws, architecture

Any real change to a complex system will have effects nobody planned for, good, bad, or the opposite of what was meant.

*Matters most for:* platforms, distributed, iac

## But

It explains surprises after the fact but tells you little about which ones to expect, so it can turn into a general excuse for not changing anything. In small, well-tested, loosely coupled code the surprises are rare, and treating every edit as dangerous just slows the team down.

## Quality axes

*Bears on:* reliability, change_cost. Changes to a complex system cause effects nobody planned, so regressions show up far from the change and every change carries hidden risk.

## How it shows

- a fix in one module followed shortly by a regression fix in a module that had no obvious link to it
- commits that revert or patch a change days after it shipped, with messages like "side effect of"
- a new logging, caching or retry feature followed by incidents about disk, memory or load

## What to do

Ship changes in small steps behind flags or staged rollouts, watch real metrics after each step, and keep a fast rollback path.

## Related

[Hyrum's Law](hyrums-law.md) · [Murphy's Law](murphys-law.md)

## In the interview

- [Before proposing a convention, count where the code already breaks it and what an enforced rule would flag on day one.](../THINKING.md#check-the-draft-against-the-code)

## Sources

- [Milanović, Laws of Software Engineering, Law of Unintended Consequences](https://lawsofsoftwareengineering.com/laws/law-of-unintended-consequences/) (read)
