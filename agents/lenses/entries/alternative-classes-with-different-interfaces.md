<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Alternative Classes with Different Interfaces

`alternative-classes-with-different-interfaces` · smells, design · **agents do this**

Two classes do the same job behind different method names and signatures, so callers can't swap one for the other and nobody notices they are duplicates.

*Matters most for:* library-sdk, platforms

## But

Leave it when the two classes come from different libraries or vendors, or when wrapping them in one interface would cost more than the duplication. Two classes that look similar but answer to different requirements may be coincidental duplication, and unifying them couples things that should drift apart (Sandi Metz's point that the wrong abstraction costs more than duplication).

## Quality axes

- **delivery** +: Writing your own client is quicker than finding, or changing, the one that already exists.
- **change_cost** −: Two names for one job means fixes and features go into one copy, and callers can't swap one for the other.

**Flips:** Classes from different vendors, or ones that only look alike and answer to different requirements, are better left apart than forced under one interface.

## Why people fall into it

- The author didn't know the first class existed, or couldn't find it under the name they searched for.
- Two teams or two features grew their own version in parallel.
- Copying and renaming felt safer than changing a class someone else owns.

## How it shows

- Two classes with near-identical responsibilities whose methods differ only in name or argument order (send vs dispatch, fetch vs load).
- Call sites that branch on which of the two they hold, just to call the right-named method.
- A second utility or client written for something the codebase already had, often in a different package.

## Overcorrecting looks like

- Forcing a shared interface on two classes that only look alike today and serve different callers with different futures.
- Merging classes from two third-party libraries that you don't control.

## What to do

Rename Method until the names match, then Move Method, Add Parameter or Parameterize Method until the signatures match. Extract Superclass (or a shared interface) when only part overlaps. Once they line up, delete one.

## Example

Before:

```
class SmsAlerter:
    fn dispatch(phone: str, body: str): ...

class PushAlerter:
    fn notify(body: str, device_token: str): ...

fn alert_on_call(engineer, msg):
    if engineer.prefers_sms:
        SmsAlerter().dispatch(engineer.phone, msg)
    else:
        PushAlerter().notify(msg, engineer.device_token)
```

After:

```
interface Alerter:
    fn send(engineer, body: str)

class SmsAlerter implements Alerter:
    fn send(engineer, body): ... uses engineer.phone

class PushAlerter implements Alerter:
    fn send(engineer, body): ... uses engineer.device_token

fn alert_on_call(engineer, msg):
    engineer.alerter.send(engineer, msg)
```

Aligning the names and signatures lets the caller treat both as one thing and drops the branch.

## Related

[Duplicate Code](duplicate-code.md) · [Adapter](adapter.md) · [DRY (Don't Repeat Yourself)](dry.md) · [Wrong abstraction (premature abstraction)](wrong-abstraction.md)

## Sources

- [Refactoring.Guru, Alternative Classes with Different Interfaces](https://refactoring.guru/smells/alternative-classes-with-different-interfaces) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
