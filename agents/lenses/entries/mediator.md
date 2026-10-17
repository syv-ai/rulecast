<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Mediator

`mediator` · design patterns, behavioral · **contested**

Objects stop talking to each other directly and go through one coordinator that knows how they interact. Classically it coordinates UI components; in back ends the name now also covers an in-process dispatcher that routes each request or command to its one handler.

*Names:* Named by Gamma, Helm, Johnson and Vlissides in Design Patterns (1994), where it coordinates widgets in a dialog. In .NET back ends the name was later attached to in-process request/handler dispatch, through MediatR. Critics point out that this usage is closer to a command dispatcher than to the GoF pattern.

*Matters most for:* web-frontend, desktop, mobile, tui, web-api

## But

The mediator tends to grow into a god object that knows everything about everyone, and the coupling hasn't gone away, it has moved into one place. Flow through a mediator is harder to follow than a direct call. Mediator libraries used as a universal in-process dispatcher are often criticised as indirection without benefit. Keep it when there are genuinely many-to-many interactions; otherwise prefer direct calls.

## Quality axes

- **change_cost** ⊕ (primary): Components reference only the coordinator, so they can be changed and reused without touching their neighbours.
- **operability** −: Following what happens means tracing through the coordinator or dispatcher rather than a direct call, which IDE navigation and stack reading don't follow.

**Flips:** For two or three objects, or as an in-process dispatcher with one sender and one handler per request, it is a hop with no decoupling; a mediator that absorbs component logic becomes a god object and turns change_cost "-".

## Warranted when

- A group of objects reference each other in a web, so changing one means touching several others
- A component can't be reused in another screen or context because it reaches into its neighbours
- Interaction rules between components (enable this when that changes, validate all on submit) are scattered across all of them
- Subclasses exist only to change how components cooperate in one context
- A back end where each use case is a request object with one handler, and cross-cutting steps (validation, logging, transactions) should wrap every handler the same way

## How it shows

- A coordinator class that holds references to several components and reacts to their events
- Components that hold only a reference to the coordinator, not to each other
- A notify(sender, event) method that branches on which component sent what
- In a back end, controllers that only build a request object and send it to a dispatcher, with one handler class per request and pipeline behaviours around them

## Overdone when

- A mediator for two or three objects that could just call each other
- An in-process dispatcher in front of every service call where each request has one sender and one handler, adding a hop and hiding the call graph with no decoupling gained
- A coordinator that has absorbed the components' own logic and become the place everything is edited

## Example

Before:

```
class MotionSensor:
    fn on_motion():
        self.hall_light.turn_on()
        if self.alarm.armed: self.alarm.trigger()
        self.thermostat.mark_occupied()
class Alarm:
    fn arm():
        self.hall_light.turn_off()
        self.thermostat.set_away()
        self.blinds.close()
# every device holds references to the others; a sensor can't be reused in the garage
```

After:

```
class HomeScene:    # holds the devices; the one place that knows how they interact
    fn notify(sender: Device, event: str):
        if event == "motion":
            self.hall_light.turn_on()
            if self.alarm.armed: self.alarm.trigger()
            self.thermostat.mark_occupied()
        elif event == "armed":
            self.hall_light.turn_off()
            self.thermostat.set_away()
            self.blinds.close()

class MotionSensor:
    fn on_motion(): self.scene.notify(self, "motion")    # knows only the scene
class Alarm:
    fn arm(): self.scene.notify(self, "armed")           # knows only the scene
```

The rules for how devices react to each other move into one scene object, so each device knows only the scene and can be reused in another one.

## One-file tell

A notify or handle method taking a sender and an event name, with a run of if / elif branches on which component sent it.

## By language

**python:** Often a plain function or controller object that wires callbacks, or a simple event bus. The source names coordinating GUI components as the common Python use, close to the controller in MVC.

**typescript:** Most often used in TypeScript to coordinate GUI components, playing the role a controller plays in MVC. In practice, an event bus or a central store (Redux, Zustand) often takes this role. A parent component that owns state and passes callbacks down is the everyday small-scale form.

