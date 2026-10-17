<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Ubiquitous Language

`ubiquitous-language` · design patterns, design

Developers and domain experts share one vocabulary within a bounded context and use it everywhere, in talk, docs and especially code, so renaming a concept in conversation means renaming it in code too.

*Names:* Eric Evans, Domain-Driven Design (2003), ch. 2.

*Matters most for:* web-api, fullstack-web, library-sdk, plugin-host

## But

The language holds within one bounded context, not across a company; trying to make it universal is the commonest misreading. For tooling, libraries and infrastructure the "domain" is technical, and its language is the vocabulary of its users, developers, so the practice still applies but there are no business experts to consult. Teams working in a non-English domain face a real trade-off between keeping domain terms untranslated in code and keeping code in one language; both are defensible if chosen deliberately. Drifting Terminology is the anti-pattern this practice prevents, and coding agents produce it readily, so a checked-in glossary is a cheap convention that pays off.

## Quality axes

- **change_cost** ⊕ (primary): A feature request in the business's words maps straight onto the code, with no translation step where meaning gets lost.
- **delivery** −: Names have to be agreed with domain experts and code renamed whenever the business changes how it talks.

**Flips:** Forced as one company-wide glossary across contexts, or onto purely technical code with no business names, it becomes wording arguments and renames that cost without helping.

## Warranted when

- Developers translate between what the business says and what the code says, and things get lost.
- The same concept goes by several names in the code, or one name covers several concepts (Drifting Terminology).
- Bugs trace back to a misunderstanding of what a term meant.
- New developers can't map a feature request onto the code.

## How it shows

- Class, method and module names that a domain expert would recognise (Batch, pitch_yeast, GravityReading) rather than technical stand-ins (Job, add_item, Measurement).
- A glossary in the repository that the code follows, with one entry per term and the context it holds in.
- Commits that rename code after the business changed how it talks about something.
- Tests named in domain sentences.

## Overdone when

- One company-wide glossary forced onto every team, ignoring that terms legitimately differ between contexts.
- Renaming established technical terms (cache, queue, retry) into business words they have no business name for.
- Arguing over wording for code that has no domain experts and no domain beyond its own mechanics.

## Example

Before:

```
class Job:
    readings: list            # brewers call these gravity readings

fn add_item(job: Job, kind: str, grams: int): ...    # kind == "yeast" means pitching
fn finish_job(job: Job): ...                         # brewers say "rack to conditioning"
fn calc_abv(m1: float, m2: float) -> float: ...
```

After:

```
class Batch:
    gravity_readings: list

fn pitch_yeast(batch: Batch, strain: YeastStrain, grams: int): ...
fn add_hops(batch: Batch, variety: HopVariety, grams: int): ...
fn rack_to_conditioning(batch: Batch): ...
fn alcohol_by_volume(original: Gravity, final: Gravity) -> Percentage: ...
```

The code now uses the brewers' own words, so a request about racking or pitching maps straight onto a function.

## Related

[Drifting terminology](drifting-terminology.md) · [Bounded Context](bounded-context.md) · [Domain Allergy](domain-allergy.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Ubiquitous Language](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 2](https://www.domainlanguage.com/ddd/) (recalled)
- [Martin Fowler, bliki, UbiquitousLanguage](https://martinfowler.com/bliki/UbiquitousLanguage.html) (recalled)
- [Vlad Khononov, Learning Domain-Driven Design (2021), ch. 2](https://www.oreilly.com/library/view/learning-domain-driven-design/9781098100124/) (recalled)
