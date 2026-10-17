<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Domain Allergy

`domain-allergy` · anti-patterns, architecture

Architects and developers treat the business domain as someone else's dull problem and focus on technology, so the system models storage formats or generic "things" instead of the real concepts.

*Matters most for:* fullstack-web, web-api, platforms

## But

A thin CRUD or reporting app whose domain really is just the data doesn't need rich modelling, and keeping the import format at the edge is fine as long as it is translated into domain types once, in one place. The fix is mostly a change of mindset; the code fallout it leaves behind (generic models, overbuilt infrastructure) usually needs significant refactoring, so it's cheaper caught early.

## Quality axes

- **change_cost** −: Generic models switching on code values, and rules kept in people's heads, make every business change slow and new developers take months.

**Flips:** A thin CRUD or reporting app whose domain really is just the data needs no rich modelling.

## Why people fall into it

- technically interesting work is more rewarding than learning insurance law or freight tariffs
- the domain seems boring or someone else's job, so nobody builds a shared vocabulary
- an external feed or file format is right there, so it becomes the model
- the people who carry the domain knowledge tacitly become indispensable and have little reason to write it down

## How it shows

- one or two very wide tables or classes holding every kind of entity, with business logic switching on combinations of code values
- classes named Thing, Item, Entity or Record carrying an attribute bag instead of named domain types
- an internal model that mirrors an external import format field for field
- code and docs that use technical names where the business has its own words for the concepts
- new developers needing months to become productive because the rules live in people's heads

## Overcorrecting looks like

- modelling every distinction the business mentions as its own class hierarchy before any behaviour needs it
- a ubiquitous-language exercise that stalls delivery while the team argues about names

## What to do

Learn the domain and its language (DDD's Ubiquitous Language); introduce explicit domain types behind an Anti-Corruption Layer and strangle the generic model gradually.

## Example

Before:

```
fn monthly_cost(row: map) -> money:
    # row comes straight from the listings feed
    if row["type_cd"] == "R" and row["flag_2"] == "1":
        return row["amt_1"] + row["amt_3"]
    if row["type_cd"] == "R":
        return row["amt_1"]
    if row["type_cd"] == "S":
        return mortgage_estimate(row["amt_1"]) + row["amt_4"]
    ...
```

After:

```
class Rental:
    rent: money
    furnished_surcharge: money

class SaleListing:
    asking_price: money
    service_charge: money

fn from_feed_row(row: map) -> Rental | SaleListing:
    ...   # the only place that knows type_cd, flag_2, amt_1

fn monthly_cost(listing: Rental) -> money:
    return listing.rent + listing.furnished_surcharge
```

The feed's codes are translated once at the boundary, so the rest of the code talks about rentals and sale listings instead of type_cd and amt_3.

## Related

[Misapplied Genericity](misapplied-genericity.md) · [Over-Engineering](over-engineering.md) · [Under-Modularization](under-modularization.md) · [Primitive Obsession](primitive-obsession.md)

## Sources

- [INNOQ, Architecture Antipatterns, Domain Allergy](https://architecture-antipatterns.tech/patterns/domain_allergy.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Flattening the Hierarchy](https://architecture-antipatterns.tech/case_studies/two_huge_domain_classes_represent_all_legal_forms_for_companies_unions_and_foundations.html) (read)
