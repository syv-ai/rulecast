<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Property-Based Test

`property-based-test` · practices, testing

Instead of a few hand-picked examples, state a rule that must hold for every input (the output is sorted, decoding undoes encoding, the parts add up to the total), let a library generate many inputs, and when one fails, let it shrink that input to the smallest case that still fails.

*Names:* Introduced by Koen Claessen and John Hughes with QuickCheck for Haskell (2000). Also called generative testing. Closely related to fuzzing, which leans on coverage guidance and crashes rather than stated properties.

*Matters most for:* compilers-tooling, library-sdk, databases-storage, scientific, data-pipeline

## But

Good properties are hard to find for code that is mostly glue, I/O or business rules with many special cases; examples are clearer there and act as documentation. A failing property with a random seed can also be hard to reproduce unless the library records it. Most practitioners, Hughes included, mix the two: examples for the cases that explain the code, properties for the rules. Generated input is only as good as its generators, so a property can pass on millions of cases that all avoid the bug.

## Quality axes

- **reliability** ⊕ (primary): Generated and shrunk inputs find edge cases (empty, unicode, overflow, duplicates) nobody would write as examples.
- **delivery** −: Finding good properties and writing generators takes more thought than writing examples.

**Flips:** For glue, I/O or business rules full of special cases, properties are weak or restate the implementation, and examples are clearer. High iteration counts on every commit slow the suite.

## Warranted when

- Pure functions with a large input space, such as parsers, serialisers, encoders, numeric code, data structures.
- A rule that is easy to state but has many edge cases (empty, unicode, overflow, duplicates).
- Pairs of operations that should undo each other, or a simple reference implementation to compare against.
- Bugs keep turning up for inputs nobody thought to write as examples.

## How it shows

- Tests that take generated arguments (given, forAll, proptest!, fc.assert) rather than literals.
- Round-trip tests (parse after print, decode after encode) over generated values.
- A test comparing a fast implementation against a slow obvious one on random input (a test oracle).
- Stored regression seeds or failing-example databases next to the tests.

## Overdone when

- Properties that restate the implementation, so they pass by construction.
- Properties so weak (no exception thrown, output not empty) they catch little, used instead of examples.
- Generators so complex they need their own tests, for code with a small input space.
- Slow suites from high iteration counts run on every commit.

## Example

Before:

```
test "split 100 three ways":
    assert split_cents(100, 3) == [34, 33, 33]
test "split 10 two ways":
    assert split_cents(10, 2) == [5, 5]
# nothing checks 0, 1 cent, negative refunds or 7-way splits
```

After:

```
property "split keeps every cent":
    for_all total in ints(-10000, 10000), ways in ints(1, 50):
        parts = split_cents(total, ways)
        assert len(parts) == ways
        assert sum(parts) == total
        assert max(parts) - min(parts) <= 1
# a failure shrinks to the smallest total and ways that break it
```

Three rules replace two examples and cover inputs no one would think to write down, such as negative totals.

## By language

**python:** Hypothesis is the standard, with strong shrinking and a local database of failing examples; it plugs into pytest, and its stateful testing drives sequences of operations.

**typescript:** fast-check is the main library and works with Jest and Vitest.

**java:** jqwik for JUnit 5; junit-quickcheck is older.

**csharp:** FsCheck (usable from C#) and CsCheck.

**go:** Native fuzzing (go test -fuzz, since Go 1.18) covers much of the same ground with coverage guidance; rapid and gopter give QuickCheck-style properties. testing/quick is frozen.

**rust:** proptest is the common choice with good shrinking; quickcheck is the older port. cargo-fuzz and bolero cover fuzzing.

## Related

[Golden Master Test (approval, snapshot or golden-file test)](golden-master-test.md) · [Test Data Builder](test-data-builder.md) · [Parse, Don't Validate](parse-dont-validate.md)

## Sources

- [Koen Claessen and John Hughes, QuickCheck, a Lightweight Tool for Random Testing of Haskell Programs (ICFP 2000)](https://dl.acm.org/doi/10.1145/351240.351266) (recalled)
- [Hypothesis documentation](https://hypothesis.readthedocs.io/en/latest/) (read)
- [John Hughes, How to Specify It! (2019)](https://research.chalmers.se/en/publication/517894) (recalled)
