<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Functional Core, Imperative Shell

`functional-core-imperative-shell` · practices, design

Put the decisions in pure functions that take values and return values, and keep a thin outer layer that reads input, calls the core, and carries out the effects it returns. The core is tested with plain values and no doubles; the shell is kept simple enough to need only a few integration tests.

*Names:* Named by Gary Bernhardt in the Destroy All Software screencast of that name (2012) and his talk Boundaries. Close relatives are hexagonal architecture (Cockburn), Eric Normand's actions, calculations and data (Grokking Simplicity, 2021), and the Elm architecture.

*Matters most for:* cli-devtool, tui, games, web-api, data-pipeline, event-driven

## But

Some logic depends on intermediate I/O: the next query depends on the last answer, or the data is too big to load first. Then the core has to be split into several steps, or the shell grows decisions, and the clean split blurs. Returning descriptions of effects instead of doing them adds a layer of indirection that can be harder to follow than the direct code. For small scripts and thin CRUD handlers there is little core to extract. Teams used to object-oriented layering may find a ports-and-adapters split, with doubles at the ports, a more familiar way to get similar testability.

## Quality axes

- **change_cost** ⊕ (primary): Decisions live in pure functions tested with plain values and no doubles, and are easier to reason about and reuse in another setting.
- **delivery** −: Code that interleaves reading, deciding and writing has to be restructured, often to return descriptions of effects for the shell to carry out.

**Flips:** When the logic is mostly I/O orchestration, or the next query depends on the last answer, the split adds indirection without a real core. Effect systems that make the shell pure as well turn change_cost "-", and loading everything up front for purity can cost runtime.

## Warranted when

- Business rules tangled with database calls, HTTP calls and the clock, so tests need many doubles.
- Logic that's hard to reason about because state changes happen in the middle of decisions.
- A need to run the same rules in different settings (CLI, server, batch job, replay).
- Event loops (TUIs, games, reducers) where an update step can be a pure function of state and event.

## How it shows

- Modules of pure functions that take records and return decisions, results or lists of effects to apply.
- An outer layer (handler, command, main loop) that loads data, calls the core and then writes, sends or prints.
- Core tests with no mocks, no fixtures beyond values, and no I/O.
- Before the change, functions that interleave reading, deciding and writing, tested through many mocks.

## Overdone when

- Building effect systems, monads or free interpreters to make the shell itself pure.
- Forcing logic that is mostly I/O orchestration into a core that just returns instructions mirroring the I/O calls one for one.
- Loading everything up front so the core can be pure, when the decisions need data fetched lazily.

## Example

Before:

```
fn renew_subscriptions():
    for sub in db.active_subscriptions():
        if sub.ends <= clock.today():
            if sub.card_expired:
                mailer.send(sub.owner, "update your card")
            else:
                payments.charge(sub.owner, sub.price)
                db.extend(sub, 30 days)
# testing the rules needs a fake db, clock, mailer and payments
```

After:

```
fn decide_renewals(subs: list, today: Date) -> list:       # pure core
    actions = []
    for sub in subs:
        if sub.ends > today: continue
        if sub.card_expired: actions.add(AskForCard(sub.owner))
        else: actions.add(Charge(sub.owner, sub.price), Extend(sub, 30 days))
    return actions

fn renew_subscriptions():                                 # thin shell
    for action in decide_renewals(db.active_subscriptions(), clock.today()):
        execute(action)
```

The renewal rules are now a function from values to values, tested without doubles, and the shell only loads, calls and executes.

## By language

**python:** Pure functions over frozen dataclasses in the core, with the FastAPI route or CLI command as the shell; no special library needed.

**typescript:** Reducers in Redux or useReducer, and the Elm-style update functions in UI code, are this pattern; for back ends, plain functions over readonly types called from a handler.

**java:** Records and static methods, or domain classes free of framework dependencies, called from Spring services or controllers acting as the shell.

**csharp:** Records and static functions in the core, with controllers, minimal API handlers or background services as the shell.

**go:** Functions over plain structs with no context.Context, no interfaces to I/O, and no goroutines in the core; Bubble Tea's Update function is a core of this kind, with commands returned for the runtime to run.

**rust:** Ownership pushes toward it: a core of functions over owned or borrowed values with no I/O, and an async or main-loop shell. Returning an enum of actions for the shell to execute is a common shape.

## Related

[Hard-to-Test Code](hard-to-test-code.md) · [Mocking Everything (over-mocking)](mock-everything.md) · [Global state](global-state.md) · [Command-Query Separation (CQS)](command-query-separation.md) · [Immutability by Default](immutability-by-default.md) · [Parse, Don't Validate](parse-dont-validate.md)

## Sources

- [Gary Bernhardt, Functional Core, Imperative Shell, Destroy All Software screencast (2012)](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) (recalled)
- [Gary Bernhardt, Boundaries (talk, 2012)](https://www.destroyallsoftware.com/talks/boundaries) (recalled)
- [Eric Normand, Grokking Simplicity (2021)](https://www.manning.com/books/grokking-simplicity) (recalled)
