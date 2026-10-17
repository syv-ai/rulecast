<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Under-Modularization

`under-modularization` · anti-patterns, architecture

Splitting a system into too few modules, so each is too big to understand, secure, deploy or scale, and missing boundaries let unrelated parts depend on each other freely.

*Matters most for:* fullstack-web, web-api, platforms

## But

A single module is the right start for a small or new system, where the domain's seams aren't known yet and the cost of boundaries is pure overhead. A monolith with good internal boundaries is not under-modularized. Splitting only pays when there's a reason to, and a boundary drawn in the wrong place is worse than none.

## Quality axes

- **change_cost** −: Without boundaries anything depends on anything, so modules are too big to understand and a change in one area breaks another.

**Flips:** A single module is the right start for a small or new system whose seams aren't known yet; boundaries there are pure overhead.

## Why people fall into it

- time pressure and low budget, so nobody stops to draw boundaries
- growth nobody steered
- no shared vision of how the system should be cut
- inherited project structures from older platforms
- not enough architecture or domain knowledge to see the seams

## How it shows

- a shared core of domain classes, database access and utilities that every feature imports and that is the biggest part of the codebase
- one deployable unit owned by several teams that block each other's releases
- imports crossing what should be domain boundaries in every direction
- one or two huge classes holding every variant of an entity

## Overcorrecting looks like

- Over-Modularization: splitting into many tiny modules or services before the split pays off

## What to do

Introduce module boundaries along bounded contexts, starting inside the deployable (a modular monolith), and split further once there's a concrete payoff such as reuse, separate team ownership, or performance needs.

## Example

None: It is about the number and size of modules in a whole system, which a snippet can't show.

## Related

[Over-Modularization](over-modularization.md) · [Big Ball of Mud](big-ball-of-mud.md) · [God object (The Blob)](god-object.md)

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)

## Sources

- [INNOQ, Architecture Antipatterns, Under-Modularization](https://architecture-antipatterns.tech/patterns/under_modularization.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Flattening the Hierarchy](https://architecture-antipatterns.tech/case_studies/two_huge_domain_classes_represent_all_legal_forms_for_companies_unions_and_foundations.html) (read)
