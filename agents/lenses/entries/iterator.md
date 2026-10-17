<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Iterator

`iterator` · design patterns, behavioral

Walk the elements of a collection without exposing how it stores them, with each walk keeping its own position; also called Cursor.

*Matters most for:* databases-storage, data-pipeline, library-sdk

## But

Every mainstream language now builds iteration in, so writing the pattern by hand is rarely needed; reach for the language's protocol or a generator. For simple collections it is pure overhead, and for some specialised structures direct indexed access is faster. Iterators that hold position over a collection that is being modified are a classic source of bugs.

## Quality axes

- **change_cost** ⊕ (primary): Callers loop without knowing how the structure stores or pages its data, so the storage can change freely.
- **runtime** +: Items are produced lazily, so big or paged data needn't be loaded at once.
- **reliability** −: An iterator holding a position over a collection that is modified during the walk is a classic source of bugs.

**Flips:** A hand-written iterator over a list the language already iterates is pure overhead, and some structures are faster with direct indexed access.

## Warranted when

- A custom structure (tree, graph, paged API, file of records) needs looping over and callers are reaching into its internals to do it
- The same structure needs more than one traversal order
- The same traversal code is repeated in several places
- Data is too big or too slow to load at once and should be produced lazily

## How it shows

- Classes with next / has_next methods or language iteration hooks over a custom data structure
- Traversal code (depth-first, breadth-first) moved out of the collection into its own type or function
- Client code that loops over a collection without touching its internals

## Overdone when

- A hand-written iterator class over a plain list or dict the language already iterates
- Iterator interfaces and factories for collections that only ever have one traversal
- Wrapping a built-in collection just to give it an iterator it already had

## Example

Before:

```
# every caller walks the audit API's paging by hand
page = audit_client.fetch(cursor=null)
while true:
    for raw in page.body["entries"]:
        check(AuditEntry.parse(raw))
    if page.body["next_cursor"] == null: break
    page = audit_client.fetch(cursor=page.body["next_cursor"])
# the export job and the alerting job each have their own copy of this loop
```

After:

```
class AuditLog:
    fn entries(since: Date) -> Iterator:    # of AuditEntry
        cursor = null
        loop:
            page = self.client.fetch(cursor=cursor, since=since)
            for raw in page.body["entries"]:
                yield AuditEntry.parse(raw)    # one page in memory at a time
            cursor = page.body["next_cursor"]
            if cursor == null: return

for entry in audit_log.entries(since=yesterday):
    check(entry)
```

Paging and cursors move behind one lazy traversal, so callers loop over entries without knowing the API pages them; a generator is the language's own form of the pattern.

## One-file tell

In Python, a class defining both __iter__ and __next__ that just steps an index over an internal list; a generator function would replace it.

## By language

**python:** Built into the language: __iter__ and __next__, and generators make most custom iterator classes unnecessary. Write a generator function (yield) for a custom traversal and itertools for combinations. A separate iterator class is rarely warranted. The source notes Python developers meet it constantly through the iteration protocol in libraries.

**typescript:** Common, and built into the language through the iteration protocol (`Symbol.iterator`, `Iterable<T>`). Generator functions (`function*`) are the idiomatic way to write one, and `for...of`, spread and destructuring consume it. Async iterators cover streams. Hand-written iterator classes with `hasNext` methods are rarely needed. Spotting it: Navigation methods such as `next` or `current`, an implementation of `[Symbol.iterator]`, or a generator function; callers never touch the underlying collection.

**java:** Built in and ubiquitous: Iterable/Iterator power the enhanced for loop, and Enumeration is its legacy predecessor. Writing a custom iterator is rarely needed; implement Iterable, or expose a Stream, or a Spliterator for parallel-friendly traversal. Modifying a collection while iterating it (except through Iterator.remove) throws ConcurrentModificationException. Spotting it: A class implementing Iterator with hasNext/next, often as an inner class returned from an iterator() method of an Iterable.

