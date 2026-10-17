<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Shotgun Surgery

`shotgun-surgery` · smells, design · **agents do this**

One change forces many small edits across many classes or files, because one responsibility is spread across them. It is the mirror image of Divergent Change, and it is easy to miss on a file-by-file read since it only shows across files and history.

*Matters most for:* web-api, fullstack-web, platforms, distributed

## But

Some spread is inherent. A new field that crosses storage, API and UI touches each layer by nature, so only flag it when a different decomposition would really reduce the edits, and name that decomposition. Cross-cutting concerns (logging, auth, metrics) are better handled by middleware or wrappers than by gathering them in one class. Separate teams may own separate modules on purpose (Conway's law), and some duplication between them is the cost of independence. The cure for this smell and the cure for Divergent Change pull in opposite directions; aim for one place per kind of change, not the fewest or the smallest classes.

## Quality axes

- **change_cost** −: One small change means many edits across files, and finding all of them.
- **reliability** −: When one copy of a scattered rule is missed, the system behaves inconsistently.

**Flips:** Spread that is inherent, such as a field that crosses storage, API and UI, or modules separate teams own on purpose, is the right cost.

## Why people fall into it

- A rule was copied into each place that needed it instead of given one home.
- The code is organised by technical layer (controller, service, repository, view), so every feature cuts through all of them.
- Over-splitting to cure Divergent Change or to follow the single-responsibility principle too literally, so one concern ended up in many tiny classes.
- Each edit was made by someone who saw only the file in front of them.

## How it shows

- Commits for one small feature that touch many files with a few lines in each.
- Files in different packages that keep changing together in git history (change coupling).
- The same rule, constant, string or mapping repeated in several modules (a rate, a status list, a field name).
- A checklist in docs or a PR template saying "when you add X, also update A, B, C and D".
- Bugs where one copy of a rule was updated and another wasn't.
- Adding a new case means editing a switch or map in several layers.

## Overcorrecting looks like

- Pulling everything a change touches into one class, which creates a Large Class with Divergent Change.
- Centralising things that only look alike and change for different reasons, which couples them.
- Trying to remove inherent amplification, such as a new field that must go from the database through the API to the UI, which touches each layer however the code is organised.

## What to do

Pick, or create, the class that should own the responsibility, and pull the scattered pieces into it with Move Method and Move Field. Any class left nearly empty goes with Inline Class. At module scale, group code by feature or by the kind of change rather than by technical layer, and give each repeated rule or mapping one source of truth (one table, one enum, one function).

## Example

Before:

```
# order_view.py
fn status_label(order) -> str:
    if order.status == "held": return "On hold"
    if order.status == "paid": return "Paid"
    ...
# fulfilment.py
fn can_ship(order) -> bool:
    return order.status == "paid" or order.status == "packed"
# export.py
fn status_code(order) -> str:
    return EXPORT_CODES[order.status]     # {"held": "H", "paid": "P", ...}

# adding a "backordered" status edits all three files; miss one and it fails quietly
```

After:

```
# order_status.py
class OrderStatus:
    name: str
    label: str
    export_code: str
    shippable: bool

HELD = OrderStatus("held", "On hold", "H", False)
PAID = OrderStatus("paid", "Paid", "P", True)
...

# order_view.py, fulfilment.py, export.py
return order.status.label
return order.status.shippable
return order.status.export_code
```

Everything a status means now lives in one place, so a new status is one edit, not three that can drift apart.

## Related

[Divergent Change](divergent-change.md) · [Duplicate Code](duplicate-code.md) · [Parallel Inheritance Hierarchies](parallel-inheritance-hierarchies.md) · [DRY (Don't Repeat Yourself)](dry.md) · [SOLID](solid.md) · [Switch Statements](switch-statements.md)

## Overlaps

single-responsibility-principle is the principle: one reason to change per module. divergent-change is the smell when it is broken one way (one module changes for many reasons), shotgun-surgery when it is broken the other way (one reason to change touches many modules). Use the smells to find it in code.

## In the interview

- [Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change.](../THINKING.md#ownership-before-boundaries)
- [Spend the interview where the work is.](../THINKING.md#find-where-changes-concentrate)

## Sources

- [Refactoring.Guru, Shotgun Surgery](https://refactoring.guru/smells/shotgun-surgery) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
- [Adam Tornhill, Your Code as a Crime Scene, change coupling](https://pragprog.com/titles/atcrime2/your-code-as-a-crime-scene-second-edition/) (recalled)
