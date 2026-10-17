<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Missing rate limiting

`missing-rate-limiting` · anti-patterns, security · **agents do this**

Endpoints accept as many requests, as large a payload and as big a page as a client cares to send, so one client can guess codes, scrape data, run up a third-party bill or take the service down.

*Names:* OWASP API Security Top 10 2023, API4:2023 Unrestricted Resource Consumption (called Lack of Resources and Rate Limiting in the 2019 edition), with API6:2023 for abuse of business flows. MITRE's CWE-770 (allocation without limits) and CWE-307 (excessive authentication attempts). OWASP's A01:2025 asks for rate limits on APIs and controllers too.

*Matters most for:* web-api, serverless, fullstack-web, platforms

## But

Internal services behind an authenticated gateway that already enforces limits don't each need their own. A CLI or library has nothing to limit. For a small app, a platform-level limit (the CDN, the load balancer, the hosting provider) may be all that's needed, and per-endpoint tuning is premature until abuse shows up; authentication endpoints and paid side effects are the exceptions worth doing from day one.

## Quality axes

- **security** −: Attackers can guess codes, stuff credentials, scrape data or run up paid-API bills without limit.
- **reliability** −: One client, honest or not, with huge pages, bodies or request rates can exhaust the service for everyone.

**Flips:** Internal services behind a gateway that already limits, CLIs and libraries, and small apps covered by a platform-level limit don't need their own.

## Why people fall into it

- Every endpoint works fine under normal use, and abuse doesn't show up in tests.
- Rate limiting feels like infrastructure that someone else (the gateway, the CDN) is handling.
- Limits are a product decision nobody has made, so nobody writes a number down.
- Serverless scales automatically, so overload turns into a bill instead of an outage and goes unnoticed.

## How it shows

- Login, one-time-code, password-reset and sign-up endpoints with no throttle or lockout.
- Endpoints that send SMS or email, or call a paid API, once per request with no cap per user.
- A page-size or limit parameter taken from the request with no maximum.
- No request body size limit, upload limit or array length limit on the API.
- GraphQL or batch endpoints that accept many operations per request, each unthrottled.
- No rate-limit middleware, gateway policy or spending alert anywhere in the deployment.

## Overcorrecting looks like

- Limits so tight that real users and integrations hit them, with no clear error or Retry-After.
- Per-IP limits only, which punish users behind shared NAT and let attackers rotate addresses; OWASP advises counting login failures per account.
- Hard lockouts that let anyone lock a victim out of their own account.

## What to do

Decide limits per endpoint class and enforce them in one place (gateway or middleware), with stricter per-account limits on authentication and anything that costs money. Cap page size, body size, upload size and batch size on the server. Return 429 with Retry-After. Set spending limits or alerts with paid providers.

## Example

Before:

```
route POST "/login/verify-code"
fn verify_code(session: PendingLogin, code: str) -> Result:
    if code == session.expected_code:      # 6 digits
        return complete_login(session)
    return error(401, "Invalid code")
```

After:

```
MAX_ATTEMPTS = 5

route POST "/login/verify-code"
fn verify_code(session: PendingLogin, code: str) -> Result:
    if session.failed_attempts >= MAX_ATTEMPTS:
        return error(429, "Too many attempts, request a new code")
    if constant_time_equal(code, session.expected_code):
        return complete_login(session)
    session.failed_attempts += 1
    return error(401, "Invalid code")
```

A six-digit code can't be guessed in five tries, so capping attempts per pending login closes the brute force that an unlimited endpoint invites.

## By language

**python:** No built-in in FastAPI or Django; slowapi and django-ratelimit are the common choices, with limits per route.

**typescript:** express-rate-limit for Express; Next.js and serverless platforms usually rely on middleware or the edge provider's limits.

**java:** Spring has no built-in limiter; Bucket4j and Resilience4j's RateLimiter are common, or the API gateway.

**csharp:** ASP.NET Core has built-in rate-limiting middleware since .NET 7 (AddRateLimiter, RequireRateLimiting, [EnableRateLimiting]), with fixed-window, sliding-window, token-bucket and concurrency policies.

**go:** golang.org/x/time/rate gives a token bucket; http.MaxBytesReader caps body size, which net/http doesn't do by default.

**rust:** tower's rate-limit layers and the governor crate (tower_governor for axum) are the common choices.

## Related

[User enumeration](user-enumeration.md) · [Defense in depth](defense-in-depth.md) · [Secure by default](secure-by-default.md)

## Sources

- [OWASP API Security Top 10 2023, API4:2023 Unrestricted Resource Consumption (CC BY-SA 4.0)](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/) (read)
- [OWASP Cheat Sheet Series, Authentication, Login Throttling (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A01:2025 Broken Access Control, prevention (CC BY 3.0)](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/) (read)
- [MITRE CWE-770 and CWE-307](https://cwe.mitre.org/data/definitions/770.html) (recalled)
