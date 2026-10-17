<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fail Fast

`fail-fast` · principles, design

Detect a bad state as early as possible and stop right there with a clear error, instead of carrying on and failing later in a place that hides the cause.

*Names:* Also called Crash early, Dead programs tell no lies. Jim Shore's column "Fail Fast" in IEEE Software (2004), edited by Martin Fowler, named it for software. Hunt and Thomas made the same case as "crash early" in The Pragmatic Programmer (1999). Erlang's "let it crash" is a related idea from Joe Armstrong.

*Matters most for:* cli-devtool, web-api, data-pipeline, library-sdk, serverless

## But

Fail fast is about where a bug is detected, not a licence to crash. At the right boundary, a system can fail fast internally and still degrade gracefully outward: reject one request, skip one record, or let the host carry on (see fail-open vs fail-closed). Erlang pairs "let it crash" with supervisors that restart the failed part, and without that structure crashing is just downtime. Embedded and safety-critical systems often can't stop, and must move to a safe state instead.

## Quality axes

- **reliability** ⊕ (primary): A bad state is stopped where it appears, before corrupt data is written or a later step fails somewhere unrelated.
- **operability** +: A bad deploy refuses to start and names the missing or malformed setting, instead of failing hours later with a misleading stack trace.

**Flips:** When a long-running service crashes on one bad request, or a batch fails on one bad record, without a supervisor or a request boundary, reliability turns "-" and you get downtime.

## Warranted when

- A bug report's stack trace points somewhere unrelated to the real cause.
- Missing or malformed configuration is only discovered when a rare path first runs in production.
- Corrupt data has been written because nothing stopped the code that produced it.
- Invariants live in people's heads instead of in checks.

## How it shows

- Configuration read and checked at startup, with the process refusing to start on bad values.
- Guard clauses and assertions at the top of functions that check inputs and invariants.
- Constructors that reject invalid arguments rather than building a half-valid object.
- Its absence: null checks scattered far from where the null came in, and defaults that hide missing settings.

## Overdone when

- Crashing a long-running service on one bad request instead of rejecting that request.
- Assertions on conditions that are normal in production, such as a dependency briefly unavailable.
- Failing a whole batch for one bad record when the job's contract is to process what it can and report the rest.
- A tool that must not block its host failing closed on its own internal bugs.

## Example

Before:

```
fn start_mailer():
    server = MailServer()
    server.run()

class MailServer:
    fn send_digest(user):
        host = env.get("SMTP_HOST")            # missing in prod
        port = int(env.get("SMTP_PORT", "0"))
        smtp.connect(host, port)               # fails hours later, at 06:00
        ...
```

After:

```
fn start_mailer():
    config = MailConfig(
        host=require_env("SMTP_HOST"),
        port=parse_port(require_env("SMTP_PORT")),
    )                                          # refuses to start if either is wrong
    server = MailServer(config)
    server.run()

class MailServer:
    fn send_digest(user):
        smtp.connect(self.config.host, self.config.port)
        ...
```

Settings are checked when the process starts, so a bad deploy fails at once with the name of the missing variable instead of at the first scheduled send.

## By language

**python:** assert is stripped under -O, so don't use it for checks that must hold in production; raise explicitly.

**java:** Objects.requireNonNull and Guava's Preconditions are the idiomatic guards. assert is disabled by default at runtime.

**csharp:** ArgumentNullException.ThrowIfNull and nullable reference types catch many of these at the boundary or at compile time.

**go:** Return an error early from the constructor or main; reserve panic for broken invariants. Validate flags and config before starting goroutines.

**rust:** The type system does much of this (parse into validated types). debug_assert! only runs in debug builds; use assert! or a returned error for checks that must hold in release.

**typescript:** Types are erased at runtime, so data from outside (JSON, env, CLI args) must be checked at the boundary with a schema validator to fail fast.

## Related

[Swallowed Errors](swallowed-errors.md) · [Error Handling Policy](error-handling-policy.md) · [Fail Open vs Fail Closed](fail-open-vs-fail-closed.md) · [Murphy's Law](murphys-law.md)

## In the interview

- [Ask what would hurt most if it went wrong, and work back to the conventions that stop it.](../THINKING.md#start-from-failure)

## Sources

- [Jim Shore, Fail Fast, IEEE Software (2004)](https://martinfowler.com/ieeeSoftware/failFast.pdf) (recalled)
- [Andrew Hunt and David Thomas, The Pragmatic Programmer, Crash Early](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) (recalled)
- [Joe Armstrong, Making reliable distributed systems in the presence of software errors (2003)](https://erlang.org/download/armstrong_thesis_2003.pdf) (recalled)
