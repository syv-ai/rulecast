<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Comments

`comments` · smells, code · **contested** · **agents do this**

A method needs comments to explain what its code does, which usually means the code itself could be clearer. Fowler calls such comments a deodorant.

*Names:* His 2nd edition also adds Mysterious Name, the closely related smell where a name fails to say what a thing does.

## But

Only what-comments are the smell. Comments that explain why, record a trade-off, cite a bug or spec, or document a hard algorithm are valuable. John Ousterhout (A Philosophy of Software Design) argues the "good code is self-documenting" line is overstated and that interface comments carry abstractions names can't. Public library APIs need documentation regardless.

## Quality axes

- **delivery** +: Under a deadline, annotating hard code is quicker than extracting and renaming it.
- **change_cost** −: Comments that restate what the code does cover for unclear code and drift out of date, so readers must still decode the code and may be misled.

## Why people fall into it

- The code was hard to write, so the author explains it instead of reshaping it.
- Reviews or style guides that reward "well-commented" code by volume.
- A deadline that leaves time to annotate but not to extract and rename.

## How it shows

- Comments that restate the next line or block in English.
- Section-header comments inside one long function (step 1, validate, now save).
- A comment explaining what a variable or expression means, where a better name would say it.
- Comments describing a precondition the code never checks.

## Overcorrecting looks like

- Stripping comments that explain why, such as a workaround for a vendor bug, a performance trade-off or a rejected simpler approach.
- Extracting one-line methods purely to avoid writing a single helpful comment.
- Treating docstrings on a public API as a smell.

## What to do

Extract Variable for a hard expression, Extract Method for a commented block (name it after the comment), Rename Method when the name is the problem, and Introduce Assertion for a rule the code relies on.

## Example

Before:

```
fn adjust(reading: float, sensor) -> float:
    # subtract the factory offset
    r = reading - sensor.cfg[0]
    # scale by gain, which is stored as percent
    r = r * (sensor.cfg[1] / 100)
    # clamp to the sensor's physical range
    if r < -40: r = -40
    if r > 125: r = 125
    return r
```

After:

```
fn adjust(reading: float, sensor) -> float:
    corrected = reading - sensor.factory_offset
    scaled = corrected * sensor.gain_fraction()
    return clamp_to_range(scaled, sensor.min_celsius, sensor.max_celsius)
```

Each comment became a name, so the comments have nothing left to say.

## Related

[Long Method](long-method.md) · [KISS (Keep It Simple, Stupid)](kiss.md)

## Sources

- [Refactoring.Guru, Comments](https://refactoring.guru/smells/comments) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
- [John Ousterhout, A Philosophy of Software Design, ch. 12-13](https://web.stanford.edu/~ouster/cgi-bin/book.php) (recalled)
