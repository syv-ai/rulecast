<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Inconsistent Error Contract

`inconsistent-error-contract` · anti-patterns, api · **agents do this**

Endpoints or commands of one API report failure in different ways, with different status codes, body shapes, field names or exit codes for the same kind of error, so clients have to special-case each one.

*Names:* Also called Inconsistent error responses. A descriptive name, not a coined one. Problem details for HTTP are the standard answer, RFC 7807 (2016) by Mark Nottingham and Erik Wilde, replaced by RFC 9457 (2023) by Nottingham, Wilde and Sanjay Dalal. Google's AIP-193 sets the same discipline for gRPC and HTTP APIs.

*Matters most for:* web-api, fullstack-web, cli-devtool, platforms, serverless

## But

An API that wraps several upstreams may have to pass some errors through as they come, and should say so. Changing the shape of an existing API's errors is itself a breaking change for clients that parse them, so on a public API the fix may need a new version rather than an in-place cleanup. For a small internal API with one client, a lighter convention is enough.

## Quality axes

- **delivery** +: Each endpoint builds its own error response under deadline without waiting for a shared handler.
- **reliability** −: Clients misread failures, such as treating a 200 with an error body as success.
- **change_cost** −: Every client needs per-endpoint error parsing, and each new endpoint invents another shape.
- **operability** −: Status codes and error shapes mean different things per endpoint, so error-rate monitoring and alerts miss failures reported differently.

**Flips:** For a small internal API with one client a lighter convention is enough, and an API wrapping several upstreams may have to pass their errors through as they come.

## Why people fall into it

- Each endpoint or command was written separately, often by different people or agents, and each built its own error response.
- The framework's default error handler produces one shape and handwritten handlers produce another.
- No shared error type or middleware existed when the first endpoints were written.
- Error handling is the last thing written under a deadline.

## How it shows

- One endpoint returns {"error": "..."}, another {"message": ...}, another a plain string or an HTML error page.
- 200 OK with an error in the body on some endpoints and 4xx on others for the same failure.
- 400, 422 and 500 used interchangeably for invalid input.
- A CLI that exits 1 for everything on some subcommands and uses distinct codes on others, or prints errors to stdout on some.
- Framework default error pages leaking through for unhandled exceptions next to hand-built error bodies.
- Client code with a per-endpoint parser for errors.

## Overcorrecting looks like

- A rigid error envelope with dozens of mandatory fields nobody fills in meaningfully.
- Mapping every distinct internal failure to its own public error code, which turns internals into API (see breaking-change surface).

## What to do

Define one error shape (RFC 9457 problem details for HTTP, the google.rpc.Status model for gRPC, a documented exit-code table and stderr format for a CLI) and produce it from one place: a global error handler or middleware that maps internal error types to it. Add a contract test that every endpoint's error path matches the shape.

## Example

Before:

```
fn get_booking(id):
    booking = bookings.find(id)
    if booking is None:
        return Response(404, {"error": "not found"})
    ...

fn cancel_booking(id):
    booking = bookings.find(id)
    if booking is None:
        return Response(200, {"ok": False, "msg": "No such booking"})
    ...
```

After:

```
class BookingNotFound(AppError):
    status = 404
    type = "booking-not-found"

fn get_booking(id):
    booking = bookings.find(id) or raise BookingNotFound(id)
    ...

fn cancel_booking(id):
    booking = bookings.find(id) or raise BookingNotFound(id)
    ...

# one error handler renders every AppError as a problem-details body
```

Both endpoints raise the same error type and a single handler turns it into one status and one body shape.

## By language

**python:** FastAPI's default validation error (422 with a "detail" list) differs from HTTPException's shape; register exception handlers so both produce the same body.

**java:** Spring's ProblemDetail and ResponseEntityExceptionHandler support RFC 9457 directly; a @ControllerAdvice is the one place to map exceptions.

**csharp:** ASP.NET Core has built-in ProblemDetails support (AddProblemDetails, UseExceptionHandler); without it, model validation and thrown exceptions produce different bodies.

**typescript:** Express and similar frameworks need an error-handling middleware registered last; errors thrown in async handlers may bypass it unless the framework or a wrapper forwards them.

**go:** net/http has no central error hook, so handlers write errors themselves; a handler type that returns error and one adapter that renders it keeps the shape consistent.

## Related

[Error Handling Policy](error-handling-policy.md) · [Breaking-Change Surface](breaking-change-surface.md) · [Drifting terminology](drifting-terminology.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md) · [Hyrum's Law](hyrums-law.md)

## Sources

- [RFC 9457, Problem Details for HTTP APIs (Nottingham, Wilde, Dalal, 2023)](https://www.rfc-editor.org/rfc/rfc9457) (recalled)
- [Google AIP-193, Errors](https://google.aip.dev/193) (recalled)
