<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Golden Master Test (approval, snapshot or golden-file test)

`golden-master-test` · design patterns, testing

Capture the whole output of the code once, have a person check and approve it, store it, and fail the test whenever later output differs. It is the right tool when the output itself is the contract, as with renderers, formatters, compilers, CLI text and serialisers.

*Names:* Michael Feathers described characterization tests in Working Effectively with Legacy Code (2004), the legacy-code use of the idea. Llewellyn Falco named and built Approval Tests. Jest popularised the name snapshot testing in 2016. Go and compiler projects say golden files.

*Matters most for:* compilers-tooling, cli-devtool, tui, library-sdk

## But

A golden test says what the output is, not why, so a reviewer can't tell from the test which parts matter. The main risk is approval without reading: when updating is one command, people run it to make the build green, and the test then pins whatever the code does, bugs included. Keep the update a reviewed step, keep outputs small and deterministic, and pair goldens with a few targeted asserts for the rules that matter most. Where the output is not the contract, as with an internal object's repr or a component tree under heavy development, snapshots become the Fragile Test smell. Justin Searls has argued that snapshot tests mostly get updated without being read, and Kent C. Dodds that snapshots beyond a few dozen lines become a maintenance burden and should be small and focused.

## Quality axes

- **change_cost** ⊕ (primary): Any change to output that users consume shows up as a reviewed diff, so refactoring renderers, compilers or legacy code is safer.
- **delivery** +: One capture-and-compare call covers a whole output instead of many hand-written asserts.
- **reliability** −: Updating is one command, so snapshots get approved without reading and pin bugs as the expected output.

**Flips:** Where the output is not the contract, or carries timestamps and random ids, snapshots break on every refactor and get updated blindly, turning change_cost "-".

## Warranted when

- The output is large and structured (text, markup, ASTs, reports), and asserting on pieces of it misses regressions in the rest.
- The output is what users or other programs consume, so any change to it is a change to the contract.
- Legacy code with unknown behaviour that must be pinned before refactoring.
- Many hand-written asserts on substrings that keep being added after each bug.

## How it shows

- A testdata, __snapshots__, goldens or approved directory of expected outputs next to the tests.
- Tests that render or serialise something and compare the whole result with one call.
- An update flag or command (-update, --snapshot-update, UPDATE_GOLDENS=1, cargo insta review).
- Diffs to stored outputs appearing in the same commits as behaviour changes.

## Overdone when

- Snapshotting objects whose exact output nobody cares about, so every refactor rewrites dozens of snapshots and they get updated without reading.
- Snapshots with timestamps, random ids or ordering noise, which make them fail for no reason or force scrubbing logic.
- Huge snapshots where a reviewer can't see what the diff means.
- Using a snapshot where one plain assertion states the intent better.

## Example

Before:

```
test "receipt text":
    out = render_receipt(sample_order)
    assert "Total: 42.00" in out
    assert "Coffee x2" in out
    assert "VAT" in out
    # the layout, alignment and every other line can regress unnoticed
```

After:

```
test "receipt text":
    out = render_receipt(sample_order)
    expected = read_file("goldens/receipt_basic.txt")
    if env("UPDATE_GOLDENS"):
        write_file("goldens/receipt_basic.txt", out)
    assert out == expected
    # changes show up as a diff to receipt_basic.txt in review
```

The receipt's text is what customers see, so the whole of it is pinned and every change to it is a reviewed diff.

## By language

**python:** syrupy and pytest-snapshot for pytest, and approvaltests for Python. A hand-rolled golden file with an environment variable to rewrite it is also common.

**typescript:** toMatchSnapshot and toMatchInlineSnapshot in Jest and Vitest; inline snapshots keep the expected value in the test, which reviews better for small outputs. Update with -u.

**java:** ApprovalTests.Java and Selfie; otherwise files under src/test/resources compared by hand.

**csharp:** Verify (by Simon Cropp) is the common choice, with scrubbers for dates and guids; ApprovalTests.Net is the older option.

**go:** Golden files under testdata/ with an -update flag defined in the test is the house style, used across the Go toolchain itself; libraries such as goldie wrap it.

**rust:** insta, with cargo insta review for approving changes interactively; expect-test for inline expectations, used by rust-analyzer.

## Related

[Fragile Test](fragile-test.md) · [Obscure Test](obscure-test.md) · [Erratic Test](erratic-test.md) · [Property-Based Test](property-based-test.md)

## Overlaps

golden-master-test is right when the output is the contract. fragile-test is what snapshots of incidental output turn into.

## In the interview

- [Find the parts nobody touches and the parts only one person understands, and ask which is which.](../THINKING.md#frozen-code-gets-its-own-rule)

## Sources

- [Michael Feathers, Working Effectively with Legacy Code (2004), characterization tests](https://www.oreilly.com/library/view/working-effectively-with/0131177052/) (recalled)
- [Approval Tests](https://approvaltests.com/) (read)
- [Jest documentation, Snapshot Testing](https://jestjs.io/docs/snapshot-testing) (recalled)
- [Kent C. Dodds, Effective Snapshot Testing](https://kentcdodds.com/blog/effective-snapshot-testing) (recalled)
