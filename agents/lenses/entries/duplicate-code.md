<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Duplicate Code

`duplicate-code` · smells, code · **agents do this**

The same logic appears in more than one place, so every fix or change has to be made in each copy and the copies drift. Fowler calls it Duplicated Code.

*Names:* It headed his 1st edition's list and comes second, after Mysterious Name, in the 2nd.

*Matters most for:* iac, data-pipeline, scientific, web-frontend

## But

Duplication of knowledge is the problem, not duplication of text. Sandi Metz argues that duplication is cheaper than the wrong abstraction, and many teams wait for the third occurrence (the rule of three (Don Roberts, via Fowler)) before extracting. Copies that belong to different bounded contexts or services are often meant to evolve separately. In tests, repetition that keeps each test readable is usually the better trade.

## Quality axes

- **delivery** +: Copying working code is faster and feels safer than changing a shared function.
- **change_cost** −: Every fix or change has to be made in each copy.
- **reliability** −: Copies drift, so a bug fixed in one place lives on in another.

**Flips:** Copies in different bounded contexts or services are meant to evolve apart, and there the wrong shared abstraction costs more than the duplication.

## Why people fall into it

- Copying working code is faster and feels safer than changing a shared function.
- The author didn't know a helper already existed elsewhere in the codebase.
- Two people solved the same problem at the same time.

## How it shows

- Near-identical blocks in two functions, often with renamed variables.
- Sibling subclasses with the same method bodies.
- Code that looks different but computes the same thing (two ways to normalise an email, two date parsers).
- The same conditional repeated before several calls, or the same lines at the end of every branch.

## Overcorrecting looks like

- Merging code that looks alike but serves different requirements, then threading flags through the shared function as they diverge.
- Extracting after the second occurrence when the shape isn't clear yet.
- Sharing test setup until each test is unreadable on its own.

## What to do

Extract Method within one class. Pull Up Method, Pull Up Field or Pull Up Constructor Body across siblings, and Form Template Method when they differ in steps. Substitute Algorithm when two different algorithms do the same job. Extract Class or Extract Superclass across unrelated classes. Consolidate Conditional Expression and Consolidate Duplicate Conditional Fragments for repeated conditionals.

## Example

Before:

```
fn register(form) -> Account:
    email = form.email.strip().lower()
    if not email or "@" not in email:
        raise InvalidEmail(form.email)
    ...

fn invite(team, raw_email: str):
    email = raw_email.strip().lower()
    if not email or "@" not in email:
        raise InvalidEmail(raw_email)
    ...
```

After:

```
fn normalize_email(raw: str) -> str:
    email = raw.strip().lower()
    if not email or "@" not in email:
        raise InvalidEmail(raw)
    return email

fn register(form) -> Account:
    email = normalize_email(form.email)
    ...

fn invite(team, raw_email: str):
    email = normalize_email(raw_email)
    ...
```

One rule for what counts as an email, so a fix to it lands everywhere.

## One-file tell

Go only: a run of six or more identical, non-blank, non-brace lines that appears twice in one non-test, non-generated file.

## Related

[DRY (Don't Repeat Yourself)](dry.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md) · [Alternative Classes with Different Interfaces](alternative-classes-with-different-interfaces.md) · [Shotgun Surgery](shotgun-surgery.md)

## Overlaps

Start from dry: it says what counts, duplicated knowledge rather than duplicated text. duplicate-code is how it shows in code, copy-and-paste-programming is the habit that produces it, and wrong-abstraction is what an eager merge of copies that only look alike produces.

## Sources

- [Refactoring.Guru, Duplicate Code](https://refactoring.guru/smells/duplicate-code) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
- [Sandi Metz, The Wrong Abstraction (2016)](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) (recalled)
