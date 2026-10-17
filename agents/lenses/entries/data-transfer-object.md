<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Data Transfer Object

`data-transfer-object` · design patterns, architecture

Carry data across a boundary (a network call, an API, a queue) in a plain object shaped for that boundary, separate from the domain objects behind it.

*Names:* Named in Fowler's PoEAA (2002) for cutting the number of remote calls; Sun's Core J2EE Patterns called it Transfer Object (earlier Value Object, a clash with the DDD term). Today the name is used more broadly for request and response models at API edges (Pydantic schemas, record DTOs, view models).

*Matters most for:* web-api, fullstack-web, distributed, library-sdk

## But

Fowler's own LocalDTO note (2004) says DTOs inside one process are usually harmful: they add mapping cost for no remote call saved. He allows them where the presentation's shape differs a lot from the domain. Use them at real boundaries, the public API, messages and other services, and pass domain objects within the process. Coupling the API to entities is the opposite failure, so the question is where the boundary is.

## Quality axes

- **change_cost** ⊕ (primary): The API keeps its own shape, so the domain and schema behind it can change without breaking clients.
- **security** +: Internal fields and lazy-loaded relations aren't exposed by serialising entities straight to JSON.
- **runtime** +: One call carries everything the client needs instead of several remote round trips.
- **delivery** −: Separate types and mapping code to write, and a new field is edited in more than one place.

**Flips:** Between layers inside one process DTOs add mapping cost with no remote call saved, turning change_cost "-".

## Warranted when

- Entities are serialised straight to JSON, exposing internal fields or leaking lazy-loaded relations.
- The API contract must stay stable while the domain or schema changes.
- A client needs data from several objects in one call.

## How it shows

- Request and response types (CreateOrderRequest, OrderDto, OrderOut) separate from entities.
- Mapping functions or libraries (MapStruct, AutoMapper, model_validate) between DTOs and domain objects.
- Serialisation annotations on DTOs and none on domain types.

## Overdone when

- DTOs between layers inside one process, with mapping code copying the same fields at every layer.
- A DTO per entity mirroring it field for field, so every new column is edited in three places.
- Mapping libraries hiding the mapping so mistakes only show at runtime.

## Example

Before:

```
fn get_station(req) -> json:
    station = stations.get(req.id)
    return to_json(station)
    # sends api_key, internal calibration offsets and every reading ever taken;
    # renaming a field on Station breaks the mobile app
```

After:

```
class StationResponse:
    id: str
    name: str
    latest_temp_c: float
    updated_at: Time

fn get_station(req) -> json:
    s = stations.get(req.id)
    return to_json(StationResponse(s.id, s.name, s.latest().temp_c, s.latest().at))
```

The API gets its own shape, so internal fields stay hidden and the domain can change without breaking clients.

## By language

**python:** Pydantic models are the standard DTOs in FastAPI (separate Create, Update and Public schemas is the template's style); Django REST Framework serializers play the same role.

**java:** Records make DTOs cheap; MapStruct generates mappers at compile time. Returning JPA entities from controllers is a known source of lazy-loading and leakage bugs.

**csharp:** Records with hand-written mapping, or a mapper such as Mapperly (source-generated) or AutoMapper; since 15.0 (2025) AutoMapper is dual-licensed, RPL-1.5 or commercial, with a free community licence for small organisations, which has pushed many teams to hand-written or generated mapping. Minimal APIs and controllers commonly use request and response records. AutoMapper's own author advises against using it for complex mappings.

**typescript:** Often just types or interfaces, with runtime validation by zod or class-validator at the edge; NestJS uses DTO classes with decorators.

**go:** Separate structs with JSON tags for the API, converted from domain or row structs; keeping json tags off domain types is the usual line.

**rust:** Separate structs deriving Serialize and Deserialize, with From impls to and from domain types; serde attributes stay on the DTOs.

## Related

[Data Class](data-class.md) · [Data Mapper](data-mapper.md) · [Facade](facade.md) · [Over-Engineering](over-engineering.md) · [Shotgun Surgery](shotgun-surgery.md)

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Data Transfer Object (catalog summary)](https://martinfowler.com/eaaCatalog/dataTransferObject.html) (read)
- [Martin Fowler, LocalDTO (bliki, 2004)](https://martinfowler.com/bliki/LocalDTO.html) (read)
- [Sun Microsystems, Core J2EE Patterns, Transfer Object](https://www.oracle.com/java/technologies/transfer-object.html) (recalled)
