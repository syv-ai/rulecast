<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Front Controller

`front-controller` · design patterns, architecture

Route every request through one handler that runs the shared steps (auth, logging, error handling) and then dispatches to the specific handler; in today's frameworks this is the router plus its middleware pipeline.

*Names:* Named in Sun's Core J2EE Patterns and in Fowler's PoEAA (2002), as the alternative to Page Controller (one handler per page). Spring's DispatcherServlet, the ASP.NET Core middleware pipeline, Express and Koa middleware, Django and ASGI middleware, Go's http.Handler wrapping and Rust's tower layers are all forms of it.

*Matters most for:* web-api, fullstack-web

*Applies only to:* web-api, fullstack-web, web-frontend

## But

Every web framework already gives you one, so the decision is rarely whether to build it but what belongs in it. Keep middleware to concerns that really apply to all or most routes; route-specific rules belong with the route (a dependency, a guard or a per-route filter). Order-dependent pipelines are a common source of bugs, such as auth running after a handler that already read the body.

## Quality axes

- **change_cost** ⊕ (primary): Cross-cutting behaviour such as a new header or tracing system changes in one place instead of in every handler.
- **security** +: Authentication runs in front of every route, so no handler can forget it.
- **operability** +: Request ids, logging and error mapping are applied uniformly to every request.

**Flips:** Business logic or per-route special cases in middleware, and long pipelines whose order nobody wrote down, cause order bugs such as auth running after the body was read, turning security and reliability "-".

## Warranted when

- Every handler starts with the same auth check, logging or error handling, and some forget it.
- Cross-cutting behaviour must change in one place (a new header, a new tracing system).

## How it shows

- One app or router object where routes are registered and middleware is added in order.
- Middleware or filter classes for auth, request ids, logging, CORS and error mapping.
- Handlers with no copy of those concerns.

## Overdone when

- Business logic in middleware (pricing rules, per-route special cases with if path == ...).
- Long pipelines whose order matters in ways nobody wrote down.
- Middleware that stuffs many loosely typed values into a request context, which handlers then read without the compiler's help.

## Example

Before:

```
fn list_recipes(req):
    user = verify_token(req.header("Authorization"))
    if not user: return 401
    log_request(req, user)
    try: return ok(recipes.list_for(user))
    except err: return error_response(err)

fn save_recipe(req):
    log_request(req, None)              # this one forgot the auth check
    try: return ok(recipes.save(parse(req.body)))
    except err: return error_response(err)
```

After:

```
app = Router()
app.use(request_logging)
app.use(error_mapping)
app.use(require_auth)                   # sets req.user or returns 401

app.get("/recipes", fn(req): ok(recipes.list_for(req.user)))
app.post("/recipes", fn(req): ok(recipes.save(req.user, parse(req.body))))
```

The shared steps run once in front of every route, so no handler can forget them.

## By language

**java:** Spring's DispatcherServlet is the front controller; servlet filters and HandlerInterceptors carry the shared steps, Spring Security being a filter chain.

**csharp:** The ASP.NET Core middleware pipeline built in Program.cs; order of UseAuthentication, UseAuthorization and endpoint mapping matters. Endpoint filters handle per-route concerns.

**python:** ASGI or WSGI middleware in FastAPI and Django; FastAPI's dependencies are the better home for per-route concerns like loading the current user.

**typescript:** Express, Koa, Fastify hooks and NestJS guards and interceptors; Next.js has a single proxy file (called middleware before Next.js 16) in front of routes.

**go:** An http.ServeMux or router with handlers wrapped by func(http.Handler) http.Handler middleware; values passed through context.Context should be few and typed by unexported keys.

**rust:** axum and tower Layers, or actix middleware, wrap the router; extractors handle per-route concerns in a typed way.

## Related

[Chain of Responsibility](chain-of-responsibility.md) · [Decorator](decorator.md) · [Command](command.md) · [Fat Controller](fat-controller.md) · [Mediator](mediator.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Front Controller (catalog summary)](https://martinfowler.com/eaaCatalog/frontController.html) (read)
- [Sun Microsystems, Core J2EE Patterns, Front Controller](https://www.oracle.com/java/technologies/front-controller.html) (recalled)
- [Microsoft, ASP.NET Core Middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) (recalled)
