<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Non-Exhaustive Types

`non-exhaustive-types` · practices, api · **contested**

When a public enum, struct or interface is likely to grow, mark it so outside code can't depend on knowing every case or field, so you can add a variant, field or method later without a breaking release.

*Names:* Also called #[non_exhaustive], Sealed traits, Open enums. Rust's #[non_exhaustive] came from RFC 2008 (stabilized in Rust 1.40). The Rust API Guidelines name the related patterns C-SEALED (sealed traits) and C-STRUCT-PRIVATE (private fields). Protobuf's and Google AIP's guidance on unknown enum values is the wire-format version.

*Matters most for:* library-sdk, plugin-host, web-api, platforms

## But

Exhaustiveness is a feature for the user: a new variant failing their build tells them to handle it. Libraries like serde-style data types and many application-internal enums are better left exhaustive, with a major release when a variant is added. Inside one codebase, exhaustive matching is what you want. The trade-off is who learns about a new case, and when: the compiler at upgrade time, or a wildcard arm at run time.

## Quality axes

- **change_cost** ⊕ (primary): A variant, field or method can be added in a minor release without breaking downstream matches or literals.
- **reliability** −: Users lose the compiler's help, so a new case lands silently in a wildcard arm at run time instead of failing their build.

**Flips:** On closed sets, or types used only inside one codebase, it just throws away exhaustiveness checking. Many libraries are better off exhaustive, with a major release per new variant.

## Warranted when

- The type is in a published library, plugin API or wire format, and users upgrade on their own schedule.
- The set is known to grow, such as error kinds, event types, platform names or config options.
- An interface exists to be called by outsiders, not implemented by them.

## How it shows

- A public error or event enum that gained a variant in a minor release and broke downstream matches.
- Public structs with all-public fields that callers build with literals.
- A public interface or trait that outsiders implement, which can't gain a method.
- Client code with a default or wildcard arm on a match over a library's enum, written for forward compatibility.
- Response enums documented as "may gain values" with an UNSPECIFIED or unknown case.

## Overdone when

- Marking every type non-exhaustive, so users lose the compiler's help in exactly the places where seeing every case matters to them.
- Marking closed sets (Ordering, a boolean-like toggle, days of the week) as open.
- Sealing traits that users have a real reason to implement, such as for test doubles.

## Example

Before:

```
# published library
enum PaymentFailure:
    CARD_DECLINED
    INSUFFICIENT_FUNDS

# a user's code
match failure:
    CARD_DECLINED: retry_with_other_card()
    INSUFFICIENT_FUNDS: notify_customer()
# adding EXPIRED_CARD in a minor release breaks this build
```

After:

```
# published library
enum PaymentFailure:           # marked non-exhaustive: may gain cases in minor releases
    CARD_DECLINED
    INSUFFICIENT_FUNDS

# a user's code
match failure:
    CARD_DECLINED: retry_with_other_card()
    INSUFFICIENT_FUNDS: notify_customer()
    other: show_generic_failure(other)
```

The enum declares it can grow, so callers are made to handle unknown cases and adding EXPIRED_CARD is no longer a breaking change.

## By language

**rust:** #[non_exhaustive] on an enum forces downstream matches to have a wildcard arm; on a struct it stops outside literals and exhaustive destructuring. It has no effect inside the defining crate. Seal a trait with a private supertrait to add methods freely.

**java:** Adding an enum constant is binary compatible. A switch expression with no default stops compiling for clients that recompile, and one compiled earlier throws on the new value at run time: MatchException from Java 21, IncompatibleClassChangeError before that. A classic switch statement just skips the new value silently. Sealed interfaces (Java 17) do the opposite: they close the set so switches can be exhaustive, which makes adding a permitted type a breaking change.

**csharp:** Enums are open by nature (any underlying integer is a valid value), so callers should always handle the unknown case; switch expressions warn on non-exhaustive matches. Adding a member to a public interface breaks implementers unless it has a default implementation (C# 8+).

**typescript:** Adding a member to an exported union breaks consumers who check exhaustiveness with never. Document unions as open, or include an unknown or string fallback member for values from the wire.

**go:** No enums: iota constants are open by nature and switches aren't checked (the exhaustive linter adds it). Seal an interface with an unexported method so only your package can implement it; adding methods to an exported interface others implement is a break.

**python:** Enum and match have no built-in exhaustiveness check; type checkers do it with assert_never. Values from outside can be anything, so code that parses them should handle unknown values.

## Related

[Breaking-Change Surface](breaking-change-surface.md) · [Semantic Versioning Discipline](semantic-versioning-discipline.md) · [Hyrum's Law](hyrums-law.md) · [Postel's Law](postels-law.md)

## Sources

- [Rust RFC 2008, non_exhaustive](https://rust-lang.github.io/rfcs/2008-non-exhaustive.html) (recalled)
- [Rust API Guidelines, Future proofing (C-SEALED, C-STRUCT-PRIVATE)](https://rust-lang.github.io/api-guidelines/future-proofing.html) (read)
- [Google AIP-126, Enumerations](https://google.aip.dev/126) (recalled)
