<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Zawinski's Law

`zawinskis-law` · laws, architecture

Every program keeps growing features until it tries to do everything, even read mail, so scope has to be defended.

*Matters most for:* cli-devtool, desktop, plugins-extensions

## But

Jamie Zawinski's point was partly that platforms win: users want one place to work, and apps that refuse to grow can lose to ones that do. Some expansion is the product strategy, not bloat.

## Quality axes

*Bears on:* change_cost. Programs keep growing features outside their scope, and every one of them makes the rest of the code costlier to change.

## How it shows

- modules or dependencies for capabilities far outside the project's stated purpose
- a steadily growing list of subcommands, settings or integrations with little use

## What to do

Write down the product's scope, say no to features outside it, and offer extension points or integrations instead of building everything in.

## Related

[Second-System Effect](second-system-effect.md) · [Lehman's Laws of Software Evolution](lehmans-laws.md)

## Sources

- [Milanović, Laws of Software Engineering, Zawinski's Law](https://lawsofsoftwareengineering.com/laws/zawinskis-law/) (read)
