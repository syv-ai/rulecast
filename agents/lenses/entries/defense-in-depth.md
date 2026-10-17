<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Defense in depth

`defense-in-depth` · principles, security

Protect anything that matters with several independent layers of control, so one missed check, bug or misconfiguration doesn't expose it on its own.

*Names:* A military term for trading space for time with layered defences, adopted for information security by the NSA and the US Department of Defense around 2000. Listed as a principle in OWASP's Secure Product Design Cheat Sheet. Related to Saltzer and Schroeder's separation of privilege (1975) and to the Swiss cheese model of accidents (James Reason).

*Matters most for:* platforms, web-api, distributed, fullstack-web

## But

Every layer costs code, latency and operational attention, and layers that can't fail independently only look like depth. For low-value data or an internal tool, one well-tested control is often the better trade. The layers also need an owner each: a second check nobody tests tends to rot unnoticed until the day it's needed. Depth is not a substitute for getting the primary control right.

## Quality axes

- **security** ⊕ (primary): One missed check, framework default or misconfiguration doesn't expose the asset on its own, because an independent layer still holds.
- **delivery** −: Every extra layer (row-level security, network segmentation, CSP) is more to build.
- **runtime** −: Each layer adds work to the request path, such as a policy check in the database on every query.
- **change_cost** −: Each layer needs its own owner and tests, or it rots unnoticed, and changing a rule can mean touching several layers.

**Flips:** Layers that share a failure mode only add complexity. Copying the same validation into every layer turns change_cost into shotgun surgery. For low-value data, one well-tested control is the better trade.

## Warranted when

- A single check guards something costly (other tenants' data, money, admin actions).
- The check lives in code many people change, so a regression is likely sooner or later.
- Your controls depend on components you don't control (a framework default, a gateway config, a cloud policy).
- Detecting a breach late would cost more than a second layer does.

## How it shows

- Authorization checked in the handler and also enforced by a tenant filter or row-level security in the data layer.
- Parameterized queries plus a database role that can't drop tables or read other schemas.
- Input validated at the edge, output encoded at the sink, and a Content Security Policy as a backstop.
- Network segmentation so a compromised web tier can't reach the database admin port or internal tools.
- Monitoring and alerting that would notice when the layers in front fail.

## Overdone when

- Layers that share a failure mode (two checks reading the same spoofable header), which add complexity and no independence.
- The same validation copied into every layer, so changing a rule means changing five places that drift (shotgun surgery).
- Using extra layers as a reason not to fix the primary control properly.

## Example

Before:

```
route GET "/projects/{id}/documents"
fn list_documents(id: str, user: User) -> list[Document]:
    if not memberships.is_member(user, id):
        return forbidden()
    return db.query("SELECT * FROM documents WHERE project_id = ?", [id])
    # every other query on documents must remember its own check
```

After:

```
route GET "/projects/{id}/documents"
fn list_documents(id: str, user: User) -> list[Document]:
    if not memberships.is_member(user, id):
        return forbidden()
    return tenant_db(user.org_id).query(
        "SELECT * FROM documents WHERE project_id = ?", [id])

# tenant_db connects with a role under row-level security:
# rows outside the caller's organisation are invisible to any query
```

The handler check stays, and a data-layer policy independently hides other organisations' rows, so a forgotten check elsewhere leaks nothing across tenants.

## Related

[Least privilege](least-privilege.md) · [Secure by default](secure-by-default.md) · [Validate at the boundary](validate-at-the-boundary.md) · [Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Shotgun Surgery](shotgun-surgery.md)

## In the interview

- [Ask what would hurt most if it went wrong, and work back to the conventions that stop it.](../THINKING.md#start-from-failure)

## Sources

- [OWASP Cheat Sheet Series, Secure Product Design, Defense-in-Depth (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html) (read)
- [OWASP Cheat Sheet Series, Insecure Direct Object Reference Prevention, random ids as defense in depth (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) (read)
- [Saltzer and Schroeder, The Protection of Information in Computer Systems (1975), separation of privilege](https://www.cs.virginia.edu/~evans/cs551/saltzer/) (recalled)
- NSA, Information Assurance Technical Framework (IATF), Release 3.0 (September 2000): the Defense-in-Depth Strategy (recalled)
