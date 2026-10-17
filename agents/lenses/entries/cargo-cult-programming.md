<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Cargo cult programming

`cargo-cult-programming` · anti-patterns, code · **agents do this**

Code, rituals or structure are copied because they appeared in working code, without understanding what they do or whether they apply here.

*Names:* This is the code-scale lens; blind pattern following (INNOQ's renamed "cargo-culting") covers adopting whole architectures, tools or processes, and is kept separate.

*Matters most for:* iac, ml-training, serverless

## But

Following an established template without understanding every line is normal and often wise for newcomers, as long as someone understands it. Some defensive code really does guard a rare case, and its lack of comment is the problem, not its existence. The name is still the standard one at code scale (Jargon File, Wikipedia), though some, like INNOQ at architecture scale, avoid "cargo cult" for its colonial overtones.

## Quality axes

- **delivery** +: Copying from a working example is faster than understanding it.
- **change_cost** −: Code nobody understands can't be safely changed or removed, so it piles up and every reader has to work around it.
- **operability** −: Config flags nobody can explain and log-and-rethrow wrappers on every function make production behaviour hard to reason about and logs noisy.

## Why people fall into it

- Something worked once with the code in it, and removing it feels risky.
- Copying from a trusted source or example is faster than understanding it.
- Fear of breaking things nobody understands.

## How it shows

- sleeps, retries, deep copies or explicit flushes with no comment saying what they guard against
- boilerplate copied from another project or example that does nothing in this one
- settings or flags in config files that nobody on the team can explain
- try/catch wrappers that log and rethrow on every function

## Overcorrecting looks like

- Ripping out an odd-looking line without checking why it is there (Chesterton's fence).

## What to do

Find out what the code is for; delete it if it has no reason, or name and comment the reason if it does.

## Example

Before:

```
fn send_newsletter(issue: Issue, subscribers: list):
    issue = deep_copy(issue)
    for sub in subscribers:
        try:
            sleep(0.5)
            mailer.send(sub.email, render(issue))
            mailer.flush()
        except Error as e:
            log(e)
            raise e
```

After:

```
SEND_INTERVAL = 0.5  # provider allows two messages per second

fn send_newsletter(issue: Issue, subscribers: list):
    for sub in subscribers:
        sleep(SEND_INTERVAL)
        mailer.send(sub.email, render(issue))
```

The copy, the flush and the log-and-rethrow did nothing here; the sleep had a real reason, so it got a name.

## Related

[Dogma over pragma](dogma-over-pragma.md) · [Copy-and-paste programming](copy-and-paste-programming.md) · [Lava flow](lava-flow.md)

## Overlaps

All four are practice without reasons. cargo-cult-programming is the code-level form, blind-pattern-following the architecture and process form, golden-hammer one tool used for everything, and dogma-over-pragma a rule kept where its reason doesn't apply.

## In the interview

- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)

## Sources

- Feynman, Cargo Cult Science (1974), the origin of the term (recalled)
- The Jargon File, cargo cult programming (recalled)
