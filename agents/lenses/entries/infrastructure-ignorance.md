<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Infrastructure Ignorance

`infrastructure-ignorance` · anti-patterns, architecture

Designing and building without regard for the environment the system will actually run in (hardware, network, power, security, legal constraints), so it fails requirements in ways that are hard to fix later.

*Matters most for:* embedded, distributed, serverless, mobile

## But

A throwaway prototype or an internal tool on a well-understood standard platform can reasonably ignore most of this. The point is not to front-load every infrastructure decision but to find out early which constraints are hard. INNOQ's page is marked as still in progress and has no case study yet; the fallacies of distributed computing cover much of the network side.

## Quality axes

- **delivery** +: Ignoring the target environment lets the team launch now and fix the rest later.
- **reliability** −: Code designed as if the network were free and reliable fails under real latency, partitions and hardware limits.
- **change_cost** −: Environment constraints found late (residency, deletion, target hardware) force expensive rework of designs already built on.
- **runtime** −: Chatty service calls and unmeasured platform layers add latency the design never accounted for.
- **operability** −: No deployment config or real-target test until late means the first real deploy is where the surprises surface.

**Flips:** A throwaway prototype or an internal tool on a well-understood standard platform can reasonably ignore most of this.

## Why people fall into it

- attention goes to business logic, and the target environment feels like ops' problem
- trust that the cloud or a platform standard takes care of it
- pressure to launch now and fix the rest later
- the real environment isn't available to developers, so the laptop becomes the reference

## How it shows

- no deployment config, target-hardware test or load test until late in the project
- chatty service-to-service calls designed as if the network were free and reliable
- personal data written to append-only stores (event logs, streams) with no deletion path
- a whole platform stack (service mesh, sidecars, encryption everywhere) adopted wholesale without measuring what it costs in latency

## Overcorrecting looks like

- designing for exotic failure modes and scale the system will never see
- blocking all development until a production-identical environment exists

## What to do

Set quality goals and concrete quality scenarios early, build a walking skeleton deployed to the real target, and test load, failure and compliance (deletion, residency) from the start.

## Example

None: The failure is a mismatch between code and its runtime environment, which a snippet without that environment can't show.

## Related

[Fallacies of Distributed Computing](fallacies-of-distributed-computing.md) · [Distributed Monolith](distributed-monolith.md) · [Over-Modularization](over-modularization.md)

## Sources

- [INNOQ, Architecture Antipatterns, Infrastructure Ignorance](https://architecture-antipatterns.tech/patterns/infrastructure_ignorance.html) (read)
