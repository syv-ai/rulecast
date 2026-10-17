<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Validate at the boundary

`validate-at-the-boundary` · practices, security

Check data where it enters from a less trusted place (a request, a file, a queue, a CLI argument, a third-party API), against an allow-list of what is acceptable, and reject the rest there, so the code inside can rely on what it receives.

*Names:* Also called input validation at trust boundaries; the trust boundary comes from threat modelling (Howard and LeBlanc, Shostack). OWASP's Input Validation Cheat Sheet and Proactive Controls set the practice. Alexis King's "Parse, don't validate" (2019) is the type-driven form: turn the checked input into a type that can't hold invalid values (see parse-dont-validate).

*Matters most for:* web-api, cli-devtool, data-pipeline, library-sdk, plugin-host, event-driven

## But

The boundary is where trust changes, which isn't always the outer edge: a message queue fed by another team, a file written by a user, a plugin's return value are boundaries too, and treating only HTTP as one misses them. Validation at the edge doesn't replace business invariants in the domain or encoding at output. Postel's law (be liberal in what you accept) pulls the other way for protocols and public APIs, and its critics argue that liberal acceptance entrenches broken input; a strict boundary with clear errors is the safer default for application input. Parse, don't validate goes further and argues the check should produce a type, not a boolean, so the evidence can't be lost.

## Quality axes

- **security** ⊕ (primary): Untrusted input from requests, files, queues and partner APIs is checked against an allow-list before any business code touches it.
- **reliability** ⊕ (primary): Bad but honest data is rejected where it enters, with a clear error, instead of reaching storage or failing deep inside.
- **change_cost** +: Inner code can rely on what it receives and doesn't repeat defensive format checks.
- **delivery** −: Every entry point needs a schema with limits written and kept up to date.

**Flips:** Over-strict rules reject real input, such as names with apostrophes or non-Latin scripts. Treating validation as the defence against injection or XSS leaves security "-" at the sink.

## Warranted when

- Data enters from several places (HTTP, CLI, files, queues, plugins) and the same checks are scattered or missing inside.
- Functions deep in the code re-check the same strings defensively because they can't tell whether anyone checked.
- A partner API or another team's service sends data you don't control (OWASP's API10:2023, unsafe consumption of APIs).
- Bad data has been found in storage, and nobody knows which path let it in.

## How it shows

- Request schemas (Pydantic, zod, Bean Validation, DataAnnotations) on every handler, rejecting bad input with a 400 before business code runs.
- Messages from queues and rows from third-party APIs parsed into typed records at the consumer's edge.
- Domain code that takes typed values (EmailAddress, a date range) and has no defensive checks of its own for format.
- Size, length and count limits applied before parsing large bodies.
- Unknown fields rejected or ignored by an explicit choice.

## Overdone when

- Treating validation as the defence against injection or XSS; it isn't, and OWASP is explicit that parameterized queries and output encoding are still needed at the sink.
- Over-strict rules that reject real input (names with apostrophes, non-Latin scripts, long TLDs, plus signs in emails).
- Validating at the boundary only, then letting invariants that matter (balance never negative) go unchecked in the domain, where they belong.
- Validating internal calls between modules of the same program as if each were a trust boundary.

## Example

Before:

```
fn ingest(message: dict):
    store_reading(message)

fn store_reading(m: dict):
    if m.get("celsius") is None: return        # silently dropped
    db.insert("readings", m)                   # whatever keys arrived

fn alert_if_hot(m: dict):
    if float(m["celsius"]) > 80: ...           # may crash on bad input
```

After:

```
class Reading:
    sensor_id: SensorId
    celsius: float       # -60..150
    taken_at: Timestamp

fn ingest(message: dict):
    reading = Reading.parse(message) or return dead_letter(message, reason)
    store_reading(reading)
    alert_if_hot(reading)

fn alert_if_hot(r: Reading):
    if r.celsius > 80: ...
```

The message is checked once at the queue consumer and becomes a typed Reading, so inner functions stop re-checking and bad messages go to a dead-letter queue with a reason instead of vanishing.

## By language

**python:** FastAPI validates Pydantic request models before the handler runs; Django forms and DRF serializers do the same. Pydantic models with constrained types (constr, conint, Annotated validators) carry the result inward.

**typescript:** TypeScript types are erased at runtime, so a type annotation on req.body checks nothing. A runtime schema (zod, valibot, io-ts) at the handler, with z.infer for the inner type, is the boundary.

**java:** Bean Validation (@Valid on a @RequestBody, with @NotNull, @Size, @Pattern) runs at the Spring MVC boundary; records with checks in their compact constructors carry it inward.

**csharp:** [ApiController] returns 400 automatically when DataAnnotations fail on the bound model. Since .NET 10, minimal APIs do the same once AddValidation() is registered: DataAnnotations on handler parameters and their types are checked, and failures return a 400 problem-details response. FluentValidation is now usually called explicitly in the handler or from an endpoint filter, since its auto-validation package is deprecated. Binding to a record with required members and value objects keeps the checked shape inside.

**go:** There is no built-in validator; decode into a struct, then validate in a constructor or with go-playground/validator, and return a typed value rather than passing the raw struct on.

**rust:** serde with #[serde(try_from = "...")] or a newtype implementing TryFrom rejects invalid values while deserializing, so the rest of the code holds only checked types.

## Related

[Parse, Don't Validate](parse-dont-validate.md) · [Trusting client input](trusting-client-input.md) · [Injection (SQL, command, template)](injection.md) · [Postel's Law](postels-law.md) · [Primitive Obsession](primitive-obsession.md) · [Defense in depth](defense-in-depth.md)

## Overlaps

validate-at-the-boundary says where checks belong, parse-dont-validate how to make them stick (turn input into a type that can't be invalid), and trusting-client-input is the failure of checking only on the client.

## Sources

- [OWASP Cheat Sheet Series, Input Validation (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A05:2025 Injection, validation as a secondary defence (CC BY 3.0)](https://top10.owasp.org/2025/A05_2025-Injection/) (read)
- [OWASP API Security Top 10 2023, API10:2023 Unsafe Consumption of APIs (CC BY-SA 4.0)](https://api-security.owasp.org/editions/2023/en/0xaa-unsafe-consumption-of-apis/) (recalled)
- [Alexis King, Parse, don't validate (2019)](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) (recalled)
- Howard and LeBlanc, Writing Secure Code, 2nd ed. (2002), trust boundaries and threat modelling (recalled)
