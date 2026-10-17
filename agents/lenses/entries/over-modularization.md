<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Over-Modularization

`over-modularization` · anti-patterns, architecture

Cutting a system into more modules than it needs, at runtime (services, lambdas) or build time (packages, build modules), so the boundaries add more complexity than they remove. Nanoservices is the service-scale name.

*Matters most for:* distributed, serverless

## But

Separate deployables are right when parts genuinely need to scale, release or fail independently, or when different teams own them. Fine-grained functions can be cheap and simple for spiky, independent workloads. The test is whether the boundaries match how the system actually changes. A related code-scale form, splitting classes until each does almost nothing, overlaps the shallow module smell.

## Quality axes

- **reliability** −: Long synchronous chains and a central orchestrator mean one failing module fails the whole request.
- **change_cost** −: Modules that always change together force every change across several boundaries and contracts.
- **runtime** −: Calls that could be in-process cross the network in long synchronous chains.
- **operability** −: Many tiny deployables are more to deploy, version, monitor and trace through.
- **delivery** −: Even a small feature needs coordinated changes and releases in several services or packages.

**Flips:** Separate deployables are right when parts genuinely need to scale, release or fail independently, or are owned by different teams.

## Why people fall into it

- designing an "ideal" future structure up front, expecting better builds, testability or reuse
- fear that splitting later will be hard
- copying a big company's microservice architecture
- a bad past experience with a monolith
- not knowing the domain well enough to see where the real seams are

## How it shows

- many tiny services or functions where a small feature needs changes in several of them
- modules that are always changed and deployed together
- long chains of synchronous calls between services to serve one request
- a central orchestrator service that every flow goes through and that causes most outages
- many tiny build modules or packages with a handful of files each

## Overcorrecting looks like

- Under-Modularization: merging everything back into one undifferentiated unit

## What to do

Keep modules few and meaningful, cut along bounded contexts, apply YAGNI to splitting, and merge modules that are usually changed or deployed together, often into a modular monolith.

## Example

None: It is about how many modules a system has and how they change together, which shows across repos and history, not in one snippet.

## Related

[Under-Modularization](under-modularization.md) · [Distributed Monolith](distributed-monolith.md) · [YAGNI](yagni.md) · [Fallacies of Distributed Computing](fallacies-of-distributed-computing.md)

## In the interview

- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)

## Sources

- [INNOQ, Architecture Antipatterns, Over-Modularization](https://architecture-antipatterns.tech/patterns/over_modularization.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Splitting a checkout system into too many services](https://architecture-antipatterns.tech/case_studies/splitting_a_checkout_system.html) (read)
