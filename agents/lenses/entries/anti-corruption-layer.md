<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Anti-Corruption Layer

`anti-corruption-layer` · design patterns, architecture

A translating layer the downstream side owns, between its model and an external or legacy system, so the other system's concepts, codes and quirks don't leak into its own model.

*Names:* Also called Anticorruption Layer (Evans's spelling), ACL. Eric Evans, Domain-Driven Design (2003), ch. 14, as one of the context-mapping relationships. Also in Microsoft's Azure Cloud Design Patterns.

*Matters most for:* web-api, distributed, platforms, fullstack-web

## But

Translation costs code and upkeep, and every new field needs mapping. When the upstream model is good and stable, conforming to it (Evans's Conformist) is cheaper and gives you a shared language with the other team. When many clients integrate with you, an open host service with a published language is better than each client building its own layer. Use the layer where the other model would distort yours, typically legacy systems and broad vendor APIs.

## Quality axes

- **change_cost** ⊕ (primary): Legacy codes and vendor quirks stay in one translator, so the model reads in the business's terms and replacing the other system touches one module.
- **delivery** −: Translation code per type and field has to be written and kept current.

**Flips:** In front of a good, stable upstream whose model you could adopt, conforming is cheaper, and a field-for-field copy of the external model duplicates every type for nothing.

## Warranted when

- A legacy system or vendor API has a weak or alien model (cryptic codes, overloaded fields), and its names are spreading through the code.
- The integration matters, but the other side won't change for you.
- You expect to replace the other system and want the change contained.

## How it shows

- A module per external system (adapters/legacy_leasing, integrations/payments) that alone imports its SDK or generated client.
- Translator functions that turn the other system's records and status codes into domain objects, and back.
- Domain code that never sees the vendor's types, field names or error codes.
- Tests of the translator against recorded responses from the other system.

## Overdone when

- A translation layer in front of a well-designed upstream whose model you could simply adopt (conformist), duplicating every type for nothing.
- Translating into a "domain model" that is a field-for-field copy of the external one.
- Layers of mappers between internal modules of one context.

## Example

Before:

```
fn renew(lease_no: str):
    rec = legacy_pms.fetch("LSE", lease_no)
    if rec["STAT_CD"] == 3 and rec["FLG_2"] != "Y":      # 3 = active, FLG_2 = under notice
        rec["END_DT"] = add_months(rec["END_DT"], 12)
        legacy_pms.update("LSE", rec)
```

After:

```
# leasing/legacy_translator.py, the only code that knows the legacy model
class LegacyLeaseTranslator:
    fn to_lease(rec) -> Lease:
        status = ACTIVE if rec["STAT_CD"] == 3 else INACTIVE
        return Lease(LeaseNumber(rec["LSE_NO"]), status, under_notice=rec["FLG_2"] == "Y",
                     ends_on=rec["END_DT"])
    fn to_record(lease: Lease) -> dict: ...

# leasing/renewal.py
fn renew(lease_no: LeaseNumber):
    lease = leases.get(lease_no)                         # repository uses the translator
    lease.renew_for(months=12)
    leases.save(lease)
```

The legacy codes stay inside one translator, so the renewal rule reads in the business's terms and replacing the old system touches one module.

## One-file tell

Any language: an import of an external system's SDK or generated client in a file under the domain or core directory, rather than in its adapter module (for example import stripe in domain/billing.py). Path-aware: needs the project's domain directories and the list of vendor packages configured.

## By language

**python:** A package per external system whose public functions return your own dataclasses; import-linter can forbid importing the vendor SDK anywhere else.

**typescript:** Generated clients (OpenAPI, GraphQL codegen) are the usual leak; keep their types inside the adapter module and export only domain types.

**java:** Generated SOAP or OpenAPI classes belong in the adapter package only; ArchUnit can check that the domain package never imports them.

**csharp:** Keep generated clients and their DTOs in an infrastructure project the domain project doesn't reference.

**go:** An adapter package that alone imports the vendor's module, returning your own structs; keep the vendor's types out of exported signatures.

**rust:** From and TryFrom impls between the external crate's types and yours, kept in one module, are the idiomatic translator.

## Related

[Adapter](adapter.md) · [Facade](facade.md) · [Bounded Context](bounded-context.md) · [Context Map](context-map.md) · [Big Ball of Mud](big-ball-of-mud.md) · [Infrastructure Ignorance](infrastructure-ignorance.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Anticorruption Layer, Conformist, Open-host Service](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 14](https://www.domainlanguage.com/ddd/) (recalled)
- [Microsoft, Azure Architecture Center, Anti-corruption Layer pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 4 and 9](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
