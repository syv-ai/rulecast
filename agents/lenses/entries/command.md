<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Command

`command` · design patterns, behavioral

Wrap a request in an object that carries everything needed to run it, so it can be passed around, queued, logged, retried or undone; also called Action or Transaction.

*Matters most for:* desktop, games, cli-devtool, event-driven, web-frontend, tui

## But

It adds a layer between the caller and the code that does the work, and the extra indirection costs reading time. Unless you need undo, deferral, queueing or a record of what ran, pass a function. Undo by inverse operation is hard to get right, and undo by stored state can eat memory; pick deliberately. Command-bus architectures in CQRS-style apps are often criticised as ceremony when the app is a simple CRUD service.

## Quality axes

- **change_cost** ⊕ (primary): One action object serves the button, menu, shortcut and API, and undo, queueing or retry can be added around it.
- **operability** +: Requests exist as data, so what ran can be logged, inspected and replayed.
- **delivery** −: A class per action plus an invoker is more to write than calling a function.

**Flips:** Without undo, queueing, replay or logging it is a layer where a function or callback would do, and a command bus over a simple CRUD app is ceremony.

## Warranted when

- The same operation is triggered from several places (button, menu, shortcut, API) and its logic keeps getting duplicated
- Operations need undo and redo
- Work has to be queued, scheduled, retried, logged, or sent to another process, so the request must exist as data
- Several simple operations need composing into a macro or transaction

## How it shows

- Small classes each named for one action, with an execute method and often an undo method
- A history stack or job queue holding action objects
- Menu items, buttons or keybindings that point at shared action objects instead of holding the logic

## Overdone when

- Command classes with only execute and no undo, queueing or serialization, where a plain function or callback would do
- A command bus that adds a layer between every caller and every handler for an app that never queues or replays anything
- One command class per CRUD operation, each just calling one service method

## Example

Before:

```
class PlaylistScreen:
    fn on_drag_drop(track, to_index):
        old = playlist.index_of(track)
        playlist.move(track, to_index)
        ... # no way back
class PlaylistApi:
    fn post_move(track_id, to_index):
        track = library.find(track_id)
        playlist.move(track, to_index)    # same logic, copied
# users now want ctrl+z, and the sync service wants to replay edits made offline
```

After:

```
class MoveTrack:
    track_id: str
    to_index: int
    from_index: int = null
    fn execute(playlist):
        self.from_index = playlist.index_of(self.track_id)
        playlist.move(self.track_id, self.to_index)
    fn undo(playlist):
        playlist.move(self.track_id, self.from_index)

history.run(MoveTrack(track_id, to_index))    # screen and API both send this
history.undo()                                 # pops and calls undo
sync.replay(saved_commands)                    # the same objects, stored as data
```

The move becomes an object carrying its own arguments and inverse, which is what undo and offline replay need; without those, a shared function would do.

## By language

**python:** Functions are first-class, so a callable or functools.partial covers most uses; Norvig counted Command among the patterns that mostly vanish in dynamic languages. A class still earns its place when the command needs undo, a description for history, or must be serialized for a task queue (Celery-style tasks are commands). The source says Python code picks it over plain callbacks mainly for wiring UI actions, task queues and operation history.

**typescript:** Fairly common in TypeScript, used instead of bare callbacks to bind actions to UI elements, to queue work, or to keep a history. With first-class functions, a closure is often enough. A command earns its own object when it needs undo, serialisation or metadata, and Redux-style actions (plain tagged objects interpreted by a reducer) are a data-only variant. Spotting it: Objects implementing a one-method interface (such as `execute`), each holding a receiver passed in at construction and performing one action on it.

**java:** Common, mainly as a stand-in for callbacks and for queuing work. Runnable and Callable submitted to an executor, and Swing's Action, are commands. Since Java 8 a lambda or method reference usually replaces a one-off command class. Separate classes still pay off when commands need undo, serialization or metadata. Spotting it: A family of classes implementing a shared single-method interface (execute, run, call) that each wrap one action, plus an invoker that accepts them as parameters or queues them.

**csharp:** Often used in place of callbacks, for queued work and for operation history. WPF and MVVM build on the ICommand interface for binding actions to UI controls (with helpers such as RelayCommand). For simple cases an Action or Func delegate is the lighter idiomatic choice; full command classes pay off when you need undo, queuing, serialization or CQRS-style request objects handled by MediatR. Spotting it: Small classes, each wrapping one action, implementing an Execute-style method (ICommand, IRequest and similar) and holding the receiver they act on, passed in at construction.

**go:** Often a plain func() or closure rather than a one-method interface, since functions are first-class and capture their arguments. A command interface earns its place when commands need extra methods (undo, name, serialisation) or are queued and sent across goroutines through a channel. CLI frameworks like cobra model subcommands as command structs with a Run function field. Spotting it: A one-method Execute interface with many small implementing structs, or slices and channels of func() values run later.

**rust:** Commands implement a trait with `execute`/`undo` and are stored as `Vec<Box<dyn Command>>`. Commands don't keep a reference to the receiver, because the borrow checker wouldn't allow it. The receiver is passed in as `&mut` on each call. When commands are a closed set, an enum of command variants with a single `apply` match is usually simpler and serializable. For fire-and-forget commands, `Box<dyn FnMut(&mut Ctx)>` closures are enough. Spotting it: A trait with `execute(&mut self, ctx: &mut Context)`, a history `Vec<Box<dyn ..>>`, an `enum Command` matched in a dispatcher, or messages sent over a channel to an actor.

**cpp:** Used in C++ in place of callbacks, for binding actions to UI elements, queuing work and keeping an operation history. Since C++11, lambdas stored in std::function (or std::move_only_function in C++23) cover most simple commands; full command classes are worth it when undo, serialization or inspection is needed. Captured references in a stored lambda can dangle, so capture by value or own the receiver. Spotting it: Small classes, each wrapping one action, holding a reference to a receiver passed into the constructor and exposing an execute method; or containers of std::function invoked later.

## Related

[Memento](memento.md) · [Strategy](strategy.md) · [Chain of Responsibility](chain-of-responsibility.md) · [Visitor](visitor.md) · [Prototype](prototype.md)

## Sources

- [Refactoring.Guru, Design Patterns: Command](https://refactoring.guru/design-patterns/command) (read)
- [Refactoring.Guru, Command in Python](https://refactoring.guru/design-patterns/command/python/example) (read)
- [Peter Norvig, Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/) (recalled)
- [Refactoring.Guru, Command in TypeScript](https://refactoring.guru/design-patterns/command/typescript/example) (read)
- Established TypeScript practice (closures, Redux actions) (recalled)
- [Refactoring.Guru, Command in Java](https://refactoring.guru/design-patterns/command/java/example) (read)
- [Refactoring.Guru, Command in C#](https://refactoring.guru/design-patterns/command/csharp/example) (read)
- System.Windows.Input.ICommand; MediatR requests (recalled)
- [Refactoring.Guru, Command in Go](https://refactoring.guru/design-patterns/command/go/example) (read)
- [cobra, Command type](https://pkg.go.dev/github.com/spf13/cobra#Command) (recalled)
- [Refactoring.Guru, Command in Rust](https://refactoring.guru/design-patterns/command/rust/example) (read)
- [Rust Design Patterns, Command (trait objects, enums, closures)](https://rust-unofficial.github.io/patterns/patterns/behavioural/command.html) (recalled)
- [Refactoring.Guru, Command in C++](https://refactoring.guru/design-patterns/command/cpp/example) (read)
- [std::function and std::move_only_function, cppreference](https://en.cppreference.com/w/cpp/utility/functional/function) (recalled)
