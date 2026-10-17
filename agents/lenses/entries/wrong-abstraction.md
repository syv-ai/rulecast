<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Wrong abstraction (premature abstraction)

`wrong-abstraction` · anti-patterns, design · **agents do this**

Code that looked alike was merged into one shared abstraction too early, and as the cases diverge it grows parameters and branches until it is harder to change than the duplication was. Sandi Metz's term; Speculative Generality is the related smell.

*Matters most for:* web-frontend, library-sdk, iac

## But

Waiting too long has costs too: copies of a real business rule drift and cause bugs. When the duplicated code encodes one piece of knowledge, DRY is right even at two copies. The disagreement between DRY advocates and the rule-of-three and AHA ("avoid hasty abstractions", Kent C. Dodds) camp is real.

## Quality axes

- **delivery** +: Adding one more parameter to the existing shared code looks cheaper now than writing a separate path.
- **change_cost** −: The shared code grows a parameter and a branch per caller, so each change risks every caller and is harder than changing duplicates would be.

## Why people fall into it

- DRY read as "never write similar code twice".
- A request for clean, general or future-proof code with no concrete second case.
- The sunk cost of an existing abstraction makes adding a parameter feel cheaper than undoing it.

## How it shows

- Replace the line with: "a shared function whose body is mostly conditionals on which caller it is serving". Also replace the force with "A new requirement that almost fits the existing shared code, so adding a parameter looks cheaper than writing a new path", and change the name to "Wrong abstraction".

## Overcorrecting looks like

- Refusing any abstraction and copying everything, so real shared rules drift apart.

## What to do

Inline the abstraction back into each caller, delete what each one doesn't use, then extract again only what is truly shared.

## Example

Before:

```
fn send_notice(user: User, kind: str, include_invoice: bool,
               skip_footer: bool, is_reminder: bool):
    body = template(kind).render(user)
    if include_invoice: body = body + invoice_block(user)
    if is_reminder: body = "Reminder: " + body
    if not skip_footer: body = body + footer()
    mail.send(user.email, body)

send_notice(user, "welcome", false, false, false)
send_notice(user, "overdue", true, true, true)
```

After:

```
fn send_welcome(user: User):
    mail.send(user.email, template("welcome").render(user) + footer())

fn send_overdue_reminder(user: User):
    body = "Reminder: " + template("overdue").render(user)
    mail.send(user.email, body + invoice_block(user))
```

Inlining the flag-driven function gives each notice a plain body of its own; nothing truly shared was lost.

## Related

[DRY (Don't Repeat Yourself)](dry.md) · [YAGNI](yagni.md) · [Speculative Generality](speculative-generality.md) · [Copy-and-paste programming](copy-and-paste-programming.md) · [Dogma over pragma](dogma-over-pragma.md) · [Poltergeist](poltergeist.md)

## Overlaps

Start from dry: it says what counts, duplicated knowledge rather than duplicated text. duplicate-code is how it shows in code, copy-and-paste-programming is the habit that produces it, and wrong-abstraction is what an eager merge of copies that only look alike produces.

## Sources

- [Metz, The Wrong Abstraction (2016)](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) (recalled)
