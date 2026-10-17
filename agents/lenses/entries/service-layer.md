<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Service Layer

`service-layer` · design patterns, architecture

Define the application's operations in one layer that every entry point (HTTP, CLI, queue consumer) calls, so each use case coordinates transactions, authorisation and domain calls in one place.

*Names:* Named in Fowler's PoEAA (2002), where the pattern is credited to Randy Stafford. Called the application layer or application services in Evans's DDD, and use cases or interactors in Clean Architecture.

*Matters most for:* web-api, fullstack-web, event-driven

## But

With a single entry point and simple logic, a service layer is one more hop with nothing to coordinate, and the handler can be the use case. Fowler's own warning is that service layers tend to soak up domain logic; in DDD the application service should stay thin and delegate rules to the domain model. Watch for pass-through services, which are Middle Man at layer scale.

## Quality axes

- **change_cost** ⊕ (primary): Each use case is defined once and called by HTTP, CLI and workers, so a change to it is made in one place.
- **security** +: Authorisation is checked in the use case, so no entry point can skip it.
- **reliability** +: Transaction boundaries are opened in one place per use case, so an operation commits or rolls back as a whole whichever entry point called it.
- **delivery** −: One more hop and class to write between handlers and the work.

**Flips:** With a single entry point and simple logic it is a pass-through layer, and services that soak up domain rules leave an anaemic domain model that raises change_cost.

## Warranted when

- More than one entry point (web, CLI, jobs, message consumers) needs the same operation.
- Transaction handling, auth checks or notifications are repeated across handlers.
- Business logic is leaking into controllers (see fat-controller).

## How it shows

- Classes or modules named per use case or per area (BillingService, place_order) called from controllers, CLI commands and workers alike.
- Transaction boundaries and permission checks opened in the service, not in handlers.
- Controllers that parse input, call one service method and format the result.

## Overdone when

- A service per entity whose methods just forward to a repository (CustomerService.get calls CustomerRepository.get).
- Putting all the business rules in services so the domain objects become data holders (see anemic-domain-model).
- An interface plus an implementation for every service when there is only ever one.

## Example

Before:

```
fn http_upgrade_plan(req):
    with db.transaction():
        sub = subscriptions.get(req.sub_id)
        if not req.user.can_manage(sub): return 403
        sub.change_plan(plans.get(req.plan_id))
    billing.prorate(sub)
    return 200

fn cli_upgrade_plan(sub_id, plan_id):
    sub = subscriptions.get(sub_id)    # forgot the transaction and the proration
    sub.change_plan(plans.get(plan_id))
```

After:

```
class SubscriptionService:
    fn upgrade_plan(actor, sub_id, plan_id):
        with self.db.transaction():
            sub = self.subscriptions.get(sub_id)
            require(actor.can_manage(sub))
            sub.change_plan(self.plans.get(plan_id))
        self.billing.prorate(sub)

fn http_upgrade_plan(req): service.upgrade_plan(req.user, req.sub_id, req.plan_id); return 200
fn cli_upgrade_plan(sub_id, plan_id): service.upgrade_plan(SYSTEM, sub_id, plan_id)
```

The use case, with its transaction and side effects, lives once, and both entry points stay thin.

## By language

**java:** The @Service class in Spring is the default home, with @Transactional on its methods. Small Spring MVC apps often skip it and call repositories from controllers, which is reasonable while the rules are few and used in one place.

**csharp:** Application services, or one handler per command or query, are the common forms in ASP.NET Core. MediatR popularised the handler style. Since 13.0 (2025) MediatR is dual-licensed, RPL-1.5 or commercial, with a free community licence for small organisations; 12.x stays Apache 2.0. The licence change led some teams to plain handler classes registered in DI. The handler-per-use-case style avoids a single bloated service class.

**python:** Often plain functions in a services module taking a session or unit of work. Django projects argue about it; many keep logic in models and managers instead, and the Django style guide from HackSoft promotes a services module.

**typescript:** NestJS makes @Injectable services the default layer. In Express or Fastify apps it is usually a plain module of functions.

**go:** Typically a struct holding its dependencies (store, clock, mailer) with methods per use case, called from http handlers and CLI commands.

**rust:** A struct or plain async functions taking the pool or repository traits, called from axum or actix handlers that only extract and respond.

## Related

[Fat Controller](fat-controller.md) · [Anemic Domain Model](anemic-domain-model.md) · [Transaction Script](transaction-script.md) · [Domain Model](domain-model.md) · [Facade](facade.md) · [Middle Man](middle-man.md) · [Unit of Work](unit-of-work.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Service Layer (catalog summary)](https://martinfowler.com/eaaCatalog/serviceLayer.html) (read)
- [Martin Fowler, AnemicDomainModel (bliki, 2003)](https://martinfowler.com/bliki/AnemicDomainModel.html) (read)
- [Eric Evans, Domain-Driven Design (2003), Layered Architecture](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (recalled)
