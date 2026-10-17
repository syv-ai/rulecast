<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fat Controller

`fat-controller` · anti-patterns, architecture · **agents do this**

Route handlers or controllers that hold the business logic themselves (validation rules, calculations, queries, side effects) instead of parsing the request, calling the application and shaping the response.

*Names:* The opposite of the Rails-era advice "skinny controller, fat model" (Jamis Buck, 2006). Also called Massive View Controller in iOS, where the same thing happens to UIViewController.

*Matters most for:* web-api, fullstack-web

*Applies only to:* web-api, fullstack-web, mobile

## But

For CRUD endpoints and small apps, a handler that reads, writes and returns is the simplest correct code, and querying from handlers is fine at that size. The smell is business rules that will be needed elsewhere, or handlers too long to read, not the mere presence of a database call. Moving logic into the model can also overshoot into fat models; the aim is logic with a home that isn't tied to HTTP.

## Quality axes

- **delivery** +: The handler is the fastest place to add one more check under a deadline.
- **change_cost** −: Business rules tied to HTTP can only be tested through a test client and get copied to reuse them from a CLI or job.

**Flips:** For CRUD endpoints and small apps, a handler that reads, writes and returns is the simplest correct code.

## Why people fall into it

- Framework tutorials and scaffolding put everything in the handler.
- It is the fastest place to add one more check under a deadline.
- Fear of over-engineering, so no service layer or domain model is ever introduced, even as logic grows.
- Coding agents asked to add a feature to an endpoint put it in the endpoint.

## How it shows

- Handler functions of fifty lines or more that query the database, apply rules and send emails.
- Controllers importing the ORM session, payment clients and mailers directly.
- The same rule appearing in an HTTP handler and again in a CLI command or background job.
- Business logic tested only through HTTP test clients because it can't be called any other way.

## Overcorrecting looks like

- A service for every handler whose method only forwards the call (Middle Man), or a service, an interface and a mapper for a two-line read.
- Banning all logic from handlers, including request-specific concerns that belong there (status codes, headers, content negotiation).

## What to do

Extract the use case into a function or service (Extract Function, then Move Function into a service layer or onto the domain object), leaving the handler to parse input, call one operation and map the result or error to a response.

## Example

Before:

```
fn post_registration(req):
    body = parse(req.body)
    event = db.query_one("SELECT * FROM events WHERE id = ?", body.event_id)
    taken = db.query_one("SELECT count(*) FROM registrations WHERE event_id = ?", event.id)
    if taken >= event.capacity: return 409
    price = event.price * (0.8 if body.member else 1.0)
    if today() < event.early_bird_until: price = price - 10
    db.execute("INSERT INTO registrations ...", event.id, body.email, price)
    mailer.send(body.email, "You're in", ...)
    return 201
# the box office CLI reimplements the pricing, slightly differently
```

After:

```
fn register(event_id, email, member: bool) -> Registration:
    event = events.get(event_id)
    reg = event.register(email, member, today())   # capacity and pricing rules live here
    registrations.add(reg)
    mailer.send(email, "You're in", ...)
    return reg

fn post_registration(req):
    body = parse(req.body)
    try: return created(register(body.event_id, body.email, body.member))
    except EventFull: return 409
```

The handler only translates HTTP, and the rules can be called from the CLI or a test without a request.

## By language

**python:** In FastAPI, path operation functions that use the session directly are the template style; move rules out when a second entry point or a second rule appears. In Django, the idiom is fat models or a services module, not views.

**java:** In Spring, @Controller methods with repository calls are fine for CRUD; business rules go in @Service classes or entities.

**csharp:** ASP.NET Core controllers or minimal API lambdas; application services or handler classes are the common move out. MediatR is the familiar handler library. Since 13.0 (2025) MediatR is dual-licensed, RPL-1.5 or commercial, with a free community licence for small organisations; 12.x stays Apache 2.0. Plain handler classes registered in DI do the same job without it.

**typescript:** Express route callbacks are where it grows; NestJS pushes logic into providers by structure.

**go:** http.HandlerFunc bodies that do everything are common in small services; extract a service struct when logic grows.

**rust:** axum or actix handler functions; keep them to extractors in, a call to a function or service, and a response out.

## Related

[Service Layer](service-layer.md) · [Front Controller](front-controller.md) · [God object (The Blob)](god-object.md) · [Long Method](long-method.md) · [Large Class](large-class.md) · [Duplicate Code](duplicate-code.md) · [Transaction Script](transaction-script.md)

## Sources

- [Jamis Buck, Skinny Controller, Fat Model (2006)](http://weblog.jamisbuck.org/2006/10/18/skinny-controller-fat-model) (recalled)
- [Martin Fowler, Patterns of Enterprise Application Architecture, Service Layer (catalog summary)](https://martinfowler.com/eaaCatalog/serviceLayer.html) (read)
