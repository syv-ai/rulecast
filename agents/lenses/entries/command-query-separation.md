<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Command-Query Separation (CQS)

`command-query-separation` · principles, design

Every method should either change state (a command) or return an answer (a query), not both. Then queries can be called freely, in any order and as often as you like, and changes happen only where a command is called.

*Names:* Coined by Bertrand Meyer in Object-Oriented Software Construction (1988) as part of Design by Contract. Fowler's bliki entry prefers the word modifier for command. CQRS (Greg Young) extends the idea to separate read and write models at architecture scale.

*Matters most for:* library-sdk, plugin-host

## But

Meyer's rule meets real exceptions. A stack pop that returns the item is clearer than top then remove, and Fowler keeps it. In concurrent code, operations that read and modify in one step (compare-and-swap, queue take, an insert that returns its generated key) must not be split, or the answer is stale by the time you act on it. Fluent interfaces deliberately return a value from modifiers. Internal caching that no caller can see doesn't break the principle, since it concerns observable state. Use it to make side effects visible, not as a law.

## Quality axes

- **change_cost** ⊕ (primary): Queries can be called, repeated and reordered freely, so code and tests are easier to read and restructure.
- **reliability** +: No hidden side effects, such as a health check that keeps idle sessions alive by calling a getter.

**Flips:** Splitting atomic read-and-write operations (pop, compare-and-set, an insert that returns its id) in concurrent code creates races, so reliability turns "-".

## Warranted when

- A query with a side effect surprised someone (a getter that lazily created a record, a check that extended a session).
- Code where it isn't clear which calls are safe to repeat or reorder.
- Tests that have to call a method twice to separate its effect from its answer.

## How it shows

- Methods named get, is, has or find that also write fields, files or the database.
- Methods that change state and return a status or the changed object, so callers sometimes ignore the change and sometimes depend on it.
- Bugs where adding a log line or a debugger watch that calls a getter changes behaviour.
- After the change, pairs such as current() and advance(), or is_valid() and touch().

## Overdone when

- Splitting atomic operations that must read and write together (pop, compare-and-set, get-and-increment, insert returning the new id), which creates races in concurrent code.
- Banning fluent or builder APIs whose methods change the receiver and return it.
- Treating caching or memoising inside a query as a violation, when no caller can observe it.

## Example

Before:

```
class Session:
    fn is_valid(now) -> bool:
        if now > self.expires: return false
        self.expires = now + 30 minutes      # also extends the session
        return true

# a health check that calls is_valid keeps idle sessions alive forever
```

After:

```
class Session:
    fn is_valid(now) -> bool:
        return now <= self.expires

    fn touch(now):
        self.expires = now + 30 minutes

if session.is_valid(now): session.touch(now)
```

Checking a session no longer extends it, so only code that means to keep the session alive does so.

## One-file tell

Python, TypeScript, Java and C#: a method or property getter whose name starts with get, is or has and whose body assigns to a field of self or this or calls a save, write or delete method. Lazy caching will match too, so it marks places to look rather than defects.

## By language

**python:** Properties should be queries; a property that writes state is a strong surprise. list.pop and dict.setdefault are standard-library exceptions people rely on.

**typescript:** Getters (get accessors) should be pure; array methods mix both styles (sort and reverse mutate and return, while toSorted and toReversed are the newer pure versions).

**java:** Iterator.next both advances and returns, the classic violation Fowler mentions; atomic classes' getAndIncrement and compareAndSet are justified ones.

**csharp:** Property getters should be side-effect free, and the framework design guidelines say so; TryParse and TryGetValue return a bool and write an out parameter, an accepted idiom.

**go:** Methods commonly return an error from commands, which isn't a query result and doesn't break the principle; sync/atomic and channel receives combine read and change on purpose.

**rust:** The borrow checker makes the split visible: &self methods are queries and &mut self methods are commands, though Vec::pop and Iterator::next take &mut self and return a value by design.

## Related

[Principle of Least Astonishment](principle-of-least-astonishment.md) · [Fluent Interface](fluent-interface.md) · [Tell, Don't Ask](tell-dont-ask.md) · [Functional Core, Imperative Shell](functional-core-imperative-shell.md) · [Immutability by Default](immutability-by-default.md)

## Sources

- [Bertrand Meyer, Object-Oriented Software Construction (1988; 2nd ed. 1997)](https://bertrandmeyer.com/OOSC2/) (recalled)
- [Martin Fowler, bliki, CommandQuerySeparation](https://martinfowler.com/bliki/CommandQuerySeparation.html) (read)