**csharp:** Built into the language. IEnumerable<T> and IEnumerator<T> are the iterator interfaces, foreach consumes them, and `yield return` lets the compiler generate the iterator, so hand-written iterator classes are rarely needed. IAsyncEnumerable<T> with await foreach covers async streams, and LINQ composes iterators lazily. Spotting it: Methods returning IEnumerable<T> or IAsyncEnumerable<T> with yield return in the body, or classes implementing IEnumerator<T> with MoveNext and Current.

**go:** For years, Go's iterator was a for-range over slices, maps and channels, plus cursor-style types that advance with a bool-returning method and expose the current item and an Err method (bufio.Scanner's Scan/Text/Err, sql.Rows' Next/Scan/Err). Since Go 1.23, range-over-func with iter.Seq and iter.Seq2 is the standard form, and a hand-written iterator with hasNext and getNext looks dated. Iterating over a channel costs a goroutine and needs care to avoid leaks. Spotting it: Functions returning iter.Seq or iter.Seq2, or a type with a Next() or Scan() bool method plus an accessor and an Err method.

**rust:** Part of the language: implement `std::iter::Iterator` (one `next` returning `Option<Item>`) to get every adapter for free, and implement `IntoIterator` so the collection works in `for` loops. Never define your own iterator interface. Borrowing iterators carry a lifetime tying them to the collection. Usually you don't even write a struct, because you return `impl Iterator<Item = ..>` built from existing adapters or `std::iter::from_fn`. Spotting it: `impl Iterator for X` with `type Item`, `iter()`/`iter_mut()`/`into_iter()` methods, or functions returning `impl Iterator`.

**cpp:** Built into the language and the standard library: every container exposes iterators, algorithms are written against iterator categories, and range-for works on anything with begin and end. A custom collection should provide standard-conforming iterators (or satisfy C++20 range concepts) rather than its own next/hasNext interface. Iterator invalidation after container mutation is the main hazard. Spotting it: A type with operator++, operator* and comparison operators, or a class exposing begin() and end(); or, non-idiomatically, next and has-next methods.

## Related

[Composite](composite.md) · [Visitor](visitor.md) · [Factory Method](factory-method.md) · [Memento](memento.md)

## Sources

- [Refactoring.Guru, Design Patterns: Iterator](https://refactoring.guru/design-patterns/iterator) (read)
- [Refactoring.Guru, Iterator in Python](https://refactoring.guru/design-patterns/iterator/python/example) (read)
- [Peter Norvig, Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/) (recalled)
- [Refactoring.Guru, Iterator in TypeScript](https://refactoring.guru/design-patterns/iterator/typescript/example) (read)
- Established TypeScript practice (iteration protocol, generators) (recalled)
- [Refactoring.Guru, Iterator in Java](https://refactoring.guru/design-patterns/iterator/java/example) (read)
- java.util.Spliterator and Stream API (recalled)
- [Refactoring.Guru, Iterator in C#](https://refactoring.guru/design-patterns/iterator/csharp/example) (read)
- C# iterators (yield), IEnumerable<T>, IAsyncEnumerable<T> (recalled)
- [Refactoring.Guru, Iterator in Go](https://refactoring.guru/design-patterns/iterator/go/example) (read)
- [Go standard library, iter](https://pkg.go.dev/iter) (recalled)
- [Refactoring.Guru, Iterator in Rust](https://refactoring.guru/design-patterns/iterator/rust/example) (read)
- [Rust API Guidelines on iterator methods (C-ITER)](https://rust-lang.github.io/api-guidelines/naming.html) (recalled)
- [Refactoring.Guru, Iterator in C++](https://refactoring.guru/design-patterns/iterator/cpp/example) (read)
- [Iterator library and C++20 iterator concepts, cppreference](https://en.cppreference.com/w/cpp/iterator) (recalled)
