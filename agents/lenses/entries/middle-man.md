<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Middle Man

`middle-man` · smells, design · **agents do this**

A class mostly forwards calls to another class and adds nothing of its own.

*Matters most for:* library-sdk

## But

Keep it when it reduces dependencies, for example by keeping the rest of the code from importing a vendor SDK, or when it's a Proxy, Decorator or Adapter by design. Ousterhout's shallow module critique covers the bad case: if a caller has to understand as much as the wrapper does for them, the wrapper is noise.

## Quality axes

- **change_cost** −: Every change to the delegate has to be mirrored in a forwarding method that adds nothing.

**Flips:** A deliberate Proxy, Decorator, Adapter or Facade, such as one that keeps a vendor SDK out of the rest of the code, earns its forwarding.

## Why people fall into it

- Message chains were removed by adding forwarding methods everywhere.
- Logic migrated out of the class over time, leaving the delegation.
- A habit of wrapping every dependency "in case it changes".

## How it shows

- Most methods are one line that calls the same method on the same field.
- A wrapper or service whose signature is as complicated as what it wraps.
- Callers that could use the delegate directly, and sometimes do.

## Overcorrecting looks like

- Removing a deliberate Proxy, Decorator, Adapter or Facade that controls access or decouples callers from a third-party API.
- Exposing a deep internal object to all callers to save a few forwarding lines.

## What to do

Remove Middle Man so callers use the delegate directly. Inline Method for the few forwarders worth keeping in callers. If the class must stay, give it real behaviour or make it a subclass of the delegate (Replace Delegation with Inheritance in the 1st edition).

## Example

Before:

```
class Room:
    thermostat: Thermostat

    fn target() -> float: return self.thermostat.target()
    fn set_target(c: float): self.thermostat.set_target(c)
    fn mode() -> str: return self.thermostat.mode()
    fn set_mode(m: str): self.thermostat.set_mode(m)

room.set_target(21.5)
```

After:

```
class Room:
    thermostat: Thermostat

room.thermostat.set_target(21.5)
```

Room added nothing to the thermostat's own interface, so callers talk to the thermostat.

## Related

[Message Chains](message-chains.md) · [Lazy Class](lazy-class.md) · [Proxy](proxy.md) · [Decorator](decorator.md) · [Facade](facade.md) · [Adapter](adapter.md)

## Overlaps

law-of-demeter is the principle, message-chains is how a break shows, and middle-man is what over-applying it produces. Read all three before recommending either direction.

## Sources

- [Refactoring.Guru, Middle Man](https://refactoring.guru/smells/middle-man) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
