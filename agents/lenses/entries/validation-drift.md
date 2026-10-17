<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Validation drift

`validation-drift` · smells, design · **agents do this**

The same input rules are written separately in the front end and the back end (or in a client and a server, or two services), and the copies drift apart, so the form accepts what the API rejects or the API accepts what the form never would.

*Names:* A plain practitioners' name with no single coiner. Hunt and Thomas, The Pragmatic Programmer (2nd ed., 2019), call the general case representational duplication and recommend generating both sides from one schema. OWASP's Input Validation Cheat Sheet sets the server as the authority and client-side checks as a convenience.

*Matters most for:* fullstack-web, web-frontend, mobile, web-api

## But

Some rules belong to one side only: uniqueness needs the database, and a password-strength meter is a UI concern. A client may be looser on purpose and leave the final word to the server, which is fine as long as the server checks everything. Generated schemas don't express every rule (cross-field and database-dependent checks), so sharing covers the simple rules and the rest still needs server-side handling. For a small app with a handful of fields, two short copies may cost less than a code-generation step, as long as the server's copy is complete.

## Quality axes

- **delivery** +: Copying a regex is quicker than setting up schema generation.
- **reliability** −: The form accepts what the API rejects, or the reverse, so users hit generic errors and bad data gets in on whichever side is looser.
- **security** −: A rule enforced only in the client isn't enforced at all, because an attacker can call the API directly.
- **change_cost** −: Every rule change has to be made on both sides, often in two languages, and kept in step.

**Flips:** For a small app with a few fields, two short copies can cost less than a code-generation step, as long as the server's copy is complete and authoritative.

## Why people fall into it

- The UI needs instant feedback, so the rule is written there first, then again on the server.
- Front end and back end are in different languages, so the code can't simply be shared.
- Separate people or teams own each side and change them at different times.
- Setting up schema generation feels heavier than copying a regex.

## How it shows

- The same length limit, pattern or allowed list written in a form schema (zod, Yup, a form library) and in a server model (Pydantic, Bean Validation, DataAnnotations).
- A limit enforced on one side only, such as a maximum the server checks and the form never does.
- Different error messages, or different limits, for what is meant to be one rule.
- Users who pass the form and then get a generic error from the API.
- Hand-written client types for API payloads next to a server that publishes an OpenAPI or JSON Schema document nobody generates from.

## Overcorrecting looks like

- Removing client-side validation to avoid the copy, so every typo costs a round trip.
- Forcing rules that only one side can check (uniqueness, permissions, rate limits) into the shared schema.
- Shipping the server's full models to the browser bundle to share them, leaking internal fields.

## What to do

Make the back end the authority and keep one source for the rules: generate the client's schema and types from the server's (OpenAPI or JSON Schema), share one schema module where both sides use the same language, and map the server's validation errors back to form fields so the server's answer is what the user sees. Where rules can't be shared, run one set of test cases against both validators.

## Example

Before:

```
# server: booking.py
class BookingRequest:
    party_size: int    # between 1 and 12
    notes: str         # at most 500 characters

# client: booking_form.ts
party_size: number, min 1, max 10      # copied once, then the server limit changed
notes: string                          # no maximum here

# a 600-character note passes the form and fails with a generic 422
```

After:

```
# server: booking.py is the source of truth
class BookingRequest:
    party_size: int    # between 1 and 12
    notes: str         # at most 500 characters
# published as OpenAPI by the server build

# client: booking_form.ts
schema = generated.BookingRequest      # regenerated in CI from the OpenAPI document
on_submit_error(err): show_field_errors(err.fields)
```

The client's rules are generated from the server's, and the server's errors are shown per field, so the two can't disagree for long and the server keeps the final word.

## By language

**python:** FastAPI publishes an OpenAPI document from Pydantic models, including length and pattern constraints; client generators (openapi-typescript, Orval, hey-api) turn it into typed clients and, with some, into zod schemas.

**typescript:** In a TypeScript monorepo the same zod schema can be imported by the server and the form. Zod 4's z.toJSONSchema(), or zod-to-openapi, publishes it for clients in other languages.

**java:** springdoc-openapi carries Bean Validation annotations (@Size, @Pattern, @NotNull) into the OpenAPI document, so clients can be generated from it.

**csharp:** The OpenAPI generators read DataAnnotations ([Required], [StringLength], [Range], [RegularExpression]) into the document. That covers both Microsoft.AspNetCore.OpenApi, the default since .NET 9, and Swashbuckle. FluentValidation rules don't appear there without an extra integration package, so they drift more easily.

## Related

[Trusting client input](trusting-client-input.md) · [Validate at the boundary](validate-at-the-boundary.md) · [Duplicate Code](duplicate-code.md) · [DRY (Don't Repeat Yourself)](dry.md) · [Shotgun Surgery](shotgun-surgery.md) · [Parse, Don't Validate](parse-dont-validate.md)

## Sources

- [OWASP Cheat Sheet Series, Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) (recalled)
- [Andrew Hunt and David Thomas, The Pragmatic Programmer (2nd ed., 2019), Topic 9, DRY (representational duplication)](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) (recalled)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) (recalled)
