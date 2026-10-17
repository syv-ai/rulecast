<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# User enumeration

`user-enumeration` · anti-patterns, security · **contested** · **agents do this**

Login, sign-up or password-reset flows answer differently for unknown and known accounts, in the message, the status code or the time taken, so anyone can find out which emails or usernames have accounts.

*Names:* Also called account enumeration. MITRE's CWE-204 (Observable Response Discrepancy) and CWE-208 (Observable Timing Discrepancy). Covered under A07:2025 Authentication Failures in the OWASP Top 10 2025 and the OWASP Authentication Cheat Sheet's section on error messages.

*Matters most for:* web-api, fullstack-web, mobile

## But

This is contested. Many products (including some large ones) decide that telling users whether an account exists is worth the leak, because it cuts support load and the existence of an account is low-value or already public. OWASP itself frames it as a trade-off with usability that depends on how critical the system is. Rate limiting and alerting cover much of the risk. It matters most where knowing someone has an account is itself sensitive (health, dating, finance) or feeds credential stuffing.

## Quality axes

- **security** −: Anyone can learn which emails have accounts, which feeds credential stuffing and leaks membership of sensitive services.

**Flips:** Contested. Where an account's existence is public or low-value, telling users is a fair trade for clearer messages and lower support load, relying on rate limits.

## Why people fall into it

- Specific error messages are kinder to users, and UX reviews ask for them.
- The early return when the user isn't found is the natural shape of the code, and nobody measures the time difference.
- Support costs rise when people can't tell which email they signed up with.
- Sign-up must say something when the email is taken, and the obvious thing reveals it.

## How it shows

- Distinct error strings in one auth handler, such as "user not found" and "incorrect password".
- A login that returns early when the user lookup fails, before hashing the password.
- A password reset that says "no account with that email" or returns 404 for unknown addresses.
- A sign-up form that reports "email already registered" immediately.
- Different HTTP status codes for unknown user, wrong password and locked account.
- An "is this username available" endpoint with no rate limit.

## Overcorrecting looks like

- Vague errors on flows where the account's existence is public anyway (usernames shown on profiles, a work directory), which hurts users and protects nothing.
- Sleeping a random time on failure, which adds latency without hiding the difference.
- Hiding enumeration on login while the sign-up form and the public API still answer the question.

## What to do

Give one message and one status for every login failure, and make reset and sign-up answer the same way whatever the email (send the email that says what happened instead of saying it on screen). Run the same work for unknown users, including a password hash against a dummy value, so timing matches. Rate-limit these endpoints, since enumeration needs many tries.

## Example

Before:

```
fn sign_in(email: str, password: str) -> Result:
    agent = support_agents.find_by_email(email)
    if agent is None:
        return error(404, "No support agent with that email")
    if not hasher.verify(password, agent.password_hash):
        return error(401, "Incorrect password")
    return start_session(agent)
```

After:

```
DUMMY_HASH = hasher.hash("not-a-real-password")

fn sign_in(email: str, password: str) -> Result:
    agent = support_agents.find_by_email(email)
    stored = agent.password_hash if agent else DUMMY_HASH
    if not hasher.verify(password, stored) or agent is None:
        return error(401, "Email or password is incorrect")
    return start_session(agent)
```

Unknown and known emails now get the same message, the same status and the same hashing work.

## One-file tell

Language-neutral, for files that contain a login, sign-in, password-reset or registration handler. Two or more distinct failure messages in one such function where one names the account as missing ("user not found", "no account", "email not registered", "unknown user") and another names the password as wrong ("incorrect password", "wrong password", "invalid password").

## By language

**python:** Django's ModelBackend runs the password hasher once when the user doesn't exist to blunt timing differences, and its forms give a generic login error; custom FastAPI auth has to do both itself.

**java:** Spring Security hides UsernameNotFoundException as BadCredentialsException by default (hideUserNotFoundExceptions), and DaoAuthenticationProvider hashes a dummy password for unknown users. Custom endpoints that bypass it lose both.

**csharp:** ASP.NET Core Identity's SignInManager returns a generic failure, and its scaffolded forgot-password page shows the same confirmation whether or not the account exists. Custom endpoints written beside it often don't.

## Related

[Missing rate limiting](missing-rate-limiting.md) · [Defense in depth](defense-in-depth.md) · [Secure by default](secure-by-default.md)

## Sources

- [OWASP Cheat Sheet Series, Authentication, Authentication and Error Messages (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A07:2025 Authentication Failures (CC BY 3.0)](https://top10.owasp.org/2025/A07_2025-Authentication_Failures/) (read)
- [MITRE CWE-204 and CWE-208](https://cwe.mitre.org/data/definitions/204.html) (recalled)
