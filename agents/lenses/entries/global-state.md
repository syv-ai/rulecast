<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Global state

`global-state` · anti-patterns, design · **agents do this**

Mutable data reachable from anywhere, as global variables, module-level state or singletons, so any code can change it and no caller's behaviour depends only on what it was given.

*Matters most for:* web-api, serverless, web-frontend, ml-training, games, embedded, tui, plugin-host

## But

Immutable constants and read-only configuration loaded once at startup are harmless. Loggers and metrics are commonly global by convention and rarely cause trouble. Small scripts don't need injection. The cost is in mutable shared state, which hurts testability and concurrency.

## Quality axes

- **delivery** +: A global is one line, where passing the value through layers is tedious.
- **reliability** −: Any code can change the value, so behaviour depends on what ran earlier and concurrent access races.
- **change_cost** −: Tests must set up and reset shared state, and no function can be understood from its arguments alone.

**Flips:** In a small script, or for immutable config and conventional loggers and metrics, a global is harmless and simpler than injection.

## Why people fall into it

- Passing a value through many layers is tedious, and a global is one line.
- Singleton reads as a respectable pattern, and config or connections feel naturally "one per app".
- Frameworks that expose a global request or app object.

## How it shows

- module-level variables reassigned inside functions
- singletons holding config, connections, caches or the current user
- tests that must reset shared state between runs, or that fail when run in a different order or in parallel
- functions whose result changes without any change to their arguments

## Overcorrecting looks like

- Threading every constant and logger through every function signature, which bloats parameter lists for values that never change.

## What to do

Construct the value once at startup and pass it in (dependency injection); keep truly global values immutable.

## Example

Before:

```
current_tenant = None

fn handle_request(req: Request):
    global current_tenant
    current_tenant = lookup_tenant(req.host)
    return list_projects()

fn list_projects() -> list:
    return db.query("projects", tenant=current_tenant.id)
```

After:

```
fn handle_request(req: Request):
    tenant = lookup_tenant(req.host)
    return list_projects(tenant)

fn list_projects(tenant: Tenant) -> list:
    return db.query("projects", tenant=tenant.id)
```

The tenant is passed in, so two concurrent requests can't see each other's tenant and the function can be tested alone.

## One-file tell

TypeScript and JavaScript application code only, not scripts/ or *.config.* files: a function that reassigns a module-level let, or writes to a module-level object, array, Map or Set by property, index or a mutating method (set, push, add, delete). It has no Python or Go form.

## By language

**python:** A module is already a singleton; module-level mutable variables and the global keyword are the usual form.

**go:** Package-level vars set in init() are the common form; passing dependencies in struct fields is the idiom.

## Related

[Singleton](singleton.md) · [Law of Demeter](law-of-demeter.md)

## Overlaps

global-state is the problem. singleton is one way to produce it, and the pattern entry covers when a single instance is still right.

## Sources

- Wulf and Shaw, Global Variable Considered Harmful (1973) (recalled)
