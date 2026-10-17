<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# 401 Unauthorized versus 403 Forbidden

`unauthenticated-vs-forbidden` · practices, api

Answer 401 when the server doesn't know who the caller is (no credentials, or invalid or expired ones), with a WWW-Authenticate challenge, and 403 when it knows who they are and the answer is still no, because clients act differently on each: 401 means sign in again, 403 means don't retry.

*Names:* Defined in RFC 9110, HTTP Semantics (Roy Fielding, Mark Nottingham and Julian Reschke, 2022), sections 15.5.2 and 15.5.4; earlier in RFC 7235 and RFC 7231, and first in RFC 2616. The 401 reason phrase "Unauthorized" is a long-standing misnomer for unauthenticated. RFC 6750 (OAuth 2.0 Bearer Token Usage) maps invalid_token to 401 and insufficient_scope to 403. RFC 9110 also allows 404 in place of 403 to hide that a resource exists.

*Matters most for:* web-api, fullstack-web, mobile, library-sdk

## But

The main counter-view is to hide existence: RFC 9110 lets a server answer 404 rather than 403 so a caller can't learn which ids are real, and many APIs do this for private resources; the cost is that a user who should have access gets a confusing "not found". Cookie-session apps often have no meaningful challenge scheme, so they send 401 without WWW-Authenticate or redirect to login, which breaks the letter of the RFC and is widely tolerated. In a published API the existing codes are part of the contract (Hyrum's law), so a fix goes through versioning or deprecation, not a quiet change.

## Quality axes

- **reliability** ⊕ (primary): Clients refresh the token on 401 and show "no access" on 403, instead of logging users out over a missing role or retrying forever.
- **operability** +: Access problems can be diagnosed from the status, which says whether it is a sign-in issue or a permission issue.

**Flips:** For private resources whose existence is sensitive, a 403 reveals that the id is real, so a 404 is the safer answer. In a published API, changing established codes breaks clients.

## Warranted when

- Clients branch on the status (refresh the token, log out, show a permission message), so mixing them up logs users out when they only lacked a role, or retries forever.
- Several authentication schemes or frameworks are in play, each with its own default status.
- Some resources are private enough that their existence is itself sensitive.

## How it shows

- One place that maps "no or bad credentials" to 401 and "authenticated but not allowed" to 403.
- 401 responses carrying a WWW-Authenticate header (Bearer, with error="invalid_token" for an expired token).
- A frontend or SDK that refreshes the token or logs out on 401 and shows a "no access" message on 403.
- A written choice about which resources answer 404 instead of 403 when the caller may not know they exist.

## Overdone when

- Adding WWW-Authenticate challenges for cookie-session browser apps where no client reads them.
- Renaming established statuses in a public API to be correct, which breaks clients that depend on the old behaviour.
- Returning 404 for every permission failure, including on resources the caller can plainly see, which makes debugging access problems hard.

## Example

Before:

```
fn current_user(req: Request) -> User:
    user = tokens.verify(req.header("Authorization"))
    if user is None:
        raise HttpError(403, "not allowed")
    return user

fn download_build(req: Request, build_id: str) -> Stream:
    user = current_user(req)
    build = builds.get(build_id)
    if not build.project.has_member(user):
        raise HttpError(401, "unauthorized")
    return build.artifact_stream()
```

After:

```
fn current_user(req: Request) -> User:
    user = tokens.verify(req.header("Authorization"))
    if user is None:
        raise HttpError(401, headers={"WWW-Authenticate": "Bearer error=\"invalid_token\""})
    return user

fn download_build(req: Request, build_id: str) -> Stream:
    user = current_user(req)
    build = builds.get(build_id)
    if build is None or not build.project.has_member(user):
        raise HttpError(404)       # outsiders can't learn which builds exist
    if not user.can("download", build.project):
        raise HttpError(403, "your role can't download artifacts")
    return build.artifact_stream()
```

An expired token now asks the client to sign in again, an outsider sees nothing, and a member without the right role gets a 403 the client won't retry.

## By language

**python:** FastAPI's built-in security classes answer 401 with WWW-Authenticate for missing or invalid credentials since 0.122.0; earlier releases answered 403 from HTTPBearer, the API-key classes and others (only the OAuth2 classes sent 401), and overriding make_not_authenticated_error restores the old code for clients that depend on it. DRF returns 403 for unauthenticated requests when the first authentication class has no authenticate_header, as SessionAuthentication doesn't.

**typescript:** NestJS: a guard returning false throws ForbiddenException (403); throw UnauthorizedException yourself, or use the Passport AuthGuard, for missing or bad credentials. Express has no default; Passport strategies with a challenge send 401 with WWW-Authenticate.

**java:** Spring Security sends authentication failures to the AuthenticationEntryPoint (401 for bearer tokens, a login redirect for form login) and authorization failures to the AccessDeniedHandler (403).

**csharp:** ASP.NET Core's Challenge produces 401 and Forbid 403. Cookie authentication turns both into redirects to the login and access-denied paths for page endpoints; since .NET 10 it returns 401 and 403 for recognised API endpoints ([ApiController], JSON minimal APIs), and on earlier versions the redirect events must be overridden for API routes.

## Related

[Inconsistent Error Contract](inconsistent-error-contract.md) · [Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [User enumeration](user-enumeration.md) · [Hyrum's Law](hyrums-law.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Sources

- [RFC 9110, HTTP Semantics, sections 15.5.2 (401), 15.5.4 (403) and 15.5.5 (404)](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2) (read)
- [RFC 6750, The OAuth 2.0 Authorization Framework, Bearer Token Usage, section 3.1](https://www.rfc-editor.org/rfc/rfc6750.html#section-3.1) (recalled)
- [OWASP Cheat Sheet Series, REST Security, HTTP return codes (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html) (recalled)
