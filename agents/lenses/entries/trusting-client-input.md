<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Trusting client input

`trusting-client-input` · anti-patterns, security

A rule is enforced only in the browser, the mobile app or the game client (a validation, a price, a permission, a hidden field), and the server accepts whatever arrives, though anyone can send the request without that client.

*Names:* MITRE's CWE-602, Client-Side Enforcement of Server-Side Security, and CWE-472 (external control of an assumed-immutable parameter). The OWASP Top 10 2025 maps CWE-602 to A06:2025 Insecure Design, and the Input Validation Cheat Sheet requires server-side checks. Game developers call the opposite server-authoritative design.

*Matters most for:* web-frontend, fullstack-web, mobile, games, web-api

## But

Single-player games, offline tools and apps with no server-side shared state have nothing to protect from their own user, so client checks are enough there. Peer-to-peer and latency-sensitive games trade some server authority for responsiveness on purpose and detect cheating after the fact. The rule is about data that crosses to a system someone else relies on.

## Quality axes

- **delivery** +: The check is written once, in the UI, where it already gives feedback and seems to work.
- **security** −: Anyone who sends the request without the client can set prices, roles or limits the UI was meant to enforce.
- **reliability** −: Bad input from older or buggy clients, integrations or scripts reaches storage because only the UI checked it.

**Flips:** Single-player games, offline tools and apps with no shared server state have nothing to protect from their own user; latency-sensitive games trade server authority for responsiveness on purpose.

## Why people fall into it

- The UI needs validation for instant feedback, so it gets written there first, and it seems to work.
- Frontend and backend are written by different people or at different times, and each assumes the other checks.
- Computing the total on the client avoids a round trip.
- The API is "only called by our app", until someone opens the network tab.

## How it shows

- Form validation (required, max length, format) in the frontend with no matching check in the API handler.
- Totals, prices, discounts or scores computed on the client and sent to the server, which stores them.
- Hidden form fields or request fields for user id, role, tenant or price that the server uses as is.
- Buttons hidden for non-admins in the UI while the API endpoint has no role check.
- A mobile app that enforces purchase or feature limits locally.
- Server code that relies on headers the client controls (X-Forwarded-For, X-User-Id) without a trusted proxy setting.

## Overcorrecting looks like

- Removing client-side validation because it isn't a security control; it is still the best user experience.
- Recomputing on the server things that carry no risk, such as display formatting.

## What to do

Treat every request as written by an attacker. Enforce each rule on the server, and keep the client checks for feedback only. Have the server compute anything with value (price, total, score) from its own data, take identity and role from the session, not from fields, and share one schema between client and server where the stack allows so the two checks can't drift.

## Example

Before:

```
# browser
total = course.price * (1 - coupon.percent / 100)
api.post("/enrolments", {"course_id": course.id, "total": total})

# server
route POST "/enrolments"
fn enrol(body: EnrolmentRequest, user: User):
    charge(user, body.total)
    enrolments.create(user.id, body.course_id)
```

After:

```
# browser
api.post("/enrolments", {"course_id": course.id, "coupon": coupon.code})

# server
route POST "/enrolments"
fn enrol(body: EnrolmentRequest, user: User):
    course = courses.get(body.course_id)
    discount = coupons.valid_discount(body.coupon, course, user)
    charge(user, course.price.less(discount))
    enrolments.create(user.id, course.id)
```

The server prices the enrolment from its own data, so editing the request can't change what is charged; the browser can still show the same total for feedback.

## By language

**typescript:** Next.js server actions and API routes are public HTTP endpoints, so the zod schema or role check must run inside them, not only in the form component. Sharing one zod schema between the form and the handler keeps them in step.

**csharp:** Blazor WebAssembly runs in the browser, so its DataAnnotations validation is client-side only; the API must validate again. Blazor Server runs on the server, but the API it calls should still check.

**python:** FastAPI's Pydantic request models and Django forms run on the server, which makes them the place for the rules; a JavaScript form check in a Django template is feedback only.

## Related

[Validate at the boundary](validate-at-the-boundary.md) · [Mass assignment](mass-assignment.md) · [Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Defense in depth](defense-in-depth.md)

## Overlaps

validate-at-the-boundary says where checks belong, parse-dont-validate how to make them stick (turn input into a type that can't be invalid), and trusting-client-input is the failure of checking only on the client.

## Sources

- [OWASP Top 10 2025, A06:2025 Insecure Design, CWE-602 (CC BY 3.0)](https://top10.owasp.org/2025/A06_2025-Insecure_Design/) (read)
- [OWASP Cheat Sheet Series, Input Validation, server-side vs client-side (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) (read)
- [MITRE CWE-602, Client-Side Enforcement of Server-Side Security](https://cwe.mitre.org/data/definitions/602.html) (recalled)
