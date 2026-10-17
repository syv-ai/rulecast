<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Observer

`observer` · design patterns, behavioral

Interested objects subscribe to a publisher and get told when something happens, without the publisher knowing who they are; also called Publish-Subscribe, Listener or Event Subscriber.

*Matters most for:* web-frontend, desktop, mobile, games, event-driven, tui, plugin-host

## But

Control flow goes implicit: you can't see from the publisher what will happen when it fires. Subscribers run in no guaranteed order, updates can cascade or loop, and forgotten subscriptions leak memory (the lapsed listener problem). Exceptions in one subscriber can stop the rest. Reactive-programming advocates argue raw callbacks compose poorly and prefer streams or signals. When there is one known dependent, call it.

## Quality axes

- **change_cost** ⊕ (primary): New dependents subscribe without the publisher being edited for each one.
- **reliability** −: Subscribers run in no guaranteed order, updates can cascade, forgotten subscriptions leak, and one subscriber's exception can stop the rest.
- **operability** −: From the publisher you can't see what will happen when it fires, so diagnosing behaviour means finding every subscriber.

**Flips:** Between two objects, or for steps that must happen in order, events hide the real flow and change_cost turns "-"; with one known dependent a direct call is better.

## Warranted when

- A change in one object must update others, and the set of those others isn't known up front or changes at runtime
- The publisher keeps getting edited to call each new dependent directly
- Something should be watched only for a while or under certain conditions
- Client code needs to attach its own reactions to a component it doesn't own

## How it shows

- subscribe / unsubscribe or add_listener / remove_listener methods keeping a collection of subscribers
- A notify loop that calls the same method on every subscriber
- Signals, events or hooks that other modules register handlers on

## Overdone when

- An event system between two objects where a direct call would be clearer
- Business steps that must happen in order chained through events, so the real flow is invisible
- Every internal change broadcast as an event that nothing, or exactly one thing, listens to

## Example

Before:

```
class BuildRunner:
    fn finish(build: Build):
        build.status = "done"
        self.chat.post(build.channel, build.summary())
        self.dashboard.refresh(build.id)
        self.metrics.record_duration(build)
        self.artifact_cleaner.schedule(build)    # added last sprint
        ... # each new team edits this method to get told
```

After:

```
class BuildRunner:
    listeners: list    # of fn(Build)
    fn on_finished(listener: fn(Build)):
        self.listeners.append(listener)
    fn finish(build: Build):
        build.status = "done"
        for listener in self.listeners:
            listener(build)

runner.on_finished(fn(b): chat.post(b.channel, b.summary()))
runner.on_finished(dashboard.refresh_for)    # each consumer subscribes itself
```

The runner announces that a build finished instead of calling each dependent, so new consumers subscribe without editing it.

## One-file tell

A class with subscribe / attach and unsubscribe / detach methods that add to and remove from a list, plus a method looping over that list calling update or notify on each item.

## By language

**python:** Usually a list of callables rather than observer classes; Django signals, blinker and framework hooks are the common forms. Holding subscribers with weakref avoids keeping dead objects alive. The source points to GUI components as the common Python use.

**typescript:** Common in TypeScript, especially in GUI code. It is everywhere in the platform: DOM `addEventListener`, Node's `EventEmitter`, `EventTarget`, and RxJS observables, so hand-rolling one is rarely needed. Pass listeners as functions rather than objects with an `update` method, and return an unsubscribe function to avoid leaks. Spotting it: Subscribe or `on` methods that add listeners to a list, and a notify step that calls each listener.

**java:** Very common, mainly as EventListener interfaces across Swing, servlet session listeners and JSF phase listeners. java.util.Observer/Observable exist but are deprecated since Java 9 and rarely used. Modern code uses PropertyChangeSupport, framework events (Spring @EventListener), or reactive streams (Flow, Reactor, RxJava). Listener lists hold strong references, so forgotten unsubscribes leak memory. Spotting it: An addXListener/subscribe method that stores listener objects in a list, and a fire or notify method that loops over the list calling each one.

