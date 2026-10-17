<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Parse, Don't Validate

`parse-dont-validate` · practices, design

At the edge of the system, turn raw input into a type that can only hold valid values, and pass that type inward. A check that returns true or false and then hands on the raw value forgets what it learned, so the same checks get repeated, or skipped, deeper in.

*Names:* Coined by Alexis King in the blog post Parse, don't validate (2019). Her post borrows shotgun parsing, checks scattered through processing code, from the language-theoretic security (LangSec) community. In OO terms, it is close to always-valid value objects.

*Matters most for:* web-api, cli-devtool, library-sdk, data-pipeline, plugin-host

## But

In languages without a static type checker, or where it isn't enforced, the narrower type is only a convention, so the gain is smaller, though parsing at the edge still helps. Some rules can't be known at the boundary (uniqueness against the database, stock levels) and still need checking at the point of use. Many small wrapper types add friction, so introduce them for values that are passed around and misused, not for everything. Collecting every error for a form is a different job from failing on the first one, and some parsing libraries make that harder.

## Quality axes

- **reliability** ⊕ (primary): Inner code receives types that can only hold valid values, so checks aren't skipped deeper in, and processing doesn't fail halfway through input.
- **security** +: Untrusted input is turned into constrained types at the edge, before it reaches anything that acts on it.
- **change_cost** +: Repeated defensive checks disappear, and narrow types say what a value means.
- **delivery** −: Wrapper types, constructors and conversions have to be written at each boundary.

**Flips:** Wrapping every string in its own type fills simple code with ceremony and turns change_cost "-". Without an enforced type checker the guarantee is only a convention.

## Warranted when

- Input arrives untyped at a boundary (HTTP bodies, CLI arguments, config files, environment, queue messages, files).
- Deeper code defends itself with checks because it can't tell whether input was already checked.
- Bugs where processing started, then failed halfway on a later part of the input.
- Primitive types carrying meaning (an id, an email, a currency amount) passed around as plain strings and numbers.

## How it shows

- Functions named validate_x or is_valid_x that return a bool or nothing, after which the raw string, dict or JSON flows on.
- The same check (non-empty, in range, well-formed email) repeated in several layers.
- Domain functions taking str, int or dict where a narrower type exists or could exist.
- After the change, constructors or parse functions that return the narrower type or an error, used at request handlers, CLI argument parsing and config loading.

## Overdone when

- Wrapping every string in its own type, so simple code fills with conversions and ceremony.
- Parsing internal data that never crosses a boundary and is already well-typed.
- Types whose invariants are weaker than their names promise, which gives false confidence.
- Rejecting input the system could have tolerated, where being liberal about input was the right call.

## Example

Before:

```
fn is_valid_email(raw: str) -> bool:
    return "@" in raw and len(raw) < 255

fn signup(raw_email: str):
    if not is_valid_email(raw_email): raise BadRequest
    create_account(raw_email)

fn create_account(email: str):
    if "@" not in email: raise ValueError     # checked again, just in case
    ...
```

After:

```
class Email:
    value: str
    fn parse(raw: str) -> Email or ParseError:
        if "@" not in raw or len(raw) >= 255: return ParseError("email")
        return Email(raw.lower())

fn signup(raw_email: str):
    email = Email.parse(raw_email) or raise BadRequest
    create_account(email)

fn create_account(email: Email):
    ...
```

The check happens once at the edge and its result is a type, so create_account can't be handed an unchecked string.

## One-file tell

Python and TypeScript: a function whose name starts with validate or is_valid, returns bool or nothing, and takes a str, dict, any or unknown, in a module that also passes that same argument on to other calls. Many such functions are fine; it marks places to look.

## By language

**python:** Pydantic models (as used by FastAPI) and attrs or dataclass constructors are the usual parsers at the boundary; NewType or small frozen classes carry the result inward. The guarantee holds only as far as a type checker runs.

**typescript:** Types are erased, so JSON.parse returns unchecked data. Schema libraries such as zod or valibot parse into typed values; branded types mark values that went through a parser.

**java:** Records with checks in the compact constructor, or value classes with private constructors and static factory methods; Bean Validation annotations are the validate style this principle argues against relying on alone.

**csharp:** Value objects with private constructors and a static TryParse or Create that returns a result; records help. Data annotations and FluentValidation validate without producing a narrower type.

**go:** A constructor returning (T, error) with unexported fields, so the only way to get a T is through it. Zero values can still bypass it, so the type's zero value should be invalid or harmless.

**rust:** Newtypes with TryFrom or FromStr, and serde deserialising straight into strict types, make this the default style; the standard library's NonZero types are an example.

## Related

[Make Illegal States Unrepresentable](make-illegal-states-unrepresentable.md) · [Primitive Obsession](primitive-obsession.md) · [Postel's Law](postels-law.md) · [Functional Core, Imperative Shell](functional-core-imperative-shell.md)

## Overlaps

validate-at-the-boundary says where checks belong, parse-dont-validate how to make them stick (turn input into a type that can't be invalid), and trusting-client-input is the failure of checking only on the client.

## Sources

- [Alexis King, Parse, don't validate (2019)](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) (read)
- [LangSec, The Seven Turrets of Babel (Momot, Bratus, Hallberg, Patterson, 2016), shotgun parsing](https://langsec.org/) (recalled)
