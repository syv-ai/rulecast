<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Drifting terminology

`drifting-terminology` · anti-patterns, design · **agents do this**

The same concept goes by different names in different parts of the code, or one name means different things, so the code stops matching how the domain is talked about. DDD's ubiquitous language is the counter-ideal.

*Matters most for:* web-api, fullstack-web, platforms, library-sdk

## But

Different meanings in different bounded contexts are expected in DDD, as long as the boundary is explicit and translation happens at it. Public API and database names can be costly to change, so a documented alias at the edge is sometimes the right trade.

## Quality axes

- **change_cost** −: Searching for a concept misses code that names it differently, one word meaning two things invites misreadings, and mapping code exists only to rename.

**Flips:** At a public API or database edge where renaming breaks clients, a documented alias can be cheaper than aligning the name.

## Why people fall into it

- Different people or teams name things as they go, and nobody owns the vocabulary.
- A rename of the domain term happens in conversation but not in the code.
- Each new piece of code is written without reading what the existing code calls the concept.

## How it shows

- Customer, Client, Account and User used for the same thing in different modules
- one word, such as order or account, that means different things in different modules without a stated boundary
- mapping functions that only rename fields between two names for the same thing
- code names that differ from what the product, support or the domain experts say

## Overcorrecting looks like

- Forcing one word across bounded contexts where it genuinely means different things.
- Large rename-only changes that churn history for a small gain.

## What to do

Agree a glossary with the domain experts, Rename to it, and draw explicit context boundaries where one word must mean two things.

## Example

Before:

```
class Parcel:
    tracking_code: str

fn dispatch_package(pkg: Parcel): ...
fn track_consignment(consignment_id: str): ...
fn label_for_shipment(item: Parcel) -> Label: ...
```

After:

```
class Parcel:
    tracking_code: str

fn dispatch(parcel: Parcel): ...
fn track(parcel_tracking_code: str): ...
fn label_for(parcel: Parcel) -> Label: ...
```

One concept, one name, the one the warehouse staff use, so nobody wonders whether a consignment is something else.

## Related

[Business logic in helpers](business-logic-in-helpers.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## In the interview

- [Before proposing a convention, count where the code already breaks it and what an enforced rule would flag on day one.](../THINKING.md#check-the-draft-against-the-code)
- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)

## Sources

- [Evans, Domain-Driven Design Reference (2015), Ubiquitous Language and Bounded Context](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (recalled)
