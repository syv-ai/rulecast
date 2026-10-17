<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Tolerant Reader

`tolerant-reader` · design patterns, architecture · **contested**

When consuming another service's data, read only the fields you need, assume as little about the structure as you can, and ignore what you don't recognise, so the provider can add things without breaking you.

*Names:* Described by Martin Fowler (bliki, 2011), who credits Robert Daigneau's Service Design Patterns (2011) for the full write-up. It applies the "liberal in what you accept" half of Postel's law to service consumers. Pairs with consumer-driven contracts (Ian Robinson) and with a conservative, or magnanimous, writer.

*Matters most for:* distributed, event-driven, web-api, library-sdk

## But

Tolerance is for structure you don't use, not for values you do. Required fields should still be checked, and wrong types should still fail, at the edge (parse, don't validate). Critics of Postel's law, notably Martin Thomson and David Schinazi in RFC 9413, argue that liberal acceptance entrenches broken senders and lets ambiguity spread; a tolerant reader without contract tests can hide a provider's real breaking change until production. For your own inputs, such as config files, rejecting unknown keys catches typos and is usually better. Strictness belongs to the read, not the type. When one type is both a user's config file and part of a payload sent to plugins or other versions, rejecting unknown fields on the type makes every reader strict, so an old plugin fails on a field it doesn't need. Check strictly in the loader for the user's file, and let the type and its other readers stay tolerant.

## Quality axes

- **change_cost** ⊕ (primary): The consumer depends only on the fields it uses, so providers and consumers evolve on their own schedules without coordinated releases.
- **reliability** +: Old consumers keep working on newer payloads and on messages that outlive the code that wrote them.

**Flips:** Tolerating malformed or missing required data lets bad input flow on and, without contract tests, hides a provider's real breaking change until production (reliability "-"); ignoring unknown fields in security-sensitive input or your own config is the wrong default (security "-").

## Warranted when

- A consumer breaks whenever the provider adds a field or reorders a document.
- Client classes are generated from the provider's full schema and regenerated on every change.
- Many consumers of one API evolve on different schedules.
- Event or message payloads outlive the code that wrote them.

## How it shows

- Deserialisers configured to ignore unknown fields.
- One reader or DTO per external payload that picks out the needed fields, with defaults for optional ones.
- Path lookups that don't depend on the full nesting of a document.
- Consumer contract tests that the provider runs in its build.
- One type marked deny_unknown_fields or .strict() that is both a user-edited config and part of a payload to plugins or other versions

## Overdone when

- Guessing at malformed or missing required data instead of failing, so bad input flows on silently.
- Accepting fields under several spellings or types "to be safe", which providers then rely on.
- Ignoring unknown fields in security-sensitive input, where an unexpected field may be an attack or a mistake worth rejecting.

## Example

Before:

```
class StationReading:          # generated from the provider's full schema
    station_id: str
    temp_c: float
    humidity: float
    pressure_hpa: float
    firmware: str
    location: Location         # nested, all fields required

reading = strict_decode(StationReading, payload)   # fails on any new or renamed field
```

After:

```
fn read_station(payload: dict) -> Reading:
    return Reading(
        station_id = require(payload, "station_id"),
        temp_c = require_number(payload, "temp_c"),
        humidity = payload.get("humidity", None),     # optional for us
    )
# unknown fields are ignored; the provider can add sensors freely
```

The consumer depends only on the three fields it uses, still fails on the ones it truly needs, and keeps the reading code in one place.

## By language

**python:** Pydantic models ignore extra fields by default (extra="ignore"); extra="forbid" is the strict opposite. Read only the fields the model declares.

**typescript:** Runtime validators decide this, not types: zod objects strip unknown keys by default, and .strict() rejects them. A bare type assertion on JSON checks nothing at all.

**java:** Jackson 2 fails on unknown properties by default; set FAIL_ON_UNKNOWN_PROPERTIES to false or annotate @JsonIgnoreProperties(ignoreUnknown = true). Jackson 3 flipped that default, so unknown properties are ignored unless you turn the check back on. Spring Boot's auto-configured mapper ignores them in both.

**csharp:** System.Text.Json ignores unknown members by default; .NET 8 added JsonUnmappedMemberHandling.Disallow for strictness.

**go:** encoding/json ignores unknown fields by default; Decoder.DisallowUnknownFields turns on strictness. Missing fields silently become zero values, so check required ones explicitly.

**rust:** serde ignores unknown fields unless the type has #[serde(deny_unknown_fields)]; use #[serde(default)] or Option for fields that may be absent. deny_unknown_fields applies wherever the type is deserialized; to be strict for one reader only, use a separate wrapper type or a check in that loader.

## Related

[Postel's Law](postels-law.md) · [Hyrum's Law](hyrums-law.md) · [Adapter](adapter.md)

## Overlaps

postels-law is the general (and contested) principle; tolerant-reader is the narrow, safe version: a consumer reads only the fields it needs and ignores the rest, while still rejecting what breaks the contract.

## Sources

- [Martin Fowler, Tolerant Reader (bliki, 2011)](https://martinfowler.com/bliki/TolerantReader.html) (read)
- Robert Daigneau, Service Design Patterns (2011), Tolerant Reader (recalled)
- [Martin Thomson and David Schinazi, RFC 9413, Maintaining Robust Protocols (2023)](https://www.rfc-editor.org/rfc/rfc9413) (recalled)
