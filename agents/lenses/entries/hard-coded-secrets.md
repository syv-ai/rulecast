<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Hard-coded secrets

`hard-coded-secrets` · anti-patterns, security · **agents do this**

Passwords, API keys, tokens or private keys are written into source code, checked-in config or build files, where everyone with the repository, the image or the bundle can read them.

*Names:* MITRE's CWE-798, Use of Hard-coded Credentials, with CWE-259 (hard-coded password) and CWE-321 (hard-coded cryptographic key). Mapped to A07:2025 Authentication Failures and A04:2025 Cryptographic Failures in the OWASP Top 10 2025; A02:2025 Security Misconfiguration also warns against static keys in code and pipelines. Often just called leaked or committed secrets.

*Matters most for:* iac, serverless, data-pipeline, ml-training, web-api

## But

Not every credential-shaped string is a secret. Publishable keys (Stripe's pk_, a Firebase web config, an OAuth client id for a public client) are meant to ship to browsers, and test fixtures with fake keys are fine when clearly fake. Default credentials for a local throwaway database in a docker-compose file meant only for development are common and acceptable if the same values can never reach production. The real line is whether the value grants access to something that matters.

## Quality axes

- **delivery** +: An inline key makes the example and local setup work immediately, without setting up a secret manager.
- **security** −: Anyone with the repository, image, bundle or git history can read and use the credential.
- **operability** −: Rotating a leaked or expiring secret needs a code change and redeploy, and environments can't get different values.

**Flips:** Publishable keys, clearly fake test fixtures and throwaway local dev database credentials that can never reach production are fine in code.

## Why people fall into it

- It makes the example run. Quick starts, tutorials and generated snippets put the key inline so the first run works.
- Local development needs a value, and a literal is the shortest path to one.
- The repository is private, so it feels safe; then it is forked, open-sourced, cloned to a laptop or read by a CI log.
- Setting up a secret manager is a project of its own and keeps getting deferred.
- Deleting the line feels like a fix, though git history still holds the value.

## How it shows

- String literals in source that match a provider's key format (AKIA..., ghp_..., sk_live_..., xoxb-..., a PEM private key block).
- Variables named password, secret, api_key or token assigned a literal that isn't a placeholder.
- Connection strings with a user and password inside, in code or in checked-in appsettings.json, application.properties or docker-compose files.
- Secrets in Dockerfile ENV or ARG, CI workflow files, Terraform variables with defaults, or notebooks.
- A .env file committed, or no .env entry in .gitignore.
- Frontend environment variables with a public prefix (NEXT_PUBLIC_, VITE_) that hold a server-side key.
- A commit that removes a key without a note that it was rotated.

## Overcorrecting looks like

- Treating every string as a possible secret, so the scanner flags test fixtures and public identifiers and people learn to ignore it.
- Moving secrets into environment variables and calling it done, though env vars leak into child processes, crash dumps and debug pages.
- A full secret-management platform for a single-developer tool with one token, where an untracked local config file is enough.

## What to do

Read secrets at runtime from the environment or a secret manager, injected by the platform, and keep only the name of the secret in code. Commit an example config with placeholders. Run a secret scanner in a pre-commit hook and in CI. When one leaks, revoke and replace it first; removing it from history comes second and doesn't undo the leak. Prefer short-lived credentials (workload identity, OIDC to the cloud) so there is no long-lived secret to leak.

## Example

Before:

```
class SmsGateway:
    fn __init__():
        self.client = HttpClient(
            base_url="https://api.sms-provider.example",
            api_key="sk_live_4f9a2c...e81",
        )

    fn send(number: str, text: str):
        self.client.post("/messages", {"to": number, "body": text})
```

After:

```
class SmsGateway:
    fn __init__(api_key: Secret):
        self.client = HttpClient(
            base_url="https://api.sms-provider.example",
            api_key=api_key.reveal(),
        )
    ...

# composition root
gateway = SmsGateway(api_key=secrets.get("SMS_API_KEY"))
```

The code names the secret and the runtime supplies it, so the key never enters the repository, and rotating it is a deploy, not a commit.

## One-file tell

Any file outside test fixtures: what gitleaks reports, that is a known credential format (cloud, VCS, payment and chat tokens, private keys) or a high-entropy string assigned to a key-like name.

## By language

**typescript:** Anything in a NEXT_PUBLIC_ or VITE_ variable is inlined into the client bundle and is public. Server-only keys must stay in variables without those prefixes and only be read in server code.

**java:** Spring's checked-in application.properties or application.yml often carries spring.datasource.password; use a placeholder such as ${DB_PASSWORD} and supply it from the environment or Spring Cloud Config or Vault.

**csharp:** appsettings.json connection strings are the usual leak. Use dotnet user-secrets in development and Azure Key Vault or environment variables in deployment; the configuration system layers them over appsettings without code changes.

**python:** Settings modules (Django settings.py SECRET_KEY, a FastAPI config.py) and notebooks are the usual places. pydantic-settings reads from the environment and SecretStr keeps the value out of reprs.

## Related

[Magic number](magic-number.md) · [Sensitive data in logs](sensitive-data-in-logs.md) · [Least privilege](least-privilege.md) · [Secure by default](secure-by-default.md)

## Sources

- [OWASP Cheat Sheet Series, Secrets Management (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A07:2025 Authentication Failures, CWE-798 (CC BY 3.0)](https://top10.owasp.org/2025/A07_2025-Authentication_Failures/) (read)
- [OWASP Top 10 2025, A02:2025 Security Misconfiguration (CC BY 3.0)](https://top10.owasp.org/2025/A02_2025-Security_Misconfiguration/) (read)
- [MITRE CWE-798, Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html) (recalled)
