<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Spaghetti code

`spaghetti-code` · anti-patterns, code

Control flow is so tangled, with jumps, flags and deep nesting, that you can't follow what happens without tracing it by hand.

*Matters most for:* scientific, embedded, games

## But

A long, flat function that reads top to bottom is not spaghetti. Complexity metrics flag it too often to be a judgement on their own. Hot loops and state machines sometimes need explicit flow that looks dense; a clear comment can be enough.

## Quality axes

- **delivery** +: Adding one more condition where the bug showed up is the fastest fix each time.
- **change_cost** −: Tangled flags and jumps can only be followed by tracing by hand, so every edit risks breaking another path.

**Flips:** In hot loops and state machines, dense explicit flow can be the right trade for performance, as long as it is commented.

## Why people fall into it

- Each fix adds one more condition where the bug showed up.
- No tests, so nobody dares restructure.

## How it shows

- long functions with deep nesting and boolean flags set in one branch and checked in another
- early exits, breaks and gotos mixed with flags so several paths reach the same lines
- functions that read and write shared variables from many places

## Overcorrecting looks like

- Breaking a readable linear function into many tiny ones that you must jump between.

## What to do

Extract Method, Replace Nested Conditional with Guard Clauses, and replace control flags with early returns.

## Example

Before:

```
fn check_in(ticket: Ticket) -> str:
    ok = true
    msg = ""
    if ticket.event.started:
        if not ticket.late_entry:
            ok = false
            msg = "closed"
    if ok:
        if ticket.used:
            ok = false
            msg = "used"
        else:
            if ticket.vip and not gate.vip: msg = "vip gate"; ok = false
    if ok: ticket.used = true; msg = "welcome"
    return msg
```

After:

```
fn check_in(ticket: Ticket) -> str:
    if ticket.event.started and not ticket.late_entry:
        return "closed"
    if ticket.used:
        return "used"
    if ticket.vip and not gate.vip:
        return "vip gate"
    ticket.used = true
    return "welcome"
```

Guard clauses replace the ok flag, so each rule reads as one line and returns at once.

## Related

[Long Method](long-method.md) · [Big Ball of Mud](big-ball-of-mud.md) · [KISS (Keep It Simple, Stupid)](kiss.md)

## Overlaps

big-ball-of-mud is the whole system; spaghetti-code is tangled control flow inside a module. A codebase can have either without the other.

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Spaghetti Code (recalled)
