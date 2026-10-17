<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Chain of Responsibility

`chain-of-responsibility` · design patterns, behavioral

A request passes along a line of handlers, and each one either deals with it or hands it on to the next. Middleware that can stop a request is the everyday form; a pipeline where every stage transforms the data is Pipes and Filters, not this.

*Matters most for:* web-api, fullstack-web, event-driven, plugin-host

## But

Control flow becomes implicit: to know what happens to a request you have to know the assembled chain, which often lives far from the handlers. Order bugs are easy to make and hard to see, and a request can fall off the end unhandled without anyone noticing. When the steps are few and fixed, call them in order in one place. Make the end-of-chain case explicit (a default handler or an error) rather than silently dropping the request.

## Quality axes

- **change_cost** ⊕ (primary): Independent request steps live in separate handlers that can be reordered, reconfigured and reused in front of other endpoints.
- **reliability** −: Order bugs are easy to make and hard to see, and a request can fall off the end of the chain unhandled.
- **operability** −: To know what happened to a request you must know the assembled chain, which often lives far from the handlers.

**Flips:** With one or two fixed steps a plain sequence of calls reads better and the chain is only indirection; an explicit end-of-chain handler removes the silent-drop risk.

## Warranted when

- Several independent checks or steps run on the same request, and they keep getting tangled in one function
- Which steps run, or their order, has to change by configuration or at runtime
- The sender shouldn't know which handler will end up dealing with the request
- The same steps need reusing in front of several different endpoints or components

## How it shows

- A set of handler classes sharing one interface, each holding a reference to the next handler
- A middleware or filter list assembled in a config or setup file, where order matters
- Request-processing code that runs auth, validation, rate limiting and caching as separate steps

## Overdone when

- A chain of one or two fixed handlers that never get reordered, where a plain sequence of calls would read better
- Handlers that all always run and never short-circuit, which is just a loop over functions dressed up as a chain
- Request flow that can only be understood by tracing next-pointers across many files

## Example

Before:

```
fn receive_webhook(req: Request) -> Response:
    if not valid_signature(req.headers, req.body):
        return Response(401)
    if seen_delivery_id(req.headers["delivery-id"]):
        return Response(200)    # replay, ignore
    if over_rate_limit(req.source_ip):
        return Response(429)
    ... # ten more lines of dispatch by event type
# the billing and repo endpoints copy the first three checks, in a different order
```

After:

```
interface WebhookStep:
    fn handle(req: Request, next: fn(Request) -> Response) -> Response

class SignatureCheck implements WebhookStep:
    fn handle(req, next):
        if not valid_signature(req.headers, req.body): return Response(401)
        return next(req)
# ReplayGuard and RateLimit follow the same shape

repo_hooks = chain([SignatureCheck(), ReplayGuard(), RateLimit()],
                   end=dispatch_repo_event)    # explicit end, nothing falls off
billing_hooks = chain([SignatureCheck(), RateLimit()], end=dispatch_billing_event)
```

Each check becomes a step that answers or passes on, so endpoints assemble the same steps in their own order instead of copying them, and the end of the chain is named.

## One-file tell

A class that stores a next handler (a set_next method or a self._next / self.successor field) and whose handle method ends by delegating to it.

## By language

**python:** Usually a list of callables walked in a loop, or nested wrappers like WSGI and Django or Starlette middleware, rather than handler classes with set_next. The source notes it shows up mostly as filters and chains of event handlers.

**typescript:** Fairly common in TypeScript, wherever objects form a chain such as filters or event handlers. The dominant form is middleware, as in Express and Koa: an array of functions, each given a `next` callback. That replaces the linked handler classes. Spotting it: Objects or functions sharing one signature, where each either handles the request or passes it to the next (often via a `next` callback or `setNext` link).

**java:** Fairly common, mainly as filter and interceptor chains: servlet Filter chains, Spring Security's filter chain, and java.util.logging's handler/parent-logger propagation. Frameworks usually pass an explicit chain object to each link rather than having each handler store a next pointer. Spotting it: Objects sharing one interface where a handling method takes or holds the next handler (or a chain object) and decides whether to call it.

**csharp:** Common in C#, especially in filter and pipeline code. ASP.NET Core middleware, where each component gets a delegate to the next one and may short-circuit, and HttpClient's DelegatingHandler chain are the canonical examples. MediatR pipeline behaviours apply the same shape to in-process requests. Prefer composing delegates or using the framework's pipeline over building a linked list of handler objects by hand. Spotting it: Objects sharing an interface where each holds a reference to the next handler (or a RequestDelegate "next") and either handles the request or passes it on.

**go:** The linked-handler version with a setNext method is uncommon. Go usually builds chains as HTTP or gRPC middleware: functions that wrap the next handler, composed in order, each choosing whether to call next. Interceptor chains in gRPC and router middleware stacks are the everyday form. A slice of handlers looped over until one claims the request is the simpler alternative. Spotting it: Handler types holding a next field of the same interface, or a slice of func(next Handler) Handler composed in a loop.

**rust:** Each handler holds an `Option<Box<dyn Handler>>` next link, and a default trait method handles the request and then forwards it. Boxing is the deliberate choice here: nesting generics would fix the whole chain in the type at compile time. A flatter, often more idiomatic option is a `Vec<Box<dyn Handler>>` (or a vec of closures) iterated until one handler returns a result. Middleware stacks such as tower and axum layers are the common real-world form. Spotting it: A trait with `handle` and `next` methods, an `Option<Box<dyn Trait>>` field, and recursion through `next`. Alternatively, a loop over a vector of handlers that stops on the first `Some` or `Ok`.

**cpp:** Common in C++ for filter pipelines and event-processing chains. Handlers are linked through a pointer to the next handler; decide whether the chain owns its links (unique_ptr) or only refers to them, because dangling next pointers are the typical bug. A vector of std::function handlers walked in a loop is a lighter alternative. Spotting it: Objects sharing a handler interface, each holding a pointer to the next and either handling a request or passing it on through the same method.

## Related

[Decorator](decorator.md) · [Composite](composite.md) · [Command](command.md) · [Mediator](mediator.md) · [Observer](observer.md)

## Sources

- [Refactoring.Guru, Design Patterns: Chain of Responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility) (read)
- [Refactoring.Guru, Chain of Responsibility in Python](https://refactoring.guru/design-patterns/chain-of-responsibility/python/example) (read)
- [Refactoring.Guru, Chain of Responsibility in TypeScript](https://refactoring.guru/design-patterns/chain-of-responsibility/typescript/example) (read)
- Established TypeScript practice (Express/Koa middleware) (recalled)
- [Refactoring.Guru, Chain of Responsibility in Java](https://refactoring.guru/design-patterns/chain-of-responsibility/java/example) (read)
- Spring Security filter chain (recalled)
- [Refactoring.Guru, Chain of Responsibility in C#](https://refactoring.guru/design-patterns/chain-of-responsibility/csharp/example) (read)
- ASP.NET Core middleware; MediatR pipeline behaviors (recalled)
- [Refactoring.Guru, Chain of Responsibility in Go](https://refactoring.guru/design-patterns/chain-of-responsibility/go/example) (read)
- [gRPC-Go, interceptors](https://pkg.go.dev/google.golang.org/grpc#UnaryServerInterceptor) (recalled)
- [Refactoring.Guru, Chain of Responsibility in Rust](https://refactoring.guru/design-patterns/chain-of-responsibility/rust/example) (read)
- tower/axum middleware layering (recalled)
- [Refactoring.Guru, Chain of Responsibility in C++](https://refactoring.guru/design-patterns/chain-of-responsibility/cpp/example) (read)
