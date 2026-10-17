<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Broken Object Level Authorization (IDOR)

`broken-object-level-authorization` · anti-patterns, security · **agents do this**

A handler loads or changes a record by an id the client sent, and checks that the caller is logged in but never that this caller may see or touch that particular record.

*Names:* Named Insecure Direct Object Reference (IDOR) in the OWASP Top 10 2007 (A4); renamed Broken Object Level Authorization (BOLA) in the OWASP API Security Top 10 2019 (API1), kept as API1:2023. In the main Top 10 it was folded into Broken Access Control in 2017 (A5:2017), which has been A01 since 2021. MITRE's CWE-639, Authorization Bypass Through User-Controlled Key.

*Matters most for:* web-api, fullstack-web, mobile, platforms

## But

Public resources (a product catalogue, published posts) need no per-object check, and adding one there is noise. Internal tools behind a trusted network with a single role may reasonably skip it, though the trust assumption should be written down. Unguessable ids lower the risk but OWASP is clear they are a second layer, not the check. The fix is a design choice about where the rule lives, not a check pasted into each handler.

## Quality axes

- **security** −: Any logged-in user can read or change another user's records by changing an id in the request.

**Flips:** An internal tool with a single role behind a trusted network may reasonably skip per-object checks, if the trust assumption is written down.

## Why people fall into it

- Authentication feels like authorization. An [Authorize] attribute or a login dependency on the route looks like the job is done.
- Scaffolding and CRUD generators produce find-by-id handlers, and the ownership rule is a business fact the generator can't know.
- The list view was written first and filtered by user; the detail view was added later by copying the lookup, not the filter.
- Random ids (UUIDs) give a false sense that nobody can guess them.
- Each endpoint is written alone, so the check has no single home and is easy to forget on the next one.

## How it shows

- A route such as GET /invoices/{id} whose handler calls a find-by-primary-key and returns the result, with no mention of the current user or tenant.
- Update and delete endpoints that take an id and act on it after only an "is authenticated" attribute or middleware.
- Repository methods that take only an id (get_by_id, FindAsync(id), findById) and are the only lookups the handlers use.
- Ownership checked in the list endpoint (filtered by user) but not in the detail, update or delete endpoints beside it.
- Child records reached through a parent id in the path (/orders/{orderId}/items/{itemId}) where the item is loaded by its own id without checking it belongs to that order and that order to the caller.
- No test that logs in as one user and tries to read another user's record.

## Overcorrecting looks like

- Hand-written ownership checks repeated in every handler, which drift; a policy or a scoped query helper is the fix, not more copies.
- Treating every record as private, including catalogue data that is meant to be public.
- Returning 403 for records that exist but belong to someone else, which tells an attacker which ids are real; where existence itself is sensitive, answer 404 for both.
- Encrypting or obfuscating ids in place of a check.

## What to do

Resolve the record through the caller: scope the query to the current user or tenant (find by id and owner id, or start from the user's own collection) so a foreign id simply isn't found. Where the rule is richer than ownership, call one authorization policy with the user, the action and the loaded record. Give the check one home (a policy, a scoped repository, a tenant filter on the data layer) and add a test per endpoint that crosses users.

## Example

Before:

```
route GET "/payslips/{id}" requires login
fn get_payslip(id: str, user: User) -> Payslip:
    payslip = payslips.find_by_id(id)
    if payslip is None:
        return not_found()
    return payslip
```

After:

```
route GET "/payslips/{id}" requires login
fn get_payslip(id: str, user: User) -> Payslip:
    payslip = payslips.find_for_employee(id, employee_id=user.employee_id)
    if payslip is None:
        return not_found()   # someone else's payslip looks the same as a missing one
    return payslip
```

The lookup is scoped to the caller, so a valid id that belongs to someone else is simply not found.

## By language

**python:** Django: get_object_or_404(Invoice, pk=pk, owner=request.user), or override get_queryset in DRF views so detail routes inherit the user filter. FastAPI has no built-in; a dependency that loads the record and checks ownership keeps it out of each handler. SQLAlchemy session.get(Model, id) is the unscoped form.

**typescript:** Prisma findUnique({ where: { id } }) is the unscoped form; findFirst({ where: { id, ownerId } }) scopes it. Express and Next.js route handlers have no authorization layer of their own, so the check lives wherever the team puts it, and Next.js server actions are public endpoints that need it too.

**java:** Spring Security's URL rules and @PreAuthorize("isAuthenticated()") don't cover ownership. Use derived queries such as findByIdAndOwnerId, @PostAuthorize on the loaded object, or a PermissionEvaluator.

**csharp:** [Authorize] checks identity, not the record. ASP.NET Core's resource-based authorization (IAuthorizationService.AuthorizeAsync with the loaded entity and a policy) is the built-in move; EF Core global query filters scope every query to a tenant. DbSet.FindAsync(id) is the unscoped form.

**go:** No framework layer to lean on; pass the caller's id into the store method (GetInvoice(ctx, userID, id)) so an unscoped lookup is not the easy path.

## Related

[Mass assignment](mass-assignment.md) · [Trusting client input](trusting-client-input.md) · [Least privilege](least-privilege.md) · [Defense in depth](defense-in-depth.md) · [Shotgun Surgery](shotgun-surgery.md)

## Sources

- [OWASP API Security Top 10 2023, API1:2023 Broken Object Level Authorization (CC BY-SA 4.0)](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/) (read)
- [OWASP Top 10 2025, A01:2025 Broken Access Control (CC BY 3.0)](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/) (read)
- [OWASP Cheat Sheet Series, Insecure Direct Object Reference Prevention (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) (read)
- [OWASP Top 10 2007, A4 Insecure Direct Object Reference (origin of the IDOR name)](https://owasp.org/www-project-top-ten/) (recalled)
- [MITRE CWE-639, Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html) (recalled)
