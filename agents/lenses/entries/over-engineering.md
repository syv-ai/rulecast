<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Over-Engineering

`over-engineering` · anti-patterns, architecture · **agents do this**

A system's architecture is more complex than its requirements need, usually through new technology or optimisation for flexibility and scale nobody has asked for. At code scale it overlaps Speculative Generality, which is the canonical name for the class-level form.

*Matters most for:* distributed, serverless, iac, platforms

## But

Some requirements genuinely are demanding (regulated data, high availability, real scale), and meeting them isn't over-engineering. Some decisions are expensive to reverse, so a bit of foresight on those is cheap insurance. The judgement is about requirements you have or can see coming, not ones you imagine. Sometimes the real fix is a business process change, not software at all.

## Quality axes

- **change_cost** −: Simple features are spread over many files and framework boilerplate, so each change touches more than it should.
- **operability** −: Brokers, orchestrators and caches the load doesn't need are extra moving parts to deploy, monitor and debug.
- **delivery** −: Infrastructure absorbs the effort, so business logic arrives late.

**Flips:** Genuinely demanding requirements (regulated data, high availability, real scale), or decisions that are expensive to reverse, justify the extra structure.

## Why people fall into it

- curiosity about new concepts and frameworks, without asking whether they fit
- premature optimisation for flexibility, extensibility or scale that isn't needed yet
- wanting hands-on experience with new technology instead of repeating the same stack
- not knowing the domain well enough to see the simple solution

## How it shows

- message brokers, orchestration engines or caches in a system with modest load and one team
- logically related code spread across many files or modules for one simple feature
- framework boilerplate outweighing business logic
- a framework or platform built where a single solution would do
- business logic arriving late or buggy because the infrastructure absorbed the effort

## Overcorrecting looks like

- refusing any structure until it hurts, then paying for a large retrofit
- dismissing known, cheap safety margins (an index, a queue for slow work) as over-engineering

## What to do

Keep it simple (KISS, YAGNI), optimise only when measurements say so, build for current requirements, spend a limited budget of "innovation tokens", and refactor or rewrite toward the simpler design.

## Example

None: It is a judgement about a whole system against its requirements; any snippet would be either a strawman or a different entry (Speculative Generality).

## Related

[YAGNI](yagni.md) · [Premature Optimization](premature-optimization.md) · [Misapplied Genericity](misapplied-genericity.md) · [Domain Allergy](domain-allergy.md) · [Second-System Effect](second-system-effect.md) · [Speculative Generality](speculative-generality.md) · [KISS (Keep It Simple, Stupid)](kiss.md)

## Overlaps

yagni is the principle. speculative-generality is the symptom inside a class or module (hooks, parameters and abstractions nothing uses), and over-engineering is the same thing at system scale.

## In the interview

- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)

## Sources

- [INNOQ, Architecture Antipatterns, Over-Engineering](https://architecture-antipatterns.tech/patterns/over_engineering.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Splitting a checkout system into too many services](https://architecture-antipatterns.tech/case_studies/splitting_a_checkout_system.html) (read)
