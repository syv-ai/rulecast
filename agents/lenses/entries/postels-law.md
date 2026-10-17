<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Postel's Law

`postels-law` · principles, quality · **contested**

Be strict in what you send and tolerant in what you accept. Also called the Robustness Principle.

*Matters most for:* web-api, compilers-tooling, data-pipeline, event-driven, plugin-host

## But

Liberal acceptance entrenches broken input: producers never fix their bugs, every consumer has to copy the same quirks, and lenient parsing opens security holes (request smuggling, parser differentials). Eric Allman's "The Robustness Principle Reconsidered" and RFC 9413 by Martin Thomson and David Schinazi argue for strict, well-specified handling instead. For a new protocol or an internal API, rejecting bad input clearly is usually the better default.

## Quality axes

- **reliability** ⊕ (primary): Imperfect but honest peers keep working with you instead of being rejected over minor deviations.
- **security** −: Lenient parsing opens parser differentials and request smuggling, where two components read the same input differently.
- **change_cost** −: Accepted quirks become de facto protocol, so producers never fix them and every consumer has to copy them.

**Flips:** For a new protocol or an internal API, strict rejection with clear errors is better. Over time liberal acceptance entrenches broken input and hides which producer is wrong, and even reliability turns "-".

## How it shows

- parsers or API handlers that silently guess at malformed input (default time zones, coerced types, dropped fields)
- output serialised loosely while input is validated strictly, or the other way round

## Example

Before:

```
fn read_flight_update(payload: dict) -> FlightUpdate:
    if payload.keys() != {"flight", "status", "gate"}:
        raise BadPayload("unexpected fields")
    status = Status.from_name(payload["status"])
    return FlightUpdate(payload["flight"], status, payload["gate"])

fn send_flight_update(update: FlightUpdate) -> dict:
    return {"flight": update.flight, "status": update.status.name.lower(), "gate": update.gate or ""}
```

After:

```
fn read_flight_update(payload: dict) -> FlightUpdate:
    # the spec allows extra fields and an absent gate; ignore or accept those
    for key in ["flight", "status"]:
        if key not in payload:
            raise BadPayload("missing " + key)
    status = Status.from_name(payload["status"])   # raises on an unknown status
    return FlightUpdate(payload["flight"], status, payload.get("gate"))

fn send_flight_update(update: FlightUpdate) -> dict:
    out = {"flight": update.flight, "status": update.status.name}
    if update.gate is not None:
        out["gate"] = update.gate
    return out
```

The receiver accepts what the spec allows (extra fields, no gate) and still rejects missing fields and unknown values instead of guessing, while the sender emits one exact form; tolerance stops at what the spec permits.

## Related

[Murphy's Law](murphys-law.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Overlaps

postels-law is the general (and contested) principle; tolerant-reader is the narrow, safe version: a consumer reads only the fields it needs and ignores the rest, while still rejecting what breaks the contract.

## Sources

- [Milanović, Laws of Software Engineering, Postel's Law](https://lawsofsoftwareengineering.com/laws/postels-law/) (read)
- [Thomson and Schinazi, RFC 9413: Maintaining Robust Protocols](https://www.rfc-editor.org/rfc/rfc9413) (recalled)
