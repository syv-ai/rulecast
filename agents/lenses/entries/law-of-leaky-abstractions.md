<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# The Law of Leaky Abstractions

`law-of-leaky-abstractions` · laws, architecture

Every non-trivial abstraction lets some of the underlying details through, so you still need to understand what it hides.

*Names:* Coined by Joel Spolsky in 2002.

*Matters most for:* fullstack-web, databases-storage, library-sdk, iac, plugin-host

## But

It isn't an argument against abstractions; most of the time they work and the leak never matters. Treating every abstraction with suspicion and dropping to the lowest level produces more code and more bugs. Know where yours leaks; don't avoid them.

## Quality axes

*Bears on:* runtime, reliability, change_cost. The layer underneath shows through as N+1 queries, untranslated errors and escape hatches, so people who don't know it write slow or failing code.

## How it shows

- ORM code issuing a query per item in a loop (the N+1 problem)
- wrappers that catch and re-throw the underlying library's errors without translating them
- raw SQL or low-level escape hatches scattered through code that otherwise uses a high-level layer

## What to do

Learn the layer under the abstraction you rely on, document where yours leaks, and give callers a deliberate escape hatch.

## Example

Before:

```
fn front_page() -> list:
    cards = []
    for post in Post.query().latest(20):
        cards.append(Card(post.title, post.author.name))
    return cards
```

After:

```
fn front_page() -> list:
    # author is loaded lazily; without the join this runs one query per post
    posts = Post.query().latest(20).join_load("author")
    cards = []
    for post in posts:
        cards.append(Card(post.title, post.author.name))
    return cards
```

Reading post.author looks like a field access but is a database query; the code now accounts for what the ORM hides and says why.

## Related

[Fallacies of Distributed Computing](fallacies-of-distributed-computing.md) · [Hyrum's Law](hyrums-law.md) · [Law of Demeter](law-of-demeter.md)

## Sources

- [Milanović, Laws of Software Engineering, The Law of Leaky Abstractions](https://lawsofsoftwareengineering.com/laws/law-of-leaky-abstractions/) (read)
- [Spolsky, "The Law of Leaky Abstractions" (2002)](https://www.joelonsoftware.com/2002/11/11/the-law-of-leaky-abstractions/) (recalled)
