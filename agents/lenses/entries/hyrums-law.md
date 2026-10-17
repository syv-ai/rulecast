<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Hyrum's Law

`hyrums-law` · laws, architecture

With enough users, every observable behaviour of an API ends up depended on by someone, whatever the docs promise.

*Names:* Named after Hyrum Wright at Google, who stated it; it is also discussed in Software Engineering at Google (2020), ch. 1.

*Matters most for:* library-sdk, web-api, platforms, plugins-extensions, cli-devtool, plugin-host

## But

Freezing every quirk makes a system impossible to evolve. Large projects like Go deliberately randomise map iteration order, or break undocumented behaviour on purpose, to keep users honest. For internal code with a few callers you can just change both sides.

## Quality axes

*Bears on:* change_cost, reliability. Every observable behaviour becomes a contract, so changes, even to undocumented quirks, break someone and get costlier as users grow.

## How it shows

- public functions returning collections whose order happens to be stable but isn't documented
- error messages, timing or field order that callers parse or compare against
- changelogs full of "fixed" behaviour later reverted for compatibility

## What to do

Keep the observable surface small, randomise or hide what you don't promise (such as map order), and treat any behaviour change as a potentially breaking one.

## Example

Before:

```
fn upload(account: Account, file: File):
    if account.used + file.size > account.quota:
        raise UploadError("quota exceeded: " + str(account.used) + "/" + str(account.quota))
    ...

# in a client somewhere
except UploadError as e:
    used = int(e.message.split(": ")[1].split("/")[0])
```

After:

```
fn upload(account: Account, file: File):
    if account.used + file.size > account.quota:
        raise QuotaExceeded(used=account.used, quota=account.quota)
    ...

# in a client somewhere
except QuotaExceeded as e:
    used = e.used
```

Callers were parsing the message text because nothing better was offered; the values they need are now a stated part of the API, so they can stop depending on the wording, though rewording it is still a change to announce.

## Related

[The Law of Leaky Abstractions](law-of-leaky-abstractions.md) · [Postel's Law](postels-law.md)

## Overlaps

hyrums-law explains why every observable behaviour is API. breaking-change-surface lists those surfaces, semantic-versioning-discipline says how to signal changes to them, and deprecation-policy how to retire them.

## Sources

- [Milanović, Laws of Software Engineering, Hyrum's Law](https://lawsofsoftwareengineering.com/laws/hyrums-law/) (read)
- [Winters, Manshreck & Wright, Software Engineering at Google (2020), ch. 1](https://abseil.io/resources/swe-book/html/ch01.html) (read)
