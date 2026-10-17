<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Parallel Inheritance Hierarchies

`parallel-inheritance-hierarchies` · smells, design

Every time you add a subclass in one hierarchy you have to add a matching subclass in another.

*Names:* It is a special case of Shotgun Surgery, and Fowler dropped it from the 2nd edition's list.

*Matters most for:* compilers-tooling, desktop

## But

Sometimes the parallel tree is the price of keeping a concern out of the model, and merging would be worse. The page itself says to revert if merging makes the code messier. Visitor and Bridge accept a related kind of pairing on purpose. In languages with sum types and pattern matching, one function per concern that matches on the variants often removes the second tree without merging concerns.

## Quality axes

- **change_cost** −: Every new subclass needs a matching twin in another tree, so adding a case means edits in two places, and the twin is easy to forget.

**Flips:** The second tree can be the price of keeping a concern (UI, persistence) out of the domain model, and merging them would be worse.

## Why people fall into it

- Separating concerns (validation, rendering, persistence) into their own classes, each mirroring the model.
- Frameworks that expect one handler, serializer or view per model class.
- It works while each tree has two or three members.

## How it shows

- Two class trees whose subclass names share prefixes (AutoClaim and AutoClaimValidator, HomeClaim and HomeClaimValidator).
- Commits that add one subclass to each of two hierarchies together.
- A factory or map pairing each class in one tree with its twin in the other.

## Overcorrecting looks like

- Folding presentation or persistence concerns into domain classes to remove the twin tree, which reintroduces Divergent Change.
- Merging when the mirrored structure isolates a dependency (a UI toolkit, a database) that the domain shouldn't know.

## What to do

Make instances of one hierarchy refer to instances of the other, then Move Method and Move Field until the second hierarchy is empty and can be removed.

## Example

Before:

```
class Claim: ...
class AutoClaim extends Claim: ...
class HomeClaim extends Claim: ...

class ClaimValidator: fn validate(claim): ...
class AutoClaimValidator extends ClaimValidator: fn validate(claim): ... checks vin
class HomeClaimValidator extends ClaimValidator: fn validate(claim): ... checks address

# adding TravelClaim means adding TravelClaimValidator too
```

After:

```
class Claim:
    fn validate(): ...

class AutoClaim extends Claim:
    fn validate(): ... checks vin

class HomeClaim extends Claim:
    fn validate(): ... checks address
```

Validation moved onto the claim types, so a new claim type is one class, not two.

## Related

[Shotgun Surgery](shotgun-surgery.md) · [Divergent Change](divergent-change.md) · [Visitor](visitor.md) · [Bridge](bridge.md)

## Sources

- [Refactoring.Guru, Parallel Inheritance Hierarchies](https://refactoring.guru/smells/parallel-inheritance-hierarchies) (read)
- [Martin Fowler, Refactoring (1st ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
