<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Overloaded environment flag

`overloaded-environment-flag` · anti-patterns, security · **agents do this**

One environment flag (DEBUG, a dev, local or test mode) switches on several unrelated risky behaviours at once, such as detailed error pages, skipped auth, open CORS, weak secret checks or a fake payment provider, so turning it on for one reason turns on all of them, and one leaked setting opens them all.

*Names:* No single coined name; practitioners call it debug mode in production, an environment check scattered through code, or a god flag. Django's documentation on DEBUG ("never deploy a site into production with DEBUG turned on") and its deployment checklist are the canonical warning about one flag doing many things. MITRE's CWE-489 (Active Debug Code) covers the debug half, and OWASP A02:2025 Security Misconfiguration lists unnecessary features enabled and verbose error handling. Pete Hodgson's "Feature Toggles" (martinfowler.com) gives the design remedy: one toggle per decision, with toggle points kept apart from the logic that decides them.

*Matters most for:* web-api, fullstack-web, serverless, platforms

## But

For a small app run by one team, a single development flag that only affects developer convenience (auto reload, a debug toolbar, pretty logs) is fine and simpler than many settings; the problem is when it also controls security or money. Frameworks' own DEBUG flags are hard to avoid and are acceptable if production config is checked at startup. Twelve-Factor's dev/prod parity argues for fewer environment differences overall, which reduces the need for flags of any kind.

## Quality axes

- **delivery** +: Reusing the existing "am I local?" check for each new shortcut is quickest.
- **security** −: One leaked or mis-set flag turns on skipped auth, open CORS and verbose errors together.
- **operability** −: Staging can't get one convenience, such as verbose errors, without inheriting every risky shortcut, and nobody can list what the flag controls.

**Flips:** For a small app, one development flag that only affects developer convenience (auto reload, a debug toolbar, pretty logs) is fine and simpler than many settings.

## Why people fall into it

- A single "am I local?" switch is quick to add, and each new convenience just reuses it.
- Frameworks ship one DEBUG or environment setting and hook their own behaviours to it, which invites application code to do the same.
- Local setup needs several shortcuts at once (no real auth provider, no TLS, a fake payment gateway).
- Nobody owns the list of what the flag controls, so it grows without review.

## How it shows

- The same check (ENV == "development", NODE_ENV !== "production", settings.DEBUG, IsDevelopment()) repeated across modules, each gating something different.
- One flag that mounts unauthenticated routes, relaxes secret validation and enables verbose errors.
- CORS, cookie Secure flags, TLS verification or rate limiting relaxed under a development check.
- A committed .env or default config that sets the flag on.
- Staging environments run with the flag on to get one convenience, inheriting the rest.

## Overcorrecting looks like

- A separate flag for every tiny difference, so the configuration matrix is too big to reason about and environments drift apart.
- Banning environment-specific behaviour so strictly that local development needs real credentials and third-party services.

## What to do

Split it: one named setting per behaviour (expose_error_details, allow_test_user_creation, cors_allowed_origins), each defaulting to the safe value and named for its risk, and decide them in one configuration module rather than at scattered call sites (Hodgson's decouple decision points from decision logic). Validate at startup that dangerous settings are off in production, and keep fakes for payment or email behind dependency wiring rather than an environment check.

## Example

Before:

```
IS_DEV = env("APP_ENV") == "development"

fn build_app():
    app = App(show_tracebacks=IS_DEV)
    if IS_DEV:
        app.cors(allow_origins=["*"])
        app.mount(test_user_routes)            # creates users without auth
        payments = FakePaymentGateway()
    else:
        payments = StripeGateway(env("STRIPE_KEY"))
    ...
```

After:

```
class Settings:
    show_tracebacks: bool = False
    cors_origins: list = []
    dangerously_allow_test_user_routes: bool = False
    payment_gateway: str = "stripe"            # or "fake"

fn build_app(s: Settings):
    app = App(show_tracebacks=s.show_tracebacks)
    app.cors(allow_origins=s.cors_origins)
    if s.dangerously_allow_test_user_routes: app.mount(test_user_routes)
    payments = make_gateway(s.payment_gateway)
```

Each risky behaviour has its own safe-by-default setting, so enabling one for local work no longer enables the others, and production checks can refuse each by name.

## One-file tell

Written for python, typescript, java, csharp and go. In one non-test file, a check of a general environment or debug flag (DEBUG, ENV, ENVIRONMENT, APP_ENV, NODE_ENV, an IsDevelopment call, an active "dev" profile) that gates at least one application-level bypass (authentication or authorization skipped, an unauthenticated or test-only route mounted, secret or signature validation relaxed, TLS certificate verification turned off) plus any other security-relevant behaviour (CORS widened, error details exposed, cookie Secure off). Not when the flag gates only error pages, HSTS, cookie flags or developer tooling, which framework templates do by design.

## By language

**python:** Django's DEBUG controls detailed error pages, query logging and the ALLOWED_HOSTS fallback; adding application behaviour to the same flag is the trap. "manage.py check --deploy" checks the production settings. In FastAPI apps, pydantic-settings fields per behaviour replace one ENVIRONMENT string.

**typescript:** NODE_ENV is meant to choose build optimisation (and Express uses it for error detail); using it to bypass auth or open CORS is the anti-pattern. Bundlers inline it, so client code branches are visible in the shipped bundle.

**java:** Spring profiles can become an overloaded flag when one "dev" profile switches security, data sources and fakes together; profile-specific beans for each concern, or separate properties, keep them apart.

**csharp:** IWebHostEnvironment.IsDevelopment() gates the developer exception page in templates; checks of it scattered through application code to skip authorization are the anti-pattern. Options classes per concern are the usual split.

## Related

[Secure by default](secure-by-default.md) · [Test Logic in Production](test-logic-in-production.md) · [Fail Open vs Fail Closed](fail-open-vs-fail-closed.md) · [Least privilege](least-privilege.md) · [Hard-coded secrets](hard-coded-secrets.md) · [Global state](global-state.md) · [Shotgun Surgery](shotgun-surgery.md)

## Sources

- [Django documentation, settings, DEBUG](https://docs.djangoproject.com/en/stable/ref/settings/#debug) (read)
- [Django documentation, Deployment checklist](https://docs.djangoproject.com/en/stable/howto/deployment/checklist/) (recalled)
- [Pete Hodgson, Feature Toggles (aka Feature Flags), martinfowler.com](https://martinfowler.com/articles/feature-toggles.html) (read)
- [OWASP Top 10 2025, A02:2025 Security Misconfiguration (CC BY 3.0)](https://top10.owasp.org/2025/A02_2025-Security_Misconfiguration/) (read)
- [MITRE CWE-489, Active Debug Code](https://cwe.mitre.org/data/definitions/489.html) (recalled)
- [The Twelve-Factor App, X. Dev/prod parity](https://12factor.net/dev-prod-parity) (recalled)
