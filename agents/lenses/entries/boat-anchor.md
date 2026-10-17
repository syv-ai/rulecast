<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Boat anchor

`boat-anchor` · anti-patterns, design

A component, library or piece of infrastructure is kept in the system although it serves no purpose, usually because it was costly to get or might be useful later.

*Matters most for:* iac, platforms

## But

Something kept on purpose for a dated, near-term plan is not a boat anchor if the plan is written down. Some dependencies are used only at build time or through plugins and look unused to naive checks.

## Quality axes

- **security** −: An unused dependency or idle client still brings its vulnerabilities and credentials into the system, for no benefit.
- **change_cost** −: An unused dependency still has to be upgraded and kept compiling, and readers have to work out that it does nothing.
- **operability** −: Config, deployment entries and startup connections for a component nobody uses must still be maintained, and can fail a deploy.

## Why people fall into it

- The thing was paid for or took effort to integrate, and dropping it feels like waste (sunk cost).
- We might need it later.

## How it shows

- dependencies in the manifest that nothing imports
- clients, connections or services set up at startup and never called
- configuration and deployment entries for a component no code uses

## Overcorrecting looks like

- Removing an integration that is idle but required by contract, compliance or a planned migration.

## What to do

Remove it, along with its configuration and dependency entries.

## Example

Before:

```
fn start_app(config: Config) -> App:
    db = Database(config.db_url)
    search = SearchCluster(config.search_hosts)   # bought last year, never wired in
    ml = RecommenderClient(config.ml_endpoint)    # for later
    app = App(db)
    app.register_routes(routes)
    return app
```

After:

```
fn start_app(config: Config) -> App:
    db = Database(config.db_url)
    app = App(db)
    app.register_routes(routes)
    return app
```

The idle clients go, and with them their config, dependencies and startup cost.

## Related

[Lava flow](lava-flow.md) · [Dead Code](dead-code.md) · [Speculative Generality](speculative-generality.md) · [YAGNI](yagni.md)

## In the interview

- [When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it.](../THINKING.md#kept-for-what-it-does)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Boat Anchor (recalled)
