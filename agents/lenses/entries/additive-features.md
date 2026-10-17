<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Additive Features

`additive-features` · practices, api

A build-time feature or conditional-compilation flag should only add to a public API, never remove or change what is already there, because a dependency graph turns on the union of every flag that anyone in it asked for.

*Names:* The Cargo book states it under Features, "Feature unification" and "Features should be additive", and lists the SemVer consequences in its SemVer Compatibility chapter. The same problem shows up as #ifdef in C and C++ headers, build tags in Go, per-target-framework #if in C#, extras and optional imports in Python, and conditional exports in npm packages. No separate coiner; the Cargo book is where the rule is written down.

*Matters most for:* library-sdk, embedded, plugin-host, compilers-tooling

## But

Platform and target selection isn't unified across a graph, so cfg on the operating system or target framework may change the API by design; the rule is about flags that dependents can turn on. Some choices are exclusive by nature (which global allocator, which panic strategy, which TLS backend), and the Cargo book accepts rare exclusive features guarded by a compile error when the alternatives are worse. In an application or a binary that nothing depends on, flags aren't unified with anyone else's and the risk mostly goes away. In C and C++, macros that change a struct's layout are an ABI break between translation units, which is worse than an API break; there the rule is stricter, not looser.

## Quality axes

- **change_cost** ⊕ (primary): Adding or upgrading a dependency can't break a dependent's build by switching on a flag that removes or changes an API.
- **reliability** +: A library's behaviour doesn't silently change because some other package in the graph enabled a flag.
- **delivery** −: Public types have to keep one shape under every flag, and feature combinations must be tested in CI.

**Flips:** Refusing all conditional compilation makes every user pay for every optional dependency. For a binary nothing depends on, or for per-platform selection, flags aren't unified and the rule mostly doesn't apply.

## Warranted when

- The package is a library, so other packages in the same graph can switch its flags on behind its users' backs.
- A flag is meant to shrink the build (no allocator, no std, no network) and is easiest to write as a switch that removes things.
- A heavy dependency is optional, and the types that mention it end up behind the flag too.
- Two backends (TLS libraries, async runtimes, allocators) look like a choice between exclusive flags.

## How it shows

- A feature or macro named no_std, minimal, disable-x or legacy that turns something off.
- Struct fields or enum variants of a public type that exist only under a feature flag.
- The same public function with a different signature or return type depending on a flag.
- A pair of features documented as "do not enable together", or a compile_error! guarding them.
- Bug reports that a library broke only when some other crate or package in the graph enabled a feature.
- CI that builds only the default feature set, never all features or none.

## Overdone when

- Refusing all conditional compilation, so every user pays for every optional dependency.
- Treating per-platform code (target_os, GOOS) as if it had to be additive; a platform is chosen once for the whole build and isn't unified.
- Splitting a small library into many crates or packages just to avoid one exclusive choice.

## What to do

Name features by what they add (std, serde, tls-rustls), not by what they remove. Keep public types the same shape under every flag: put flag-dependent data behind private fields and methods, or mark the type non-exhaustive. Where two options really exclude each other, the Cargo book suggests splitting packages, picking one by priority when both are on, or making it a run-time option. Test the feature combinations in CI (cargo hack --feature-powerset, a build-tag matrix).

## Example

Before:

```
# compression library, feature "minimal" strips things out
class Options:              # public fields
    level: int
    if not feature("minimal"):
        dictionary: bytes

if not feature("minimal"):
    fn compress_with_dict(data, dict) -> bytes: ...

# one crate enables "minimal" for its small build;
# every other user of the library in the graph loses compress_with_dict
```

After:

```
# feature "dictionary" adds things, never removes them
class Options:
    level: int
    private dictionary: bytes or None

    if feature("dictionary"):
        fn with_dictionary(dict) -> Options: ...

if feature("dictionary"):
    fn compress_with_dict(data, dict) -> bytes: ...
```

The flag now only adds a function and a builder method, and the public shape of Options is the same under every combination, so whoever turns the flag on breaks nobody.

## One-file tell

Rust only. Flags #[cfg(not(feature = "..."))] on a pub item (not pub(crate)) that has no #[cfg(feature = "...")] item of the same name and signature in the same file. Also flags #[cfg(feature = "...")] on a field of a pub struct that is not #[non_exhaustive] and whose fields are all pub, and on a variant of a pub enum that is not #[non_exhaustive].

## By language

**rust:** Cargo builds one copy of a crate with the union of features requested anywhere in the graph. A cfg(feature) field on a struct with public fields, or a cfg(feature) variant on an exhaustive enum, breaks downstream struct literals or matches when someone else enables the feature. Removing a feature is a major change. So is moving existing items behind one, unless that feature is on by default. cargo-hack checks combinations.

**go:** Build tags apply to the whole program being built, so a tag set for the final binary changes every package that checks it. Files selected by tags should export the same names and signatures, as per-OS files (_linux.go, _windows.go) usually do.

**python:** Extras (pip install pkg[fast]) are unified in one environment: if any package asks for an extra, every user gets it. Code that changes results, not only speed, when an optional import succeeds has the same problem as a non-additive feature.

**typescript:** Conditional exports in package.json pick a file per environment (node, browser, custom conditions). Each condition's type declarations should export the same names, or consumers break when their bundler picks another condition.

**csharp:** A multi-targeted library compiles once per target framework with #if NET8_0_OR_GREATER and similar. Adding APIs on newer targets is fine; removing or changing one on a newer target breaks consumers when they move up.

**cpp:** An #ifdef in a public header that changes a class's members or layout is an ODR and ABI hazard: two translation units built with different macros disagree about the same type.

## Related

[Breaking-Change Surface](breaking-change-surface.md) · [Semantic Versioning Discipline](semantic-versioning-discipline.md) · [Non-Exhaustive Types](non-exhaustive-types.md) · [Hyrum's Law](hyrums-law.md)

## Sources

- [The Cargo Book, Features (Feature unification; Features should be additive; Mutually exclusive features; SemVer compatibility)](https://doc.rust-lang.org/cargo/reference/features.html) (read)
- [The Cargo Book, SemVer Compatibility (Cargo features)](https://doc.rust-lang.org/cargo/reference/semver.html) (recalled)
- [Go command documentation, Build constraints](https://pkg.go.dev/cmd/go#hdr-Build_constraints) (recalled)
