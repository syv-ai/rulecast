<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Sensitive data in logs

`sensitive-data-in-logs` · anti-patterns, security · **agents do this**

Passwords, tokens, session ids, keys, payment data or personal data are written to logs, traces or error reports, which are kept longer and read by more people and systems than the data was ever meant for.

*Names:* MITRE's CWE-532, Insertion of Sensitive Information into Log File. Named in A09:2025 Security Logging and Alerting Failures in the OWASP Top 10 2025, with the OWASP Logging Cheat Sheet's list of data to exclude.

*Matters most for:* web-api, distributed, serverless, data-pipeline

## But

Local development logs on a developer's own machine can be verbose. Audit logs exist to record who did what, and must keep the user's identity; the rule is about secrets and data beyond what the purpose needs, not about never logging a user. Under GDPR and similar laws, what counts as sensitive depends on the data and the jurisdiction, so the exclusion list is a team decision rather than a fixed rule.

## Quality axes

- **delivery** +: Logging the whole request or object is the quickest way to see what went wrong.
- **security** −: Secrets and personal data copied into logs reach every person, vendor and backup that can read logs, for far longer than intended.

**Flips:** Verbose logs on a developer's own machine during local development are fine.

## Why people fall into it

- When something breaks, logging everything is the fastest way to see what happened.
- Generated toString, Debug or repr output includes every field, so logging an object logs its secrets.
- Logs feel internal, though they flow to third-party log services, support staff and backups.
- Request logging middleware is switched on with its most verbose setting in development and never dialled back.

## How it shows

- A log call with the whole request, its headers, its body or a full user or payment object as an argument.
- Debug logging of outgoing HTTP calls that includes the Authorization header or the query string with an api key.
- Exception handlers that log the payload that failed to parse.
- Structured logging that serializes an entity whose generated string form includes every field (password hash, email, tokens).
- HTTP access logs or tracing middleware recording full URLs that carry tokens (password reset links, magic links).
- No redaction setting in the logger configuration.

## Overcorrecting looks like

- Logging so little that incidents can't be investigated; OWASP's same category faults missing logs of logins and access-control failures.
- Hashing or masking ids that are needed to correlate events, such as an order id, which isn't sensitive.
- Redaction rules so broad that every field named key or id is masked.

## What to do

Log events, not objects: pick the fields worth logging and name them. Give secret-bearing types a string form that redacts (a Secret wrapper, an excluded field, a custom formatter), and set the logger's redaction list for headers and fields such as authorization, cookie, password and token. Mask or hash identifiers that are personal but needed for correlation. Encode log values so input can't forge log lines.

## Example

Before:

```
route POST "/webhooks/payments"
fn on_payment_event(request: Request):
    log.info("payment webhook received", request.headers, request.body)
    event = parse_event(request.body)
    ...
```

After:

```
route POST "/webhooks/payments"
fn on_payment_event(request: Request):
    event = parse_event(request.body)
    log.info("payment webhook received",
             event_id=event.id, type=event.type, order_id=event.order_id)
    ...
```

The log records which event arrived and for which order, not the signature header or the card details in the body.

## One-file tell

Python, TypeScript, Java, C#, Go and Rust. A logging or print call where, outside the text of plain string literals, an argument or an interpolation/placeholder ({...}, ${...}, {@...}) names: a password, passwd, secret, api_key, authorization, cookie, card_number or cvv; a qualified token (access/refresh/auth/bearer/session/csrf/api/id/jwt token, or jwt); or the whole request, its headers or its body (request, req, req.headers, request.body, r.Header, but not request.url or request.method). A bare 'token' name doesn't count, and neither does a name that ends in dir, path, file, name, url, length, count, header or field (secrets_dir names a place, not a secret).

## By language

**python:** Logging request.headers or a Pydantic model logs everything; Pydantic's SecretStr prints as asterisks. structlog processors or a logging.Filter can redact keys centrally.

**typescript:** pino's redact option and winston formats can drop paths such as req.headers.authorization; logging the Express req object directly includes headers and cookies.

**java:** Lombok @ToString and @Data, and record toString, include every field; exclude secrets with @ToString.Exclude or a custom toString. Logback and Log4j2 can mask by pattern, but naming fields is more reliable.

**csharp:** Records' generated ToString prints all public properties, and Serilog's {@Object} destructures everything. ASP.NET Core's HTTP logging middleware logs headers and bodies only when configured to, and redacts headers not on its allowed list; keep that list short.

**go:** fmt's %v and %+v print every struct field, exported or not, so a config or request struct logs its secrets. Implement String() (fmt.Stringer) or slog's LogValuer on types that carry secrets so they log redacted.

**rust:** #[derive(Debug)] prints every field, so {:?} on a config or request logs its secrets. The secrecy crate's SecretString redacts in Debug; otherwise write Debug by hand for those types.

## Related

[Hard-coded secrets](hard-coded-secrets.md) · [Defense in depth](defense-in-depth.md) · [Least privilege](least-privilege.md)

## Sources

- [OWASP Cheat Sheet Series, Logging, data to exclude (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A09:2025 Security Logging and Alerting Failures (CC BY 3.0)](https://top10.owasp.org/2025/A09_2025-Security_Logging_and_Alerting_Failures/) (read)
- [MITRE CWE-532, Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html) (recalled)
