<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Secure by default

`secure-by-default` · principles, security

The out-of-the-box setting is the safe one, and anything dangerous (network access, disabled TLS checks, open CORS, debug mode, running untrusted code) must be switched on explicitly, by a setting whose name says it is dangerous.

*Names:* Rooted in Saltzer and Schroeder's "fail-safe defaults" (1975): base access decisions on permission rather than exclusion. "Secure by default" is the second D of Microsoft's SD3 (secure by design, by default and in deployment) from Howard and LeBlanc's Writing Secure Code (2nd ed., 2002), and the name of CISA's 2023 Secure by Design and Default guidance. OWASP's Secure Product Design Cheat Sheet and A02:2025 Security Misconfiguration ask for it.

*Matters most for:* library-sdk, plugin-host, cli-devtool, platforms, iac

## But

Strict defaults have an adoption cost; a development tool that can't fetch anything until configured may lose users to one that can. Changing a default to the safe value later breaks everyone who relied on the old one (Hyrum's law), so it needs a deprecation path rather than a silent flip. Some argue that developer tools running on the user's own machine with the user's own permissions gain little from sandboxing defaults; that weakens once the tool runs third-party hooks, plugins or agent-written code.

## Quality axes

- **security** ⊕ (primary): Most deployments keep the defaults, so the safe default decides how safe most of them are, and anything dangerous shows up as a named opt-in.
- **delivery** −: Users and the team have to configure network, CORS or debug access explicitly before using them, so the first run takes longer.

**Flips:** If the defaults are so strict that the first run fails, tutorials tell everyone to turn the protection off and the opt-out becomes the real default. Flipping an existing default to the safe value breaks everyone who relied on it.

## Warranted when

- Your software is configured by people who won't read the security section (users of a library, a CLI, a platform, a plugin host).
- An option exists whose unsafe value is useful in development and harmful in production.
- Extensions, hooks or user code run inside your process or with your credentials.
- Most users will keep whatever the default is, so the default decides the security of most deployments.

## How it shows

- Configuration options whose default is the restrictive value, with dangerous ones named as such (dangerously_allow_network, danger_accept_invalid_certs, allow_unsafe).
- Hooks, plugins or scripts that get no network, file or shell access unless the config grants it.
- Authorization that denies routes unless a policy allows them, with public routes marked explicitly.
- Debug pages, API explorers and verbose errors off unless an environment flag turns them on.
- New storage buckets, ports and admin consoles closed until opened.

## Overdone when

- Defaults so locked down that the first-run experience fails, so tutorials tell everyone to disable the protection and the opt-out becomes the real default.
- A dangerous flag that turns off many protections at once, so people who need one weaken all of them.
- Prompting at runtime for every capability instead of letting a config declare it once.

## Example

Before:

```
class HookConfig:
    command: str
    timeout_seconds: int = 30
    allow_network: bool = True

fn run_hook(config: HookConfig, event: Event):
    sandbox = Sandbox(network=config.allow_network)
    sandbox.run(config.command, stdin=event.to_json(), timeout=config.timeout_seconds)
```

After:

```
class HookConfig:
    command: str
    timeout_seconds: int = 30
    dangerously_allow_network: bool = False   # must be set explicitly per hook

fn run_hook(config: HookConfig, event: Event):
    if config.dangerously_allow_network:
        audit.warn("hook has network access", command=config.command)
    sandbox = Sandbox(network=config.dangerously_allow_network)
    sandbox.run(config.command, stdin=event.to_json(), timeout=config.timeout_seconds)
```

A hook gets no network unless its config opts in with a setting that says it is dangerous, so the common case is safe and the exception is visible in review.

## One-file tell

Written for python, typescript, go, csharp and rust. A safe default switched off in code outside tests: verify=False, rejectUnauthorized false, NODE_TLS_REJECT_UNAUTHORIZED set to 0, InsecureSkipVerify true, ServerCertificateCustomValidationCallback returning true, danger_accept_invalid_certs(true), DEBUG = True in a settings file not named for development, or a CORS configuration allowing any origin with credentials.

## By language

**python:** Django's startproject writes DEBUG = True, and FastAPI serves /docs and /openapi.json unless disabled, so production settings must flip them. requests verifies TLS by default; verify=False is the opt-out.

**typescript:** The cors package's default allows any origin, and Express sends no security headers without helmet. Node's TLS rejects bad certificates unless rejectUnauthorized is false or NODE_TLS_REJECT_UNAUTHORIZED is 0.

**java:** With Spring Boot, adding Spring Security requires authentication for every route and enables CSRF protection by default; permitAll is the explicit opt-out. Defining your own SecurityFilterChain replaces that default, so end it with anyRequest().authenticated() (or denyAll) to keep deny-by-default.

**csharp:** ASP.NET Core allows anonymous access unless [Authorize] is applied; setting a FallbackPolicy that requires an authenticated user makes it deny by default, with [AllowAnonymous] as the opt-out.

**go:** net/http's Server and default Client have no timeouts, an unsafe default to override. InsecureSkipVerify is the named opt-out for TLS checks.

**rust:** reqwest and rustls verify certificates by default, and the opt-outs are named danger_accept_invalid_certs and dangerous(), the shape this principle asks for.

## Related

[Least privilege](least-privilege.md) · [Defense in depth](defense-in-depth.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md) · [Hyrum's Law](hyrums-law.md) · [Server-side request forgery (SSRF)](ssrf.md)

## Overlaps

secure-by-default and least-privilege set what is allowed without asking. fail-open-vs-fail-closed is the separate decision of what happens when a check itself fails; tooling and security often answer it differently.

## Sources

- [OWASP Cheat Sheet Series, Secure Product Design, secure defaults and failing securely (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A02:2025 Security Misconfiguration (CC BY 3.0)](https://top10.owasp.org/2025/A02_2025-Security_Misconfiguration/) (read)
- [Saltzer and Schroeder, The Protection of Information in Computer Systems (1975), fail-safe defaults](https://www.cs.virginia.edu/~evans/cs551/saltzer/) (recalled)
- Howard and LeBlanc, Writing Secure Code, 2nd ed. (2002), SD3 (recalled)
- [CISA, Secure by Design (2023)](https://www.cisa.gov/securebydesign) (recalled)
