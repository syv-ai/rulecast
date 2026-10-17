<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Tenant isolation

`tenant-isolation` · principles, security

In a system that serves several customers from shared code and storage, every query, cache key, file path, queue message and background job carries the tenant it belongs to, and the tenant comes from the verified identity, so one tenant's data can't reach another by any path.

*Names:* No single coiner; "multi-tenancy" and "tenant isolation" are the established SaaS terms. The classic split into separate databases, separate schemas and shared tables with a tenant column is from Frederick Chong, Gianpaolo Carraro and Roger Wolter, "Multi-Tenant Data Architecture" (Microsoft, 2006). AWS's SaaS Lens names the silo, pool and bridge models; Azure's Architecture Center has a guide to multitenant architectures and the Noisy Neighbor antipattern. OWASP's Multi-Tenant Application Security Cheat Sheet covers it as a security concern. Per-user ownership checks are the narrower Broken Object Level Authorization.

*Matters most for:* web-api, fullstack-web, platforms, serverless, databases-storage

## But

A single-tenant deployment (one customer per install, or a self-hosted tool) has no tenant boundary to defend, and adding one is cost without benefit. Separate databases or accounts per tenant give the strongest isolation and make per-row filtering moot, at the price of operations and cross-tenant reporting; the shared-table model is cheaper but makes one forgotten filter a breach, which is why OWASP and the cloud guides push enforcement down into the data layer (row-level security, global filters) rather than trusting each query. Isolation also has a performance side (noisy neighbours, per-tenant quotas) that security-led scoping alone doesn't cover.

## Quality axes

- **security** ⊕ (primary): One forgotten filter can't leak another customer's data, because every query, cache key, path and job carries the tenant taken from the verified identity.
- **delivery** −: Tenant context has to be threaded through queries, caches, storage, queue messages and background jobs, with cross-tenant denial tests for each resource.

**Flips:** In a single-tenant deployment there is no boundary to defend, and it is cost only. A database or deployment per tenant for many small tenants multiplies migrations and turns operability "-".

## Warranted when

- More than one customer's data sits in the same database, bucket, cache or index.
- Requests run through shared workers, connection pools or async tasks, where context can leak between them.
- Work happens outside a request (jobs, webhooks, exports, emails) where the request's scoping no longer applies.
- Customers or regulators expect a contractual promise that their data is separate.

## How it shows

- A tenant (organisation, workspace, account, group) id column on most tables, and one place that adds it to every query, such as a scoped repository, an ORM global filter or database row-level security.
- Tenant context set once per request from the authenticated identity, not read from a body field or header the client can change.
- Cache keys, object storage prefixes and search index names that start with the tenant id.
- Queue messages and scheduled jobs that carry the tenant id and rebuild the scoped context in the worker.
- A named, greppable way to read across tenants (an unscoped or admin factory) used in few places.
- A test suite that runs the same cross-tenant denial cases against each resource.

## Overdone when

- Database or deployment per tenant for a product with a few hundred small tenants, which multiplies migrations and operations for isolation nobody asked for.
- A tenant column and filter on truly global data (country lists, plan definitions), which makes shared data look private and forces copies.
- Tenant checks hand-written in every handler on top of a data-layer filter that already enforces it, so the copies drift.

## Example

Before:

```
fn upcoming_appointments(day: Date) -> list[Appointment]:
    key = "appointments:" + day.iso()
    cached = cache.get(key)
    if cached: return cached
    rows = db.query("SELECT * FROM appointments WHERE day = ?", [day])
    cache.set(key, rows)
    return rows

fn send_reminders_job(appointment_ids: list[str]):
    for id in appointment_ids:
        notify(db.get("appointments", id))
```

After:

```
fn upcoming_appointments(ctx: RequestContext, day: Date) -> list[Appointment]:
    key = "clinic:" + ctx.clinic_id + ":appointments:" + day.iso()
    cached = cache.get(key)
    if cached: return cached
    rows = tenant_db(ctx.clinic_id).query("SELECT * FROM appointments WHERE day = ?", [day])
    cache.set(key, rows)
    return rows

fn send_reminders_job(clinic_id: str, appointment_ids: list[str]):
    db = tenant_db(clinic_id)      # every query is filtered by clinic
    for id in appointment_ids:
        notify(db.get("appointments", id))
```

The clinic travels with the query, the cache key and the job, so neither a shared cache entry nor a queued id can hand one clinic's appointments to another.

## By language

**python:** SQLAlchemy's do_orm_execute event with with_loader_criteria adds a tenant filter to every ORM select, but not to raw text() SQL. Django has no built-in; a default manager filter is skipped by raw SQL, and schema-per-tenant on PostgreSQL is a common library-based route. Keep the tenant in a contextvars variable rather than a thread-local or module global so async tasks don't share it.

**typescript:** AsyncLocalStorage carries the tenant through a request; a Prisma client extension can add the tenant to every where clause. With PostgreSQL row-level security, set the tenant with set_config inside each transaction, since pooled connections otherwise keep the previous request's setting.

**java:** Hibernate 6 supports discriminator multitenancy with @TenantId, plus schema- and database-per-tenant through a connection provider. A ThreadLocal tenant holder doesn't follow work onto @Async or executor threads unless a TaskDecorator copies it.

**csharp:** EF Core global query filters (HasQueryFilter) scope every LINQ query to the tenant, and IgnoreQueryFilters() is the visible opt-out to review. SQL that bypasses the entity sets (Database.SqlQuery, ExecuteSql, or Dapper on the same connection) is not filtered.

**go:** No framework layer; pass the tenant id explicitly to store methods or in context.Context, and make the store refuse a call without one, so an unscoped query is not the easy path.

## Related

[Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Defense in depth](defense-in-depth.md) · [Secure by default](secure-by-default.md) · [Least privilege](least-privilege.md) · [Global state](global-state.md) · [Generic Repository](generic-repository.md) · [Contract Test](contract-test.md)

## Sources

- [OWASP Cheat Sheet Series, Multi-Tenant Application Security (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) (read)
- Frederick Chong, Gianpaolo Carraro and Roger Wolter, Multi-Tenant Data Architecture (Microsoft, 2006) (recalled)
- [AWS Well-Architected SaaS Lens, silo, pool and bridge isolation models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html) (recalled)
- [Azure Architecture Center, Architect multitenant solutions on Azure](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview) (recalled)
