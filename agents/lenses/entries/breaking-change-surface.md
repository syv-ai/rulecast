<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Breaking-Change Surface

`breaking-change-surface` · practices, api

Know every surface outsiders depend on, not just function signatures but CLI flags and output, exit codes, error messages, config schema, file formats, wire formats and defaults, and treat changes to any of them as API changes.

*Names:* Also called Compatibility surface, Public surface area. A descriptive name for a long-held idea. Google's AIP-180 splits compatibility into source, wire and semantic, and the Cargo book's SemVer Compatibility chapter lists breaking changes by kind. Hyrum Wright's observation (Hyrum's law) is why the surface is larger than the declared one.

*Matters most for:* library-sdk, cli-devtool, plugin-host, web-api, platforms, iac

## But

You can't freeze everything, and trying to makes the system unchangeable; decide which surfaces are promised and say clearly that the others aren't (human-readable output and log text usually aren't). Some projects break unpromised behaviour on purpose to keep users off it, like Go randomizing map order. For code with only internal callers you can change both sides at once, and this principle mostly doesn't apply.

## Quality axes

- **change_cost** ⊕ (primary): Knowing which surfaces are promised and hiding the rest leaves everything else free to change, with promised surfaces checked in CI.
- **reliability** +: Scripts, agents and integrations that read CLI output, config or wire formats aren't broken by a "small fix".
- **delivery** −: Separate wire types, a stable machine-readable output mode, version fields and compatibility tests have to be built.

**Flips:** Treating every log line and human-readable message as frozen makes the system unchangeable, so change_cost turns "-". For code with only internal callers it mostly doesn't apply.

## Warranted when

- The code is used by people outside the team, through a package, a CLI, a plugin interface or a network API.
- Agents and scripts consume CLI and API output as text.
- The language exports by default (Python's no-underscore names, Go's capitalized names, JavaScript files reachable by deep import).
- Internal and external representations share one type to save code.

## How it shows

- A CLI whose output is parsed by scripts, with no machine-readable mode and no stability promise for the human mode.
- A config file format with no schema or version field.
- Serialized types (JSON, protobuf, database rows) that are the same structs used internally, so a rename changes the wire format.
- Error messages that tests or callers match on.
- Exported symbols that were only exported for a test or for another internal package.
- Changelogs where "small fixes" broke downstream users.

## Overdone when

- Treating every log line and every human-readable message as frozen, so nothing can be improved.
- Versioning internal interfaces that have one caller in the same repository.

## What to do

Write down the surfaces you promise, and hide the rest: narrow exports (package exports maps, __all__ and underscores, internal packages, pub(crate)), a machine-readable output mode with a stable schema separate from human output, a version field in config and data formats, and separate wire types from internal types. Check the promised surfaces in CI with snapshot or compatibility tests.

## Example

Before:

```
class Finding:          # used internally and printed as-is
    file: str
    line: int
    rule: str

fn report(findings, as_json: bool):
    if as_json:
        print(to_json(findings))   # renaming Finding.rule silently changes the output
    else:
        for f in findings: print(f.file + ":" + str(f.line) + " " + f.rule)
```

After:

```
# report schema v1: promised to scripts; human output is not
fn to_report_v1(f: Finding) -> dict:
    return {"path": f.file, "line": f.line, "rule_id": f.rule}

fn report(findings, as_json: bool):
    if as_json:
        print(to_json({"version": 1, "findings": map(to_report_v1, findings)}))
    else:
        for f in findings: print(f.file + ":" + str(f.line) + " " + f.rule)
```

The machine-readable output is a separate, versioned shape, so the internal type can change without breaking scripts that parse it.

## By language

**typescript:** Exported types are surface: widening a parameter is safe, narrowing it or widening a return type can break consumers. Without an "exports" map in package.json, every file is importable. api-extractor reports the surface.

**python:** Every name without a leading underscore is reachable and assumed public; define __all__ and use _ prefixes. Pickled objects make class layout a wire format.

**go:** Capitalized names are public. internal/ directories enforce privacy across modules. Adding a method to an exported interface breaks every outside implementation. apidiff and gorelease check it.

**rust:** Adding a public field to an exhaustive struct, a variant to an exhaustive enum, or a method to a trait without a default is breaking. Auto traits (Send, Sync) leak through, so changing a private field can break callers. cargo-semver-checks catches many cases.

**java:** Binary and source compatibility differ: some changes recompile fine but fail at link time for code compiled against the old version. The module system (exports in module-info) narrows the surface.

**csharp:** Adding an optional parameter is a binary break, because defaults are compiled into the caller. The PublicAPI analyzers (PublicAPI.Shipped.txt) track the surface in source control.

## Related

[Hyrum's Law](hyrums-law.md) · [Semantic Versioning Discipline](semantic-versioning-discipline.md) · [Deprecation Policy](deprecation-policy.md) · [Non-Exhaustive Types](non-exhaustive-types.md) · [Postel's Law](postels-law.md) · [Inconsistent Error Contract](inconsistent-error-contract.md)

## Overlaps

hyrums-law explains why every observable behaviour is API. breaking-change-surface lists those surfaces, semantic-versioning-discipline says how to signal changes to them, and deprecation-policy how to retire them.

## Sources

- [Google AIP-180, Backwards compatibility](https://google.aip.dev/180) (read)
- [The Cargo Book, SemVer Compatibility](https://doc.rust-lang.org/cargo/reference/semver.html) (recalled)
- [Hyrum Wright, Hyrum's Law](https://www.hyrumslaw.com/) (recalled)
