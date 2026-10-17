<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Poltergeist

`poltergeist` · anti-patterns, design · **agents do this**

A class that owns nothing and lives for a moment, made only to kick off work that really belongs to other objects, then thrown away. Close to the Middle Man and Lazy Class smells.

## But

A thin class earns its place when it is a real boundary: it adapts a vendor API, carries a request across a queue, or is the Command pattern with undo or retry. Framework entry points (an HTTP handler, a CLI command) are thin by design and should stay thin. The test is whether removing it would lose anything.

## Quality axes

- **change_cost** −: A throwaway class that only forwards adds a hop every reader must trace through, and a file to keep in step, for no gain.

## Why people fall into it

- A misread rule that every action needs its own class or that callers must never touch the real object directly.
- Frameworks and examples that put a controller or handler class in front of everything.
- Wanting a seam for testing where nothing actually varies.

## How it shows

- classes named Starter, Launcher, Invoker, Runner or Handler with one method that forwards to another object
- objects created, used for one call and dropped in the same line
- a layer of classes whose methods each make one call into the next layer

## Overcorrecting looks like

- Removing a thin class that was a real boundary, such as an adapter at a third-party API or a port in a hexagonal design.
- Inlining a command object that is queued, logged or undone, which is a legitimate use of a short-lived class.

## What to do

Inline Class, or Remove Middle Man, so callers use the object that does the work.

## Example

Before:

```
class PayrollRunStarter:
    fn start(month: Month):
        PayrollRun(month).execute()

class PayslipSender:
    fn send(run: PayrollRun):
        Mailer().send_all(run.payslips())

PayrollRunStarter().start(month)
```

After:

```
fn close_month(month: Month, mailer: Mailer):
    run = PayrollRun(month)
    run.execute()
    mailer.send_all(run.payslips())
```

The two classes added nothing but a hop, so callers talk to PayrollRun and the mailer directly.

## Related

[Middle Man](middle-man.md) · [Lazy Class](lazy-class.md) · [Command](command.md) · [Adapter](adapter.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Poltergeists (recalled)
- [Wikipedia, Anti-pattern, In software engineering](https://en.wikipedia.org/wiki/Anti-pattern) (read)
