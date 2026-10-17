<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Law of Demeter

`law-of-demeter` · principles, design · **contested**

A unit should only talk to its direct collaborators, not reach through them to their internals; also called the principle of least knowledge or "don't talk to strangers".

*Matters most for:* fullstack-web

## But

Applied mechanically it bloats classes with pass-through wrapper methods, the "middle man" smell. Counting dots is a poor test: fluent builders, query chains and plain data structures chain calls without coupling to anyone's internals. Martin Fowler has said he'd prefer it be called "the Occasionally Useful Suggestion of Demeter". It targets objects with behaviour, not records or DTOs.

## Quality axes

- **change_cost** ⊕ (primary): Callers don't walk the object graph, so restructuring an intermediate class doesn't break them.

**Flips:** Applied mechanically by counting dots, it bloats classes with pass-through methods (Middle Man), turning change_cost "-". It doesn't apply to fluent builders, query chains or plain data records.

## How it shows

- call chains that walk an object graph, such as order.customer.address.zip
- callers that break when an intermediate class changes its fields

## What to do

Tell, don't ask; give the nearby object a method that does the work or returns what the caller needs.

## Example

Before:

```
fn checkout_amount(appt: Appointment) -> Money:
    plan = appt.patient.insurance.plan
    if plan.copays.has(appt.visit_type):
        return plan.copays.get(appt.visit_type)
    return appt.list_price
```

After:

```
class Patient:
    fn copay_for(visit_type: VisitType) -> Money | None:
        return self.insurance.copay_for(visit_type)

fn checkout_amount(appt: Appointment) -> Money:
    copay = appt.patient.copay_for(appt.visit_type)
    if copay is not None:
        return copay
    return appt.list_price
```

Billing asks the patient for the copay instead of walking through insurance and plan internals, so a change to how plans store copays stays inside insurance.

## Related

[The Law of Leaky Abstractions](law-of-leaky-abstractions.md)

## Overlaps

law-of-demeter is the principle, message-chains is how a break shows, and middle-man is what over-applying it produces. Read all three before recommending either direction.

## Sources

- [Milanović, Laws of Software Engineering, Law of Demeter](https://lawsofsoftwareengineering.com/laws/law-of-demeter/) (read)
