<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Distributed Monolith

`distributed-monolith` · anti-patterns, architecture

A system split into services that still must be deployed together and fail together, so it carries the costs of distribution without the independence it was supposed to buy.

*Matters most for:* distributed, serverless, event-driven, platforms

*Applies only to:* distributed, serverless, event-driven, platforms

## But

If the parts really must change together, a well-structured monolith is the honest answer; Sam Newman and others advise starting there and splitting only when independent deployment is needed. Some coordinated releases are normal during a migration or a breaking API change. The anti-pattern is when lockstep deployment and shared failure are the steady state.

## Quality axes

- **reliability** −: Services fail together; one slow or down service in a synchronous chain fails the whole request.
- **change_cost** −: Shared models must be upgraded in lockstep across services, so every change spans repos.
- **runtime** −: Calls that would be in-process in a monolith become network hops.
- **operability** −: Releases need services deployed in a fixed order, and testing any one needs all of them running.
- **delivery** −: A feature routinely needs pull requests in several repos and deploys in a fixed order.

## Why people fall into it

- a monolith split along technical layers or entities instead of business capabilities
- microservices adopted for their reputation rather than a need for independent deployment or scaling
- shared code libraries look like good reuse, so domain types get shared across services
- synchronous request/response is the familiar way to call code, so it carries over to the network
- the domain is genuinely tightly coupled, and splitting it anyway forced the coupling onto the wire

## How it shows

- releases that need several services deployed in a fixed order
- a shared library of domain models or DTOs that every service must upgrade in lockstep
- long synchronous call chains where one slow or down service fails the whole request
- a feature routinely needing pull requests in several service repos
- end-to-end test environments where every service must be running to test any one
- services sharing a database (see Shared Database)

## Overcorrecting looks like

- forbidding all shared code, so each service re-implements logging, auth clients and retries
- turning every call asynchronous to avoid runtime coupling, making simple flows hard to follow and debug

## What to do

Redraw boundaries around business capabilities so services own their data and change independently, replace lockstep shared models with versioned contracts, prefer asynchronous events where a synchronous chain isn't needed, or merge the services back into a modular monolith.

## Example

None: The defining traits, lockstep deploys and shared failure, live in release history and runtime behaviour across services, not in one snippet.

## Related

[Over-Modularization](over-modularization.md) · [Shared Database](shared-database.md) · [Fallacies of Distributed Computing](fallacies-of-distributed-computing.md)

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)
- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)

## Sources

- [Newman, Monolith to Microservices (2019), on the distributed monolith](https://samnewman.io/books/monolith-to-microservices/) (recalled)
- [INNOQ, Architecture Antipatterns, case study: Splitting a checkout system into too many services](https://architecture-antipatterns.tech/case_studies/splitting_a_checkout_system.html) (read)
