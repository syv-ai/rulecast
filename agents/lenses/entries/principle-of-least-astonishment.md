<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Principle of Least Astonishment

`principle-of-least-astonishment` · principles, design

Code and APIs should do what a reader would guess from how they look and from the habits of the codebase around them. Also called the Rule of Least Surprise.

*Matters most for:* library-sdk, cli-devtool, web-api, plugins-extensions, tui, plugin-host

## But

Surprise is relative to who is reading, so conventions from one ecosystem can astonish people from another. Matching a bad existing convention just to avoid surprise can lock in a mistake; sometimes a deliberate, documented break is the right call.

## Quality axes

- **change_cost** ⊕ (primary): Readers and callers guess correctly what a function, flag or API does from its name and its neighbours, so changes and new uses need less checking.
- **reliability** +: Callers don't trip over hidden side effects or odd defaults, such as a query-named function that writes state.

**Flips:** Matching a bad existing convention just to avoid surprise locks in the mistake, and what surprises depends on the reader's ecosystem.

## How it shows

- functions whose names suggest a query (get, is, has, parse) but that write state or perform I/O
- boolean-sounding names holding non-boolean values
- an API whose argument order or defaults differ from its siblings in the same codebase

## What to do

Name things for what they do, keep side effects out of query-style functions, and follow platform and codebase conventions.

## Example

Before:

```
fn is_session_valid(session: Session) -> bool:
    if session.expires_at < now():
        return False
    session.expires_at = now() + SESSION_LENGTH
    store.save(session)
    return True
```

After:

```
fn is_session_valid(session: Session) -> bool:
    return session.expires_at >= now()

fn extend_session(session: Session):
    session.expires_at = now() + SESSION_LENGTH
    store.save(session)
```

A function named like a question no longer writes to the store; the side effect gets a name that says what it does.

## One-file tell

A function named is* or has* whose body assigns to a field or global, or writes to a file, database or network.

## Related

[Postel's Law](postels-law.md)

## Sources

- [Milanović, Laws of Software Engineering, Principle of Least Astonishment](https://lawsofsoftwareengineering.com/laws/principle-of-least-astonishment/) (read)
