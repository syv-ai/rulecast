<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Data Clumps

`data-clumps` · smells, code

The same few values travel together through fields and parameter lists in several places, which says they are one concept that has no name yet.

*Matters most for:* scientific, games

## But

Fowler's test is to delete one value: if the rest still make sense on their own, it isn't a clump. Passing a whole object instead of its parts can couple a low-level function to a high-level type, so at module boundaries plain values are sometimes the better choice.

## Quality axes

- **delivery** +: Adding one more parameter is always the smallest change.
- **change_cost** −: Adding or changing a member of the group means editing every signature and field list it travels through.
- **reliability** −: The group's rules (start before end, all set or none) are re-checked at each site, and the site that forgets them lets bad combinations through.

**Flips:** At module boundaries plain values can beat a shared object that would couple a low-level function to a high-level type.

## Why people fall into it

- Adding one more parameter is the smallest change each time.
- Copy-paste of a function signature into a new function.
- Fear that a new small class is over-engineering.

## How it shows

- Three or more parameters with the same names appearing together in several signatures.
- The same group of fields repeated across classes.
- Validation of the group (start before end, all set or none set) copied at each site.

## Overcorrecting looks like

- Bundling values that merely happen to sit side by side and have no shared meaning or rules.
- Passing a whole object to a function that needs one of its fields, which creates a dependency it didn't have.

## What to do

Extract Class for repeated fields, Introduce Parameter Object for repeated parameters, and Preserve Whole Object where a caller unpacks an object only to pass its parts. Then move the logic that works on the group into the new class.

## Example

Before:

```
fn tiles_in(min_lat: float, min_lon: float, max_lat: float, max_lon: float, zoom: int): ...

fn label_density(min_lat: float, min_lon: float, max_lat: float, max_lon: float): ...

fn is_visible(poi, min_lat, min_lon, max_lat, max_lon) -> bool:
    return min_lat <= poi.lat <= max_lat and min_lon <= poi.lon <= max_lon
```

After:

```
class BoundingBox:
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float

    fn contains(lat: float, lon: float) -> bool:
        return self.min_lat <= lat <= self.max_lat and self.min_lon <= lon <= self.max_lon

fn tiles_in(box: BoundingBox, zoom: int): ...
fn label_density(box: BoundingBox): ...
fn is_visible(poi, box: BoundingBox) -> bool:
    return box.contains(poi.lat, poi.lon)
```

The four coordinates were always one thing; naming it gave the containment check a home.

## One-file tell

The same three or more parameter names appear together in the signatures of several functions in one file.

## Related

[Long Parameter List](long-parameter-list.md) · [Primitive Obsession](primitive-obsession.md)

## Sources

- [Refactoring.Guru, Data Clumps](https://refactoring.guru/smells/data-clumps) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