**java:** Used most often to coordinate GUI components, and close kin to the controller in MVC. The page also counts Timer and the Executor/ExecutorService scheduling methods as mediator-like. In Spring code, an application event publisher or an in-process message bus often plays the mediator. On the back end, the same request-to-handler dispatch appears as a command bus (Axon's CommandGateway, or a hand-written one over Spring beans).

**csharp:** Classically used to coordinate GUI components so they don't refer to one another, much like a controller in MVC. In ASP.NET Core the name is tied to the in-process request dispatcher: controllers or endpoints send a request object, one handler answers it, and pipeline behaviours wrap every handler with validation, logging or a transaction. That decouples the web layer from use cases and gives one place for cross-cutting steps, at the cost of a hop that IDE navigation can't follow; whether it pays off is a common debate. MediatR is the familiar library. Since 13.0 (2025) MediatR is dual-licensed, RPL-1.5 or commercial, with a free community licence for small organisations; 12.x stays Apache 2.0. Source-generated alternatives and plain handler interfaces registered in DI are common replacements. Spotting it: IMediator or ISender injected into controllers, Send/Publish calls, IRequestHandler implementations and IPipelineBehavior registrations.

**go:** Often done with channels and a coordinating goroutine rather than a mediator object. Components send messages to a central loop that owns the shared state and decides what happens next. That fits the Go proverb about sharing memory by communicating. The object version, where components hold a mediator interface, is used too, for event buses or coordinators. Spotting it: A goroutine selecting over several channels and routing between components, or a struct that components hold through an interface and call instead of each other.

**rust:** The classic two-way references between colleagues and mediator fight the borrow checker. The idiomatic form is top-down ownership: the mediator owns its components, and each one receives `&mut dyn Mediator` only for the length of a call. To call a component with the mediator itself, it is removed from the map and put back afterwards. The other route is `Rc<RefCell<..>>` cycles, which is usually discouraged. Message passing over channels, or an event loop owning all state, is the other common Rust shape. Spotting it: A struct owning a `HashMap`/`Vec` of `Box<dyn Component>` whose methods hand `self` as `&mut dyn Mediator` to a component. Alternatively, a central task reading from an mpsc channel that the components send into.

**cpp:** Mostly used in C++ to coordinate GUI components, and it is the role the controller plays in MVC. Qt's signals and slots wired in a parent widget are a common practical form. Components usually hold a non-owning pointer to the mediator, which outlives them. Spotting it: Components that hold a pointer to a shared mediator interface and notify it instead of calling each other, with the mediator deciding which other components react.

## Related

[Observer](observer.md) · [Facade](facade.md) · [Chain of Responsibility](chain-of-responsibility.md) · [Command](command.md) · [God object (The Blob)](god-object.md)

## Sources

- Gamma, Helm, Johnson, Vlissides, Design Patterns: Elements of Reusable Object-Oriented Software (1994), Mediator (recalled)
- [Refactoring.Guru, Design Patterns: Mediator](https://refactoring.guru/design-patterns/mediator) (read)
- [Refactoring.Guru, Mediator in Python](https://refactoring.guru/design-patterns/mediator/python/example) (read)
- [Refactoring.Guru, Mediator in TypeScript](https://refactoring.guru/design-patterns/mediator/typescript/example) (read)
- Established TypeScript practice (central stores, parent components as mediators) (recalled)
- [Refactoring.Guru, Mediator in Java](https://refactoring.guru/design-patterns/mediator/java/example) (read)
- Spring ApplicationEventPublisher (recalled)
- [Refactoring.Guru, Mediator in C#](https://refactoring.guru/design-patterns/mediator/csharp/example) (read)
- MediatR library (recalled)
- [Refactoring.Guru, Mediator in Go](https://refactoring.guru/design-patterns/mediator/go/example) (read)
- [Go blog, Share Memory By Communicating](https://go.dev/blog/codelab-share) (recalled)
- [Refactoring.Guru, Mediator in Rust](https://refactoring.guru/design-patterns/mediator/rust/example) (read)
- Channel/actor-based coordination in Rust (recalled)
- [Refactoring.Guru, Mediator in C++](https://refactoring.guru/design-patterns/mediator/cpp/example) (read)
- [Qt signals and slots](https://doc.qt.io/qt-6/signalsandslots.html) (recalled)
- [Jimmy Bogard, "AutoMapper and MediatR Commercial Editions Launch Today" (2025)](https://www.jimmybogard.com/automapper-and-mediatr-commercial-editions-launch-today/) (read)
