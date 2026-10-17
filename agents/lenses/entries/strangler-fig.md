<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Strangler Fig

`strangler-fig` · design patterns, architecture

Replace a legacy system piece by piece: put a routing layer in front of it, move one capability at a time into the new system, shift traffic over, and retire the old one when nothing routes to it.

*Names:* Named by Martin Fowler, first as "Strangler Application" (2004), later retitled "Strangler Fig Application" to restore the botanical image he saw in Queensland in 2001. Often shortened to strangler pattern. Fowler credits Cartwright, Horn and Lewis for its four activities in later writing; Sam Newman's Monolith to Microservices (2019) is the standard book treatment.

*Matters most for:* web-api, fullstack-web, distributed, platforms

## But

It needs interceptable seams, and legacy systems rarely have clean ones, so finding them is most of the work. Running two systems costs money and attention; without a plan to finish, the strangler becomes one more layer on the mess. Data is the hard part: shared databases between old and new often survive long after the code has moved. Microsoft's guidance notes it fits poorly when requests can't be intercepted, when you can't change the legacy code, or when the old system must be gone quickly. Fowler adds that without organisational change, Conway's law will rebuild the old structure in the new system.

## Quality axes

- **change_cost** ⊕ (primary): A legacy system is replaced in small, reversible steps instead of a risky big-bang rewrite, and it stops being in the way piece by piece.
- **reliability** +: One capability moves at a time behind a router, so there is no big-bang cutover to fail and traffic can be shifted back.
- **operability** −: Old and new systems, the routing layer and data sync jobs all have to be run and monitored during coexistence.

**Flips:** Without a plan to finish, it leaves two systems and a facade running indefinitely, turning change_cost "-"; for a small system a one-go replacement is cheaper.

## Warranted when

- A large system must be modernised but can't be frozen for a rewrite.
- The business can't afford a big-bang cutover risk.
- Some capabilities are worth migrating early and others may never be worth it.
- Requests can be intercepted at a boundary (HTTP, messages, a module interface).

## How it shows

- A proxy, gateway or routing table that sends some paths or features to the new system and the rest to the old one.
- Feature flags or percentage rollouts choosing between legacy and new implementations of one capability.
- An anti-corruption layer translating between the new model and the legacy one during coexistence.
- Change data capture or sync jobs keeping old and new data stores aligned for a while.

## Overdone when

- Strangling a small system that could be replaced in one go.
- A migration with no end date, leaving two systems and a facade running indefinitely.
- Copying every legacy behaviour faithfully, including the parts nobody wants.

## Example

Before:

```
# all permit traffic goes to the legacy app
route("/permits/*") -> legacy_permits_app

# plan: rewrite the whole permit system, switch over in one release
```

After:

```
fn route(request):
    if request.path.starts_with("/permits/apply") and flags.on("new_apply", request.user):
        return new_permits_service.handle(request)
    if request.path.starts_with("/permits/status"):
        return new_permits_service.handle(request)      # fully migrated
    return legacy_permits_app.handle(request)           # everything not yet moved

# each capability moves behind the router; legacy is deleted when nothing reaches it
```

A routing facade decides per capability which system answers, so migration happens in small, reversible steps.

## Related

[Big Ball of Mud](big-ball-of-mud.md) · [Shared Database](shared-database.md) · [Facade](facade.md) · [Second-System Effect](second-system-effect.md)

## In the interview

- [Find the parts nobody touches and the parts only one person understands, and ask which is which.](../THINKING.md#frozen-code-gets-its-own-rule)

## Sources

- [Martin Fowler, Strangler Fig Application (bliki, 2004, since revised)](https://martinfowler.com/bliki/StranglerFigApplication.html) (read)
- [Azure Architecture Center, Strangler Fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig) (read)
- Sam Newman, Monolith to Microservices (2019) (recalled)
