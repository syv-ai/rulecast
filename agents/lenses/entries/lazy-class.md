<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Lazy Class

`lazy-class` · smells, design

A class does too little to be worth understanding and maintaining.

*Names:* Fowler's 2nd edition widens it to Lazy Element, which covers functions too.

## But

Small isn't the same as lazy. A tiny value object that carries a name and enforces an invariant earns its place, and it is the cure for Primitive Obsession. A thin adapter at a system boundary keeps the rest of the code independent of the outside. The page itself allows a small class that marks intended future work, though YAGNI pulls the other way.

## Quality axes

- **change_cost** −: A class that does almost nothing is still one more name and file to find, read and keep in step.

## Why people fall into it

- Refactoring moved its behaviour elsewhere and left the shell.
- It was created for planned work that never came.
- A belief that every concept needs its own class.

## How it shows

- A class with one trivial method, used from one place.
- A subclass that adds or overrides almost nothing.
- A wrapper whose only method calls a single built-in or library function.

## Overcorrecting looks like

- Inlining a small value type that gives a domain concept a name and a place for its rules, such as an id or a unit.
- Removing a small class that marks a real seam (a port to an external system) because it is thin today.

## What to do

Inline Class to fold it into its caller, or Collapse Hierarchy for a near-empty subclass. In the 2nd edition, Inline Function for a lazy function.

## Example

Before:

```
class JobIdFormatter:
    fn format(job_id: int) -> str:
        return "job-" + str(job_id)

fn enqueue(queue, job):
    key = JobIdFormatter().format(job.id)
    queue.push(key, job.payload)
```

After:

```
fn enqueue(queue, job):
    key = "job-" + str(job.id)
    queue.push(key, job.payload)

# JobIdFormatter deleted
```

The class added a name and an allocation but no rule worth isolating, so it was inlined.

## Related

[Speculative Generality](speculative-generality.md) · [Middle Man](middle-man.md) · [Primitive Obsession](primitive-obsession.md) · [YAGNI](yagni.md)

## Sources

- [Refactoring.Guru, Lazy Class](https://refactoring.guru/smells/lazy-class) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3, Lazy Element](https://martinfowler.com/books/refactoring.html) (recalled)
