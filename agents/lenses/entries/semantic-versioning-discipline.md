<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Semantic Versioning Discipline

`semantic-versioning-discipline` · practices, api · **contested**

Declare what your public API is, then let every release number say what changed in it, a major bump for a break, a minor for an addition or deprecation, a patch for a compatible fix, and actually hold to that.

*Names:* Also called SemVer. Tom Preston-Werner wrote the Semantic Versioning specification (semver.org), first published in 2009 or 2010; 2.0.0 is the current version.

*Matters most for:* library-sdk, cli-devtool, plugin-host, platforms, iac

## But

Semver only means something once the public API is declared, and Hyrum's law says users depend on more than you declare, so the number is a promise about intent, not a guarantee. Critics argue it gives false confidence (Rich Hickey's "Spec-ulation" talk argues for never breaking and renaming instead), and some projects use calendar versioning (CalVer) because their releases are time-based. Applications and internal services usually don't need it. Staying on 0.y.z is legitimate while the API is unsettled, but the spec treats it as "anything may change", which surprises users.

## Quality axes

- **change_cost** ⊕ (primary): Users can tell from the number which upgrades need work, so taking new releases is cheaper and less risky.
- **reliability** +: Automatic version ranges don't pull a break into users' builds without their choice.
- **delivery** −: The public API has to be declared, changes classified, and breaks held back for a major release or checked in CI.

**Flips:** For an application or service whose only consumer is its own deploy pipeline, it is ceremony. Agonising over whether every fix is breaking (Hyrum's law) freezes fixes.

## Warranted when

- Other people's code or pipelines depend on the package, and they pin by version range.
- Package managers resolve ranges like ^1.2 automatically, so a mislabelled release reaches users without their choice.
- Several surfaces (library API, CLI flags, config schema) evolve at different speeds and users need one signal.

## How it shows

- A CHANGELOG with sections per version and a breaking-changes heading on majors.
- Changesets, conventional commits or release-please tooling that derives the bump from changes.
- Its absence: a minor release that removes a function or changes output, or a project stuck on 0.x for years with users in production.
- Tooling that checks API compatibility in CI (cargo-semver-checks, api-extractor, japicmp, apidiff).

## Overdone when

- Bumping major for internal refactors no user can observe.
- Agonising over whether a bug fix that someone depends on is breaking, and freezing all fixes (Hyrum's law makes every change breaking to someone).
- Applying semver to an application or service whose only consumer is its own deploy pipeline.

## Example

None: About how releases are numbered against a declared API over time, not about the shape of code.

## By language

**rust:** Cargo treats 0.y as the major for compatibility (^0.3 does not take 0.4), and the Cargo book lists what counts as breaking. cargo-semver-checks catches many breaks.

**typescript:** Changes to exported types can break consumers even when runtime behaviour is unchanged, and the TypeScript compiler's own minor versions can break type-checking. Say which TypeScript versions you support. npm's ^ range follows the same 0.y rule as Cargo.

**python:** Python packaging uses PEP 440, which is compatible with but not identical to semver; many projects, including large ones, don't follow semver at all, so state your policy.

**go:** Modules require semver tags, and a major version 2 or above must change the module path (/v2). That makes breaks expensive and explicit.

**java:** Maven doesn't enforce semver; binary compatibility (japicmp, revapi) is a stricter test than source compatibility.

**csharp:** NuGet supports semver 2.0; assembly version and package version are separate, and strong-named assembly versions add their own binding rules.

## Related

[Breaking-Change Surface](breaking-change-surface.md) · [Deprecation Policy](deprecation-policy.md) · [Hyrum's Law](hyrums-law.md) · [Non-Exhaustive Types](non-exhaustive-types.md)

## Overlaps

hyrums-law explains why every observable behaviour is API. breaking-change-surface lists those surfaces, semantic-versioning-discipline says how to signal changes to them, and deprecation-policy how to retire them.

## Sources

- [Tom Preston-Werner, Semantic Versioning 2.0.0](https://semver.org/) (read)
- [The Cargo Book, SemVer Compatibility](https://doc.rust-lang.org/cargo/reference/semver.html) (recalled)
- [Rich Hickey, Spec-ulation (Clojure/conj 2016)](https://www.youtube.com/watch?v=oyLBGkS5ICk) (recalled)
