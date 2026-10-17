<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Domain Service

`domain-service` · design patterns, design

A stateless operation named in the domain's language, for a significant piece of domain logic that doesn't naturally belong to any one entity or value object, typically because it involves several of them.

*Names:* Also called Service (DDD). Eric Evans, Domain-Driven Design (2003), ch. 5, which separates domain services from application services and infrastructure services.

*Matters most for:* web-api, fullstack-web

## But

Martin Fowler's anemic domain model critique is the warning: services are where behaviour drifts when nobody asks which object owns it, and a domain full of services is procedural code with extra layers. Put logic on the entity or value object first, and reach for a service only when no object owns it. In code that isn't object-oriented, such as Go or functional TypeScript, a plain function in the domain package is the same thing and needs no class or interface. In CRUD apps the distinction from application services is usually not worth drawing.

## Quality axes

- **change_cost** ⊕ (primary): Logic involving several aggregates gets a named home in the domain instead of one entity reaching into another's internals.

**Flips:** Moving all behaviour into services leaves an anaemic domain model of procedural code with extra layers, turning change_cost "-"; in CRUD apps the distinction isn't worth drawing.

## Warranted when

- A rule needs two or more aggregates or entities, and putting it on one of them would make that one reach into the other.
- Domain experts name the activity as a thing in its own right ("matching", "allocation", "pricing").
- An entity is growing methods that are really about a different concept.

## How it shows

- A stateless class or module function named after a domain activity (TutorMatching, PriceCalculation, ExchangeRateConversion), taking and returning domain objects.
- It lives in the domain layer and imports no database, HTTP or framework code.
- It is distinct from the application service that loads aggregates, calls it and saves the result.

## Overdone when

- Moving all behaviour out of entities into services, leaving entities as data holders, which is Fowler's anemic domain model.
- A service per entity (CustomerService, OrderService) that wraps getters and setters, named after a noun rather than an activity.
- Calling the application layer's orchestration code a domain service, so transactions and I/O leak into the domain.

## Example

Before:

```
class Student:
    availability: list
    subjects: list

    fn find_tutor(tutors: list) -> Tutor:
        for t in tutors:
            if t.rate_band <= self.budget_band and t._calendar.free_at(self.availability) \
               and self.subjects[0] in t._qualifications:
                return t
        return null
```

After:

```
class TutorMatching:                    # domain service, stateless
    fn best_match(student: Student, tutors: list) -> Match:
        candidates = tutors.filter(t -> t.teaches(student.main_subject())
                                   and t.free_during(student.availability)
                                   and t.affordable_for(student))
        return Match.rank(student, candidates).first()

# application service
fn request_tutor(student_id):
    match = tutor_matching.best_match(students.get(student_id), tutors.available())
    matches.save(match)
```

Matching involves both sides, so it gets its own name instead of living on Student and reaching into the tutor's internals; each side still answers questions about itself.

## By language

**go:** A package-level function in the domain package is usually enough; no struct or interface unless it has dependencies that need swapping.

**rust:** A free function in the domain module, taking references to the aggregates involved, is the idiomatic form.

**java:** Spring's @Service stereotype is used for application services too, so the annotation says nothing about which kind it is. Keep domain services free of @Transactional and repositories.

**csharp:** Same trap as Java: a class named XService registered in DI is often an application service. A domain service takes domain objects and returns results, with no DbContext.

## Related

[Entity](entity.md) · [Aggregate](aggregate.md) · [Business logic in helpers](business-logic-in-helpers.md) · [Feature Envy](feature-envy.md) · [Data Class](data-class.md)

## Sources

- [Eric Evans, Domain-Driven Design Reference (2015), Services](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) (read)
- [Eric Evans, Domain-Driven Design (2003), ch. 5](https://www.domainlanguage.com/ddd/) (recalled)
- [Martin Fowler, bliki, AnemicDomainModel](https://martinfowler.com/bliki/AnemicDomainModel.html) (recalled)
- Vaughn Vernon, Implementing Domain-Driven Design (2013), ch. 7 (recalled)
