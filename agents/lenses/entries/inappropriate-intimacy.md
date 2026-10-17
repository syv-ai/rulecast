<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Inappropriate Intimacy

`inappropriate-intimacy` · smells, design

Two classes reach into each other's private fields and methods, so neither can change without the other. Inappropriate Intimacy is the name most developers know, and Insider Trading is the current one.

*Names:* Fowler's 2nd edition renames it Insider Trading, so the two names are one smell.

*Matters most for:* library-sdk, plugins-extensions, plugin-host

## But

Some pairs are meant to be close: a class and its builder, an iterator and its collection, a test and the module under test, or nested types in one file. Languages give this explicit forms (friend, internal, package-private) for that reason. The smell is unplanned intimacy across a boundary that is supposed to hold.

## Quality axes

- **delivery** +: Reaching into a field is quicker than adding a method to the other class.
- **change_cost** −: Two classes that reach into each other's internals can't change independently.
- **reliability** −: Writing another object's private state skips the invariants that object maintains.

**Flips:** Pairs designed to be close (a class and its builder, an iterator and its collection, nested types) share internals deliberately through friend, internal or package-private access.

## Why people fall into it

- The two classes were designed together and their boundary was never made explicit.
- Reaching into a field is quicker than adding a method to the other class.
- Inheritance used for code sharing, giving the subclass a view of everything.

## How it shows

- Access to another object's underscore-prefixed or otherwise private members.
- Two classes holding references to each other and calling back and forth.
- A subclass relying on its parent's internal state rather than its interface.
- Friend declarations or package-private access used to share internals between unrelated classes.

## Overcorrecting looks like

- Hiding everything behind getters that expose the same internals by another name.
- Separating two classes that are really one concept and would be clearer merged.

## What to do

Move Method and Move Field to whichever side really uses them. Extract Class for the shared part and Hide Delegate to make the relationship explicit. Change Bidirectional Association to Unidirectional. When a subclass knows too much about its parent, Replace Inheritance with Delegation (Replace Superclass with Delegate or Replace Subclass with Delegate in the 2nd edition).

## Example

Before:

```
class Playlist:
    _tracks: list
    _total_seconds: int

class Track:
    fn add_to(playlist: Playlist):
        playlist._tracks.append(self)
        playlist._total_seconds = playlist._total_seconds + self.seconds
```

After:

```
class Playlist:
    _tracks: list
    _total_seconds: int

    fn add(track: Track):
        self._tracks.append(track)
        self._total_seconds = self._total_seconds + track.seconds

class Track:
    ...
```

The playlist keeps its own running total; the track no longer knows how the playlist stores it.

## One-file tell

Access to an underscore-prefixed attribute on an object of a different class than the enclosing one (Python, JavaScript, TypeScript), excluding cls, the other operand in comparison or copy methods, and namedtuple's documented _replace, _asdict and _fields.

## By language

**python:** Privacy is only a naming convention, so reaching for another object's underscore names is the visible sign.

## Related

[Feature Envy](feature-envy.md) · [Message Chains](message-chains.md) · [Law of Demeter](law-of-demeter.md)

## Sources

- [Refactoring.Guru, Inappropriate Intimacy](https://refactoring.guru/smells/inappropriate-intimacy) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3, Insider Trading](https://martinfowler.com/books/refactoring.html) (recalled)