**csharp:** Built into the language through events and delegates, so a hand-rolled subscriber list is rarely needed. The base library also ships IObservable<T>/IObserver<T> (the basis of Rx.NET) and INotifyPropertyChanged for data binding. Watch for event handlers that are never unsubscribed, a classic C# memory leak because the publisher keeps subscribers alive. Spotting it: `event` declarations with += and -= subscriptions, EventHandler<T> delegates, INotifyPropertyChanged, or IObservable<T> Subscribe calls.

**go:** The subscriber-interface form works but is often replaced by callbacks, a slice of func values registered with an On or Subscribe method, or by channels: each subscriber gets a channel and the subject sends to all of them. Channels bring their own problems: a slow subscriber blocks the sender unless sends are buffered or dropped, and unsubscribing has to close channels carefully. context cancellation is a built-in one-shot notification. Spotting it: A slice or map of listener interfaces or funcs with register and unregister methods, or a fan-out loop sending one event to many channels.

**rust:** Observers holding references back to the subject run straight into ownership rules, so Rust versions store callbacks rather than objects. That means `fn` pointers, `Box<dyn Fn(..)>` closures, or channels (`mpsc`, tokio `broadcast`/`watch`) where subscribers own a receiver. Unsubscribing needs an ID or handle returned at subscription, since closures can't be compared. `Weak` references avoid `Rc` cycles when observers must be objects. Spotting it: A `HashMap<Event, Vec<Callback>>` with `subscribe`/`notify` methods, a `Vec<Box<dyn Fn>>` listener list, or a sender/receiver pair handed out to subscribers.

**cpp:** Common in C++, above all in GUI toolkits. Lifetime is the C++-specific hazard: a subject holding raw pointers to observers that have been destroyed will crash, so observers must unsubscribe in their destructor, or the subject holds weak_ptr, or a signal library manages connections (Qt signals and slots, Boost.Signals2). A vector of std::function is the lightweight form when lifetimes are simple. Spotting it: A subject with attach and detach (subscribe) methods that add to a list of observer pointers or callbacks, and a notify method that calls each one.

## Related

[Mediator](mediator.md) · [Chain of Responsibility](chain-of-responsibility.md) · [Command](command.md)

## Sources

- [Refactoring.Guru, Design Patterns: Observer](https://refactoring.guru/design-patterns/observer) (read)
- [Refactoring.Guru, Observer in Python](https://refactoring.guru/design-patterns/observer/python/example) (read)
- [Refactoring.Guru, Observer in TypeScript](https://refactoring.guru/design-patterns/observer/typescript/example) (read)
- Established TypeScript practice (EventEmitter, EventTarget, RxJS, unsubscribe functions) (recalled)
- [Refactoring.Guru, Observer in Java](https://refactoring.guru/design-patterns/observer/java/example) (read)
- java.util.Observable deprecation (JDK 9); java.util.concurrent.Flow (recalled)
- [Refactoring.Guru, Observer in C#](https://refactoring.guru/design-patterns/observer/csharp/example) (read)
- C# events and delegates; System.IObservable<T>; INotifyPropertyChanged (recalled)
- [Refactoring.Guru, Observer in Go](https://refactoring.guru/design-patterns/observer/go/example) (read)
- [Go blog, Go Concurrency Patterns, Pipelines and cancellation](https://go.dev/blog/pipelines) (recalled)
- [Refactoring.Guru, Observer in Rust](https://refactoring.guru/design-patterns/observer/rust/example) (read)
- Channel-based pub/sub (std mpsc, tokio broadcast/watch) (recalled)
- [Refactoring.Guru, Observer in C++](https://refactoring.guru/design-patterns/observer/cpp/example) (read)
- [Boost.Signals2](https://www.boost.org/doc/libs/release/doc/html/signals2.html) (recalled)
