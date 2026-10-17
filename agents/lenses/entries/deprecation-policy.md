<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Deprecation Policy

`deprecation-policy` · practices, api

Remove public things in stages, marking them deprecated with a replacement and a removal date or version, warning users, and only deleting after a stated window, so users can migrate on their own schedule.

*Names:* Also called Deprecation window, Deprecate, then remove. No single originator. The semver FAQ gives the minimal rule: deprecate in a minor release before removing in a major. Google's AIPs and large projects (Python's PEP 387, Kubernetes' deprecation policy) set explicit windows.

*Matters most for:* library-sdk, web-api, cli-devtool, plugin-host, platforms, iac

## But

For internal code in a monorepo, change all callers and delete; a deprecation cycle there is waste. Security fixes sometimes have to break immediately. Pre-1.0 projects are allowed to break, but even there a one-release warning is cheap kindness. Some argue (Hickey's Spec-ulation) that you should never remove at all and add new names instead, which trades a clean codebase for stability.

## Quality axes

- **change_cost** ⊕ (primary): Public things can be renamed or redesigned without stranding users, who migrate on their own schedule with warnings naming the replacement.
- **delivery** −: The old path, its mapping to the new one and its warnings must be kept working for the whole window before removal.

**Flips:** For internal code where every caller can be changed in one commit, a deprecation cycle is waste. Keeping deprecated paths forever turns change_cost "-".

## Warranted when

- The thing to remove has users you can't coordinate with directly.
- A rename or redesign is overdue, but a hard break would strand users.
- The project promises semver or another stability contract.

## How it shows

- Deprecation markers in code (@Deprecated, [Obsolete], #[deprecated], @deprecated JSDoc, warnings.warn with DeprecationWarning) naming the replacement.
- A documented window, such as "removed two minor releases after deprecation" or "after twelve months".
- Old CLI flags or config keys still accepted, mapped to the new ones, with a warning on stderr.
- Sunset or Deprecation HTTP headers on old endpoints.
- Its absence: things removed in the release after they were renamed, with no warning.

## Overdone when

- Keeping deprecated paths forever, so the codebase carries every old name and the cleanup never happens.
- A formal deprecation cycle for internal code where you can change every caller in one commit.
- Warnings so frequent and noisy that users silence them all, including the important ones.

## Example

Before:

```
# release 2.4: renamed, old name deleted
fn export_ledger(ledger, format: str) -> bytes:
    ...
# every caller of export_csv(ledger) breaks on upgrade
```

After:

```
# release 2.4
fn export_ledger(ledger, format: str) -> bytes:
    ...

fn export_csv(ledger) -> bytes:
    warn_deprecated("export_csv is deprecated since 2.4 and will be removed in 3.0; "
                    + "use export_ledger(ledger, 'csv')")
    return export_ledger(ledger, "csv")
```

The old name keeps working for a stated window and tells callers exactly what to use instead, so removal in 3.0 surprises no one.

## By language

**python:** DeprecationWarning is hidden by default except in __main__ and under test runners, so users of a library often never see it; FutureWarning is shown to end users. Python 3.13 added warnings.deprecated for type checkers. Set stacklevel so the warning points at the caller.

**java:** @Deprecated(since = "...", forRemoval = true) plus the @deprecated Javadoc tag naming the replacement. forRemoval produces a stronger compiler warning.

**csharp:** [Obsolete("use X", error: false)] warns and can later be flipped to error: true before removal. A DiagnosticId lets users suppress one deprecation precisely.

**rust:** #[deprecated(since = "...", note = "use X")] warns at use sites in downstream crates. Removal is a breaking change, so it waits for the next major (or the next 0.y).

**typescript:** The @deprecated JSDoc tag shows strikethrough in editors but emits nothing at runtime; add a runtime warning for JavaScript users if they matter.

**go:** A doc comment paragraph starting "Deprecated:" is the convention, picked up by gopls and staticcheck. Removal requires a new major module path.

## Related

[Semantic Versioning Discipline](semantic-versioning-discipline.md) · [Breaking-Change Surface](breaking-change-surface.md) · [Hyrum's Law](hyrums-law.md) · [Lava flow](lava-flow.md)

## Overlaps

hyrums-law explains why every observable behaviour is API. breaking-change-surface lists those surfaces, semantic-versioning-discipline says how to signal changes to them, and deprecation-policy how to retire them.

## Sources

- [Semantic Versioning 2.0.0, FAQ, How should I handle deprecating functionality?](https://semver.org/#how-should-i-handle-deprecating-functionality) (read)
- [PEP 387, Backwards Compatibility Policy](https://peps.python.org/pep-0387/) (recalled)
- [Kubernetes Deprecation Policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/) (recalled)
- [RFC 8594, The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594) (recalled)
