<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Layered Architecture

`layered-architecture` · design patterns, architecture

Split the application into horizontal layers, usually presentation, business (service), persistence and database, where each layer only calls the one below it.

*Names:* Also called n-tier architecture. Described as the Layers pattern by Buschmann et al. in Pattern-Oriented Software Architecture vol. 1 (1996), with roots in Dijkstra's THE system (1968). Mark Richards and Neal Ford, Fundamentals of Software Architecture (2020), treat it as the default style and name the sinkhole anti-pattern (layers that only pass requests through). A closed layer must be passed through; an open layer can be skipped.

*Matters most for:* web-api, fullstack-web, desktop

## But

Layering by technical concern is easy to start and hard to scale: changes are usually by feature, so feature work cuts across all layers, and the domain tends to end up anaemic in the service layer. Many people now prefer vertical slices or packaging by feature (Jimmy Bogard's vertical slice architecture, Simon Brown's package by component) with layers inside each slice. Classic layering also lets the business layer depend on persistence, which the dependency rule inverts. Richards and Ford rate it low on deployability and scalability and suggest it mainly for small, simple or budget-bound applications, or as a starting point.

## Quality axes

- **change_cost** ⊕ (primary): UI, rules and data access stop being tangled in the same functions, in a structure every developer recognises.
- **delivery** −: Each feature is written across a controller, a service and a repository, often with pass-through methods.

**Flips:** The familiar shape makes a new project quick to start, so for the first features delivery can be "+". In a large system organised only by layer every feature change touches every folder and pass-through services pile up, turning change_cost "-"; for a small tool the mandatory layers are pure overhead.

## Warranted when

- A team needs an obvious, widely understood structure to start with.
- UI, rules and data access are tangled in the same functions.
- Specialist skills map onto layers (frontend, backend, DBA).
- The application is mostly forms over data with modest rules.

## How it shows

- Top-level folders or packages named controllers, services, repositories, models (or web, application, domain, infrastructure).
- Each controller calling a matching service that calls a matching repository.
- Classic MVC-shaped projects packaged by layer (controllers/, services/, repositories/), where one feature is spread over every layer.

## Overdone when

- Service methods that only call the repository with the same arguments (the architecture sinkhole).
- Mandatory layers for a small tool or script.
- Organising a large system only by layer, so every feature change touches every folder (shotgun surgery across layers).
- Forbidding layer skipping even for read-only queries that gain nothing from the service layer.

## Example

Before:

```
fn checkout_book(request):
    member = db.query("select * from members where id = ?", request.member_id)
    if member.fines > 10:
        return render("error.html", msg="Pay your fines first")
    db.execute("insert into loans (book_id, member_id) values (?, ?)",
               request.book_id, member.id)
    return render("loan_ok.html")
```

After:

```
# presentation
fn checkout_book(request):
    try: lending.checkout(request.member_id, request.book_id)
    except FinesOutstanding: return render("error.html", msg="Pay your fines first")
    return render("loan_ok.html")

# business
class LendingService:
    fn checkout(member_id, book_id):
        member = members.get(member_id)
        if member.fines > 10: raise FinesOutstanding()
        loans.add(Loan(book_id, member.id))
# persistence
class MemberRepository: ...
class LoanRepository: ...
```

The rendering, the lending rule and the SQL each sit in their own layer, and each layer only calls down.

## By language

**java:** The default shape of Spring Boot apps (@Controller, @Service, @Repository stereotypes). ArchUnit has built-in layered-architecture checks.

**csharp:** Common as separate projects per layer (Web, Business, DataAccess). Newer templates tend toward clean architecture projects instead, which invert the persistence dependency.

**python:** Django's apps cut by feature with models, views and forms inside each, which is closer to vertical slices than to global layers. FastAPI projects often adopt routers, services and repositories folders by convention, not by framework requirement.

**go:** Packaging by layer (`controllers`, `models`) is widely considered unidiomatic; the Go community prefers packages named for what they provide, which pushes toward feature packages.

## Related

[The Dependency Rule](dependency-rule.md) · [Ports and Adapters](ports-and-adapters.md) · [Shotgun Surgery](shotgun-surgery.md) · [Big Ball of Mud](big-ball-of-mud.md)

## Overlaps

dependency-rule is the principle (dependencies point toward policy). dependency-inversion-principle is the same idea at the scale of one dependency: the interface belongs to the code that needs it, which is how a single import is made to point inward. ports-and-adapters is the architecture built on both, and layered-architecture the older style it corrects, where the domain depends on persistence.

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)

## Sources

- Buschmann, Meunier, Rohnert, Sommerlad, Stal, Pattern-Oriented Software Architecture vol. 1 (1996), Layers (recalled)
- Mark Richards and Neal Ford, Fundamentals of Software Architecture (2020), Layered Architecture Style (recalled)
