<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Authorize before side effects

`authorize-before-side-effects` · practices, security

Decide whether the caller may do the thing before doing any part of it: no file write, delete, email, payment, outbound call or cache change happens until the permission check has passed.

*Names:* A plain practitioners' name, not a coined one; also said as "check, then act" or "authorize first". It is the ordering half of complete mediation, one of Jerome Saltzer and Michael Schroeder's design principles in "The Protection of Information in Computer Systems" (1975). MITRE files the failure under CWE-696 (Incorrect Behavior Order) and, where the checked state can change before use, CWE-367 (time-of-check time-of-use). Broken Object Level Authorization is about a missing check; this is about a check that runs too late.

*Matters most for:* web-api, fullstack-web, platforms, plugin-host, serverless

## But

Some decisions depend on the loaded record or the parsed input, so the order is load, decide, act, not decide before reading anything; reads with no visible effect may come first. Where the check is on state that can change between check and act (balances, seats, locks), ordering alone isn't enough and the check must be inside the same transaction or a conditional write. Systems that must act first and settle later (offline-first apps, eventual consistency) compensate instead of checking up front, which is a deliberate trade with the Saga pattern's costs.

## Quality axes

- **security** ⊕ (primary): An unauthorised caller can't cause any file write, email, payment or outbound call, even one the late check would have refused.
- **reliability** +: A refusal never leaves half the work done across several steps.

**Flips:** Checking state that can change between check and act needs the check inside the transaction, or ordering gives false confidence. Systems that must act first and settle later compensate instead.

## Warranted when

- A handler writes files, deletes objects, sends messages or calls third parties before it persists the record, so a check living in the save path comes too late.
- The permission check lives in a service or repository method that the handler reaches last.
- Annotations or decorators that check after the method returns (post-authorization) are used on methods that change state.
- Several steps that can each fail, where a late refusal would leave half the work done.

## How it shows

- Handlers that load the target, call one policy or authorization service, and only then write, send or call out.
- Request pipelines that run authorization before body validation that hits the database, and before any handler code.
- Upload and import endpoints that check edit rights before touching storage, and write to a temporary location until the record is saved.
- A cross-user test on every mutating endpoint, including the ones that write files or call other services.

## Overdone when

- Checking permissions twice or three times along one path because nobody trusts the first check.
- Refusing to do cheap, harmless reads (parsing the body, looking up the record) before authorizing, when the decision needs them.
- Locking rows for the whole request to rule out time-of-check races on data that rarely changes.

## Example

Before:

```
route PUT "/pages/{page_id}/cover"
fn replace_cover(page_id: str, upload: File, user: User) -> Page:
    page = pages.get(page_id)
    storage.delete(page.cover_path)
    page.cover_path = storage.put("covers/" + page_id, upload)
    if not can_edit(user, page):
        raise Forbidden()          # the old cover is already gone
    return pages.save(page)
```

After:

```
route PUT "/pages/{page_id}/cover"
fn replace_cover(page_id: str, upload: File, user: User) -> Page:
    page = pages.get(page_id)
    if not can_edit(user, page):
        raise Forbidden()
    old_path = page.cover_path
    page.cover_path = storage.put("covers/" + page_id + "/" + new_id(), upload)
    saved = pages.save(page)
    storage.delete(old_path)
    return saved
```

The refusal now comes before any storage change, and the old file is removed only after the new one is saved, so neither a forbidden caller nor a failed save leaves the page without a cover.

## By language

**python:** FastAPI dependencies run before the handler body, so a permission dependency that loads the target and checks it is the natural first step; a check left in a service the handler calls after writing a file runs too late. Django's permission mixins check in dispatch, before the handler, but only at model or user level. DRF's has_object_permission runs only when the view calls get_object or check_object_permissions, so a view that loads the object some other way and writes first never runs it.

**typescript:** In NestJS, guards run before pipes and the handler, so authorization in a guard precedes validation and side effects. In Express or Next.js server actions there is no fixed slot; the check is just a line that has to come first.

**java:** Spring Security's @PreAuthorize runs before the method and @PostAuthorize after it returns, so @PostAuthorize on a method that writes has already done the write when it refuses.

**csharp:** In ASP.NET Core, [Authorize] policies run before the action; resource-based checks with IAuthorizationService must be called in the action before the side effect. MediatR pipelines put an authorization behaviour ahead of validation and the handler by registration order.

## Related

[Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Least privilege](least-privilege.md) · [Fail Fast](fail-fast.md) · [Defense in depth](defense-in-depth.md) · [Fail Open vs Fail Closed](fail-open-vs-fail-closed.md) · [Saga](saga.md)

## Sources

- [Jerome Saltzer and Michael Schroeder, The Protection of Information in Computer Systems (1975), complete mediation](https://www.cs.virginia.edu/~evans/cs551/saltzer/) (recalled)
- [MITRE CWE-696, Incorrect Behavior Order](https://cwe.mitre.org/data/definitions/696.html) (recalled)
- [MITRE CWE-367, Time-of-check Time-of-use (TOCTOU) Race Condition](https://cwe.mitre.org/data/definitions/367.html) (recalled)
- [OWASP Cheat Sheet Series, Authorization Cheat Sheet (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (recalled)
