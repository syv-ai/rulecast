<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Least privilege

`least-privilege` · principles, security

Give every user, process, service account, token and plugin only the permissions its job needs, for only as long as it needs them, so a mistake or a compromise can do only that much harm.

*Names:* Stated as one of eight design principles by Jerome Saltzer and Michael Schroeder in "The Protection of Information in Computer Systems" (1975), beside fail-safe defaults and separation of privilege. Also called the principle of least authority (POLA) in capability-security writing. OWASP pairs it with separation of duties in the Secure Product Design Cheat Sheet, and deny-by-default access control in A01:2025.

*Matters most for:* iac, serverless, platforms, plugin-host, distributed

## But

Privilege has an operational cost: someone must define, review and fix the grants, and each denial at the wrong moment slows the team. Small teams and early prototypes often run with broad permissions knowingly and tighten at the first real user data or the first external code; that's a reasonable order if the deadline is real. Least privilege that is too painful to live with decays into wildcards, so the design has to make the narrow grant the easy one.

## Quality axes

- **security** ⊕ (primary): A leaked token or a compromised plugin or service can only do what its narrow grant allows.
- **delivery** −: Every new job or component needs its grants defined and reviewed, and a denial at the wrong moment stalls the work.
- **operability** −: Grants have to be maintained and permission denials debugged, which is ongoing work for whoever runs the system.

**Flips:** When grants are so fine-grained they hurt, people hand out wildcards to get unstuck and security ends up worse. For a script only its author runs it is cost without benefit.

## Warranted when

- Several components share credentials or one powerful service account.
- Code runs that the core team didn't write (plugins, hooks, user scripts, dependencies).
- The system handles data or actions whose misuse would be costly (payments, personal data, infrastructure).
- A credential could leak through logs, a laptop or a CI job, and you want the leak to be small.

## How it shows

- Separate database roles per service, with read-only roles for reporting and no app using the admin account.
- Cloud IAM policies naming specific actions and resources rather than "*".
- API tokens and OAuth grants with narrow scopes and expiry.
- Plugins, hooks or extensions that declare the capabilities they need and get nothing else.
- Containers running as a non-root user with a read-only filesystem.

## Overdone when

- Permissions so fine-grained that every change needs a ticket, so people grant wildcards to get unstuck and the end state is worse.
- Permission prompts so frequent that users approve everything without reading.
- A capability system for a script only its author runs.

## Example

Before:

```
# nightly analytics export
fn export_daily_orders():
    db = connect(user="app_admin", password=secrets.get("ADMIN_DB_PASSWORD"))
    rows = db.query("SELECT * FROM orders WHERE day = ?", [yesterday()])
    storage.put("exports/orders.csv", to_csv(rows))   # bucket token can read and delete everything
```

After:

```
# nightly analytics export
fn export_daily_orders():
    db = connect(user="analytics_reader", password=secrets.get("ANALYTICS_DB_PASSWORD"))
    rows = db.query("SELECT id, day, total, region FROM orders_export WHERE day = ?",
                    [yesterday()])
    storage.put("exports/orders.csv", to_csv(rows))   # token may only write under exports/
```

The job now runs as a read-only role on a view without personal columns, with a storage token that can only add exports, so a leak of either credential exposes little.

## By language

**rust:** Wasm plugin hosts (wasmtime with WASI) grant capabilities explicitly: a guest gets no files, sockets or environment unless the host passes them in, which makes least privilege the default for plugins.

**typescript:** Deno's permission flags (--allow-net, --allow-read with paths) and Node's permission model apply it to scripts; the more common gap is long-lived npm and cloud tokens with full scopes in CI.

## Related

[Secure by default](secure-by-default.md) · [Defense in depth](defense-in-depth.md) · [Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Hard-coded secrets](hard-coded-secrets.md)

## Overlaps

secure-by-default and least-privilege set what is allowed without asking. fail-open-vs-fail-closed is the separate decision of what happens when a check itself fails; tooling and security often answer it differently.

## Sources

- [OWASP Cheat Sheet Series, Secure Product Design, Least Privilege and Separation of Duties (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html) (read)
- [OWASP Cheat Sheet Series, Authorization, least privilege and deny by default (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A01:2025 Broken Access Control (CC BY 3.0)](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/) (read)
- [Saltzer and Schroeder, The Protection of Information in Computer Systems, Proc. IEEE 63(9), 1975](https://www.cs.virginia.edu/~evans/cs551/saltzer/) (recalled)
