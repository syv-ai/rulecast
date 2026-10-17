<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Model-View-Update (The Elm Architecture)

`model-view-update` · design patterns, architecture

A UI is one model value, an update function that takes a message and the model and returns the new model plus any commands (effects for the runtime to run), and a view function that renders the model. All change goes through update, and all effects go out as commands.

*Names:* Evan Czaplicki's Elm, described in the Elm guide as "The Elm Architecture" (TEA); the guide says the pattern emerged from early Elm programs rather than being designed up front. Model-View-Update (MVU) is the language-neutral name. Redux credits Elm as an influence, and its reducers are the update half. Descendants include Elmish and Fabulous (F#), Bubble Tea (Go), Iced (Rust), and The Composable Architecture (Swift). Related to Flux's unidirectional data flow.

*Matters most for:* tui, web-frontend, desktop, mobile

## But

MVU costs boilerplate: every interaction needs a message, a branch in update and often a command, and nested components need message wrapping and routing. The Elm community itself warns against modelling everything as reusable stateful components. Frameworks built on local reactive state (React hooks, signals in Solid or Vue, Textual's reactive attributes) argue that colocated state is easier to follow for most screens, and two-way-binding MVVM toolkits (WPF, SwiftUI's bindings) take the opposite route. Re-running the view on every message can be costly without memoisation or diffing. Games often use an entity-component system or a fixed-step loop instead. The long switch on the message in update is the idiom here, not the switch-statements smell.

## Quality axes

- **change_cost** ⊕ (primary): State changes only in a pure update function and effects are commands, so UI logic is tested by feeding messages and checking the model.
- **reliability** +: Async results and user input arrive as messages handled one at a time, so they don't race on shared state.
- **operability** +: The message stream can be logged and replayed to reproduce how the UI reached a state.
- **delivery** −: Every interaction needs a message, a branch in update and often a command.

**Flips:** For a small form or one-screen tool, or with deep trees of nested models, the boilerplate outweighs the gain; re-rendering on every message is costly without memoisation (runtime "-"), and doing I/O inside update loses the guarantees.

## Warranted when

- UI state is mutated from many handlers and callbacks, and it is hard to tell how it got into a given state.
- Handlers mix I/O, state changes and rendering, so the UI can only be tested by driving it.
- Async results arrive in any order and race with user input.
- You want replay, undo, time-travel debugging, or tests that feed messages and check the model.

## How it shows

- A message type (a sum type, a union of tagged objects, or a set of message structs) listing every event the UI reacts to.
- An update or reducer with one switch or match on the message, returning a new model and a command or list of effects.
- A view function that reads the model and returns a description of the screen, with no state changes in it.
- Effects (HTTP, timers, file reads) wrapped as commands whose results come back as messages.
- Parent models that hold child models and route messages down to the child's update.

## Overdone when

- Routing every keystroke of a small form or a one-screen tool through messages and commands when local widget state would be simpler.
- Deep trees of nested models, each with its own message type and forwarding boilerplate, built to imitate reusable components.
- Putting ephemeral view state (hover, scroll position, focus) into the global model when the toolkit already manages it.
- Doing I/O inside update "just this once", which keeps the boilerplate and loses the guarantees.

## Example

Before:

```
class SearchScreen:
    query: str
    results: list
    fn on_key(key):
        self.query += key
        self.results = api.search(self.query)     # I/O in the handler
        self.redraw()
    fn on_clear():
        self.query = ""
        self.results = []
        self.redraw()
```

After:

```
class Model: query: str; results: list
# Msg = KeyPressed(key) | Cleared | ResultsArrived(for_query, items)

fn update(msg, m: Model) -> (Model, Cmd):
    match msg:
        KeyPressed(k): q = m.query + k; return (Model(q, m.results), search_cmd(q))
        Cleared: return (Model("", []), no_cmd)
        ResultsArrived(q, items):
            if q != m.query: return (m, no_cmd)      # stale answer, ignore
            return (Model(m.query, items), no_cmd)

fn view(m: Model) -> Screen:
    return column(input_box(m.query), result_list(m.results))
```

State changes only in update, which is pure and testable with plain messages; the search runs as a command whose answer comes back as a message.

## By language

**python:** No mainstream Python UI framework is MVU; Textual uses widget-local reactive attributes and message handlers. A hand-written loop over a dataclass model and a match on message classes works for small TUIs.

**typescript:** Redux reducers and React's useReducer are the update half, with views as components reading the store. Redux Toolkit lets reducers look mutating because Immer produces the new state. Effects go through thunks, sagas or listener middleware rather than Elm-style commands.

**csharp:** Mostly met in F# (Elmish, Fabulous). For C#, MVVM with data binding is the norm in WPF and MAUI; MVU experiments exist but aren't mainstream.

**go:** Bubble Tea is MVU: a model with Init, Update(msg) returning (Model, Cmd) and View. Keep I/O out of Update and View; run it in a tea.Cmd returning a message. Models are usually passed by value, and parent models forward messages to child models' Update.

**rust:** Iced is MVU: update(&mut self, Message) returns a Task for effects, and view(&self) builds elements. Ratatui apps often hand-write the same loop; Ratatui's docs describe The Elm Architecture as one option. A Message enum and exhaustive match fit Rust well.

## Related

[Functional Core, Imperative Shell](functional-core-imperative-shell.md) · [State](state.md) · [Observer](observer.md) · [Command](command.md) · [Immutability by Default](immutability-by-default.md) · [Make Illegal States Unrepresentable](make-illegal-states-unrepresentable.md) · [UI thread confinement](ui-thread-confinement.md) · [Event Sourcing](event-sourcing.md) · [Switch Statements](switch-statements.md)

## Sources

- [Evan Czaplicki et al., An Introduction to Elm, The Elm Architecture](https://guide.elm-lang.org/architecture/) (read)
- [An Introduction to Elm, Commands and Subscriptions](https://guide.elm-lang.org/effects/) (recalled)
- [Redux documentation, Prior Art (Elm)](https://redux.js.org/understanding/history-and-design/prior-art) (recalled)
- [Bubble Tea README and tutorials (Go)](https://github.com/charmbracelet/bubbletea) (recalled)
- [Iced documentation, architecture (Rust)](https://docs.rs/iced/latest/iced/) (recalled)
