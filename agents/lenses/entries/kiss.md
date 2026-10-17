<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# KISS (Keep It Simple, Stupid)

`kiss` · principles, design

Pick the simplest design that meets the actual requirement.

## But

"Simple" is in the eye of the beholder: a shorter solution can be harder to follow, and pushing complexity out of the code can just move it to callers or operations. Rich Hickey's distinction between simple (not tangled) and easy (familiar) is useful here. Some problems are genuinely complex and need a design that matches.

## Quality axes

- **change_cost** ⊕ (primary): Less indirection and generality to read and work around in every later change.
- **delivery** +: The simplest design that meets the requirement is the least to build now.

**Flips:** For a problem with real essential complexity, a too-simple design pushes the complexity onto callers or operations, so change_cost and operability turn "-".

## How it shows

- plugin systems, generic frameworks or abstract base classes with a single implementation
- configuration options and extension points that nothing uses

## What to do

Remove indirection and generality that no current requirement needs.

## Example

Before:

```
interface ResetChannel:
    fn send(user: User, link: str)

class EmailResetChannel implements ResetChannel:
    fn send(user: User, link: str):
        mailer.send(user.email, "Reset your password", link)

CHANNELS = {"email": EmailResetChannel()}

fn request_reset(user: User, channel: str = "email"):
    CHANNELS[channel].send(user, make_reset_link(user))
```

After:

```
fn request_reset(user: User):
    link = make_reset_link(user)
    mailer.send(user.email, "Reset your password", link)

# the only call
request_reset(user)
```

The only requirement is reset by email, so the channel interface, registry and parameter come out until a second channel is actually needed.

## Related

[YAGNI](yagni.md) · [Gall's Law](galls-law.md) · [Kernighan's Law](kernighans-law.md) · [DRY (Don't Repeat Yourself)](dry.md)

## Overlaps

kiss is the one to use for code. occams-razor is the general form, for choosing between explanations, such as when debugging.

## Sources

- [Milanović, Laws of Software Engineering, KISS (Keep It Simple, Stupid)](https://lawsofsoftwareengineering.com/laws/kiss-principle/) (read)
