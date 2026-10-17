<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Tell, Don't Ask

`tell-dont-ask` · principles, design · **contested**

Rather than asking an object for its data and deciding for it, tell the object what you want and let it decide using its own data. It puts behaviour next to the data it uses.

*Names:* From Alec Sharp's Smalltalk by Example (1997), which contrasts procedural code that fetches data and decides with object-oriented code that tells objects what to do. Andy Hunt and Dave Thomas (the Pragmatic Programmers) spread the name in their IEEE Software column The Art of Enbugging (2003), citing Sharp. Fowler's bliki entry is the usual reference, and he frames it as a step toward co-locating data and behaviour.

## But

Fowler doesn't use the principle himself; he prefers to think in terms of keeping data and behaviour that change together in one place, and has seen code made worse by telling where a plain query would be simpler. Querying is the right shape for read models, reports, views and serialisation, and for transformation objects whose job is to hand data to others. Functional and data-oriented designs separate data from behaviour on purpose and get testability and simplicity in return, so the principle fits rich-object domain models more than pipelines of plain records. Rules that span several objects belong in a service or policy, not in any one of them.

## Quality axes

- **change_cost** ⊕ (primary): A rule about an object's state lives in one method, so callers don't copy it and don't break when its fields change.
- **reliability** +: Callers can't change an object's state without going through the method that checks its rules, such as bumping copies_out without checking holds.

**Flips:** In read models, reports, serialisation and data-oriented or functional code, a plain query is simpler. Forcing behaviour into entities there grows Large Classes, and change_cost turns "-".

## Warranted when

- A rule about an object's state is copied into each caller that needs it.
- Callers break when an object's fields change, because they reach into them to decide.
- A method uses another object's data more than its own (Feature Envy).

## How it shows

- Callers that read several getters from one object, decide something, then call setters on it.
- The same conditional on an object's fields repeated in several callers.
- Classes that are only getters and setters, with the rules that concern them living elsewhere.
- After the change, methods named for intentions (lend_to, raise_alarm_if_needed) instead of getters.

## Overdone when

- Removing every getter, so code that needs to display, serialise or report data has to go through awkward callbacks; Fowler calls such people getter eradicators.
- Pushing unrelated behaviour into an entity because it holds the data, which grows a Large Class.
- Pulling presentation, persistence or policy concerns into domain objects, against layering.

## Example

Before:

```
fn checkout(book: Book, member: Member):
    if book.on_hold_for is not None and book.on_hold_for != member:
        raise OnHold
    if book.copies_out >= book.copies_total:
        raise NoCopies
    book.copies_out += 1
    book.loans.add(Loan(member, today() + 21 days))
```

After:

```
class Book:
    fn lend_to(member: Member) -> Loan:
        if self.on_hold_for not in (None, member): raise OnHold
        if self.copies_out >= self.copies_total: raise NoCopies
        self.copies_out += 1
        loan = Loan(member, today() + 21 days)
        self.loans.add(loan)
        return loan

fn checkout(book: Book, member: Member):
    book.lend_to(member)
```

The lending rules move into the book that owns the copies and holds, so no caller can bump copies_out without checking them.

## By language

**python:** Properties hide whether a value is stored or computed, which blurs asking and telling; a dataclass with logic in callers is the common shape to watch.

**typescript:** Interfaces of plain data with logic in functions are idiomatic in much TypeScript, especially in front ends, and apply the opposite style on purpose. The principle fits class-based domain models.

**java:** JavaBean getters and setters and anemic JPA entities are the usual target; a method on the entity is the tell-style fix.

**csharp:** Auto-properties make ask-style code the default; domain-driven design in .NET pushes rules into entity methods with private setters.

**go:** Structs with exported fields and functions in the same package are idiomatic; telling is done by a method on the type that owns the rule, but Go doesn't push hard either way.

**rust:** Methods on the type that owns the data, with private fields, are the norm, so the principle tends to be followed by default within a module.

## Related

[Law of Demeter](law-of-demeter.md) · [Feature Envy](feature-envy.md) · [Data Class](data-class.md) · [Message Chains](message-chains.md) · [Command-Query Separation (CQS)](command-query-separation.md) · [Inappropriate Intimacy](inappropriate-intimacy.md)

## Sources

- [Martin Fowler, bliki, TellDontAsk](https://martinfowler.com/bliki/TellDontAsk.html) (read)
- [Andy Hunt and Dave Thomas, The Art of Enbugging, IEEE Software (2003)](https://media.pragprog.com/articles/jan_03_enbug.pdf) (recalled)
